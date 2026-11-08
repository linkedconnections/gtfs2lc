const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { readCsv, writeRows } = require("./io");
const { buildDictionaries } = require("./dictionaries");
const { buildExtras } = require("./extras");
const { callsForFeed } = require("./connections");
const { PlanningSpool } = require("./merge");
const { createIriStrategy, IriRegistry } = require("./iri-strategy");
const { SPECIFICATION } = require("./schema");
const { legalMetadata, realtimeFeeds } = require("./publication");
const { InSeatTransfers } = require("./in-seat-transfers");

async function buildArrowRelease(stores, sourcePath, outputPath, options) {
  const profile = options.profile ?? "linked-connections-v2-alpha";
  if (!["linked-connections-v2-alpha", "irail-cdn-v1"].includes(profile))
    throw new Error("Unknown Arrow profile");
  const irail = profile === "irail-cdn-v1";
  const legal = legalMetadata(options);
  if (!options.sourceId)
    throw new Error(
      "Arrow requires --source-id for a stable logical source namespace",
    );
  if (options.compressed)
    throw new Error(
      "Arrow IPC files are uncompressed; use HTTP content encoding when serving them",
    );
  if (options.baseUris)
    throw new Error(
      "Arrow uses --iri-strategy; --base-uris remains for RDF output",
    );
  for (const name of ["frequencies.txt", "pathways.txt"])
    for await (const row of readCsv(sourcePath, name)) {
      throw new Error(
        `Unsupported GTFS feature: ${name} (${Object.values(row)[0]}); expand it explicitly before conversion`,
      );
    }
  const configuration = structuredClone(
    options.iriStrategy ??
      require(irail ? "./identity-irail.json" : "./identity-defaults.json"),
  );
  configuration.sources ??= {};
  if (options.idBase) {
    configuration.sources[options.sourceId] ??= {};
    configuration.sources[options.sourceId].identityBase = options.idBase;
  }
  const strategy = createIriStrategy(
    options.sourceId,
    configuration,
    new IriRegistry(),
  );
  const releaseId =
    options.releaseId ??
    `release-${new Date().toISOString().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(releaseId))
    throw new Error("Invalid release-id");
  const releases = path.join(outputPath, "releases");
  const destination = path.join(releases, releaseId);
  fs.mkdirSync(releases, { recursive: true });
  if (fs.existsSync(destination))
    throw new Error(
      "Release ID already exists; immutable releases cannot be replaced",
    );
  let prefix = options.urlPrefix ?? (irail ? "/data" : "");
  if (
    prefix &&
    (!/^\/(?!\/)/.test(prefix) ||
      /[%?#\\\s]/.test(prefix) ||
      prefix.split("/").some((p) => p === "." || p === ".."))
  )
    throw new Error("url-prefix must be an origin-relative path");
  prefix = prefix.replace(/\/+$/, "");
  const temp = fs.mkdtempSync(path.join(outputPath, ".arrow-build-"));
  const publicPath = (name) => `${prefix}/releases/${releaseId}/${name}`;
  const metadata = {
    format: "linked-connections",
    schemaVersion: "2-alpha",
    identityProfile: strategy.snapshot.identityProfile,
    releaseId,
  };
  const files = {};
  const publish = async (name, file, rows, extra = {}) => {
    const location = path.join(temp, file);
    await writeRows(location, name, rows, {
      ...metadata,
      ...extra,
    });
    return publicPath(file);
  };
  try {
    const dictionaries = await buildDictionaries(
      stores,
      sourcePath,
      strategy,
      options,
    );
    const { transfers } = await buildExtras(sourcePath, dictionaries, strategy);
    const inSeatTransfers = new InSeatTransfers(dictionaries, options);
    const spool = new PlanningSpool(
      path.join(temp, ".spool"),
      dictionaries.stops,
    );
    const calls = callsForFeed(
      sourcePath,
      stores,
      dictionaries,
      strategy,
      options,
      spool,
    );
    for await (const call of calls) inSeatTransfers.add(call);
    const derivation = inSeatTransfers.derive(transfers, strategy);
    const pages = await spool.publish(publish);
    if (!spool.total)
      throw new Error("No scheduled connections in the requested horizon");
    for (const name of ["stops", "routes", "trips"])
      files[name] = await publish(name, `${name}.arrow`, dictionaries[name]);
    files.transfers = await publish("transfers", "transfers.arrow", transfers, {
      inSeatTransferDerivation: JSON.stringify(derivation),
    });
    await fs.promises.rm(path.join(temp, ".spool"), { recursive: true });
    const manifest = {
      "@context": `${SPECIFICATION}/context.jsonld`,
      "@id": `${prefix}/manifest.jsonld`,
      "@type": "Timetable",
      schemaVersion: "2-alpha",
      releaseId,
      generatedAt: new Date().toISOString(),
      timeZone: dictionaries.timeZone,
      ...legal,
      coverageStart: new Date(spool.min * 1000).toISOString(),
      coverageEnd: new Date((spool.max + 1) * 1000).toISOString(),
      ...files,
      connections: { "@type": "ConnectionCollection", pages },
      ...(options.realtime === undefined
        ? {}
        : { realtime: realtimeFeeds(options.realtime, dictionaries) }),
    };
    const json = JSON.stringify(manifest, null, 2) + "\n";
    const manifestName = "manifest.jsonld";
    fs.writeFileSync(path.join(temp, manifestName), json);
    await fs.promises.rename(temp, destination);
    const discovery = path.join(outputPath, `.manifest-${randomUUID()}.json`);
    await fs.promises.writeFile(discovery, json);
    await fs.promises.rename(discovery, path.join(outputPath, manifestName));
    console.error(
      `In-seat transfer derivation from block_id: ${JSON.stringify(derivation)}`,
    );
    return path.join(outputPath, manifestName);
  } catch (error) {
    await fs.promises.rm(temp, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { buildArrowRelease };
