const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { readCsv, writeRows, describe } = require("./io");
const { buildDictionaries } = require("./dictionaries");
const { buildExtras } = require("./extras");
const { callsForFeed } = require("./connections");
const { PlanningSpool } = require("./merge");
const { createIriStrategy, IriRegistry } = require("./iri-strategy");
const { SPECIFICATION } = require("./schema");

async function buildArrowRelease(stores, sourcePath, outputPath, options) {
  const profile = options.profile ?? "linked-connections-v2-alpha";
  if (!["linked-connections-v2-alpha", "irail-cdn-v1"].includes(profile))
    throw new Error("Unknown Arrow profile");
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
      require(
        profile === "irail-cdn-v1"
          ? "./identity-irail.json"
          : "./identity-defaults.json",
      ),
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
  let prefix = options.urlPrefix ?? (profile === "irail-cdn-v1" ? "/data" : "");
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
  const format =
    profile === "irail-cdn-v1" ? "irail-cdn" : "linked-connections";
  const version = profile === "irail-cdn-v1" ? 1 : "2-alpha";
  const metadata = {
    format,
    schemaVersion: String(version),
    identityProfile: strategy.snapshot.identityProfile,
    releaseId,
  };
  const files = {};
  const publish = async (name, file, rows, extra = {}) => {
    const location = path.join(temp, file);
    const count = await writeRows(location, name, rows, {
      ...metadata,
      ...extra,
    });
    return describe(location, publicPath(file), count);
  };
  try {
    const dictionaries = await buildDictionaries(
      stores,
      sourcePath,
      strategy,
      options,
    );
    const extras = await buildExtras(
      sourcePath,
      dictionaries,
      strategy,
      publish,
    );
    const spool = new PlanningSpool(
      path.join(temp, ".spool"),
      dictionaries.stops,
    );
    files.calls = await publish(
      "calls",
      "calls.arrow",
      callsForFeed(sourcePath, stores, dictionaries, strategy, options, spool),
    );
    files.planning = await spool.publish(publish);
    if (!spool.total)
      throw new Error("No scheduled connections in the requested horizon");
    for (const name of ["stops", "routes", "trips"])
      files[name] = await publish(name, `${name}.arrow`, dictionaries[name]);
    files.transfers = await publish(
      "transfers",
      "transfers.arrow",
      extras.transfers,
    );
    if (extras.shapes.length)
      files.shapes = await publish("shapes", "shapes.arrow", extras.shapes);
    await fs.promises.rm(path.join(temp, ".spool"), { recursive: true });
    const rules = JSON.stringify(strategy.snapshot, null, 2) + "\n";
    fs.writeFileSync(path.join(temp, "identity-strategy.json"), rules);
    const identityStrategy = await describe(
      path.join(temp, "identity-strategy.json"),
      publicPath("identity-strategy.json"),
    );
    const hash = createHash("sha256");
    for (const name of fs
      .readdirSync(sourcePath)
      .filter((name) => name.endsWith(".txt"))
      .sort()) {
      hash.update(name + "\0");
      for await (const chunk of fs.createReadStream(
        path.join(sourcePath, name),
      ))
        hash.update(chunk);
      hash.update("\0");
    }
    const manifest = {
      format,
      version,
      specification: SPECIFICATION,
      status: options.sourceId === "demo.fixture" ? "demo" : "production",
      sourceId: options.sourceId,
      sourceIri: strategy.mint("source", {}, [options.sourceId]),
      identityProfile: strategy.snapshot.identityProfile,
      identityBase: strategy.snapshot.identityBase,
      identityStrategy,
      releaseId,
      generatedAt: new Date().toISOString(),
      timeZone: dictionaries.timeZone,
      sources: [
        {
          id: "gtfs-static",
          gtfsContentSha256: hash.digest("hex"),
          attribution: dictionaries.agencies.map((a) => a.agency_name),
          license: options.license ?? null,
        },
      ],
      coverage: {
        start: new Date(spool.min * 1000).toISOString(),
        end: new Date((spool.max + 1) * 1000).toISOString(),
        startServiceDate: spool.firstDay,
        endServiceDate: spool.lastDay,
      },
      partitioning: {
        timePartitionSeconds: 21600,
        maxRows: 50000,
        method: (options.regions ?? 1) > 1 ? "hub" : "none",
        regions: dictionaries.hubs.map((hub, id) => ({
          id,
          hubStopIdx: hub.stopIdx,
          lat: hub.lat,
          lon: hub.lon,
        })),
      },
      capabilities: {
        planning: "available",
        realtime: "unconfigured",
        compositions: "unavailable",
        occupancy: "unavailable",
        alerts: "unavailable",
      },
      ...(profile === "irail-cdn-v1"
        ? { realtimeManifestPath: "/realtime/manifest.json" }
        : {}),
      files,
    };
    const json = JSON.stringify(manifest, null, 2) + "\n";
    fs.writeFileSync(path.join(temp, "manifest.json"), json);
    await fs.promises.rename(temp, destination);
    const discovery = path.join(outputPath, `.manifest-${randomUUID()}.json`);
    await fs.promises.writeFile(discovery, json);
    await fs.promises.rename(discovery, path.join(outputPath, "manifest.json"));
    return path.join(outputPath, "manifest.json");
  } catch (error) {
    await fs.promises.rm(temp, { recursive: true, force: true });
    throw error;
  }
}
module.exports = { buildArrowRelease };
