#!/usr/bin/env node

const { createHash } = require("node:crypto");
const { tableFromIPC } = require("apache-arrow");

async function readRelease(manifestUrl, fetcher = fetch) {
  const response = await fetcher(manifestUrl);
  if (!response.ok)
    throw new Error(`Manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (!(
    (manifest.format === "linked-connections" &&
      manifest.version === "2-alpha") ||
    (manifest.format === "irail-cdn" && manifest.version === 1)
  )) {
    throw new Error("Unsupported Arrow Connections format/version");
  }
  const base = response.url || manifestUrl;
  async function load(descriptor, dataset) {
    const result = await fetcher(new URL(descriptor.path, base));
    if (!result.ok) throw new Error(`Dataset returned HTTP ${result.status}`);
    const bytes = Buffer.from(await result.arrayBuffer());
    if (
      bytes.length !== descriptor.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256
    ) {
      throw new Error("Dataset size/hash mismatch");
    }
    const table = tableFromIPC(bytes);
    for (const [key, value] of Object.entries({
      format: manifest.format,
      schemaVersion: String(manifest.version),
      releaseId: manifest.releaseId,
      identityProfile: manifest.identityProfile,
      dataset,
    })) {
      if (table.schema.metadata.get(key) !== value)
        throw new Error(`Dataset ${key} mismatch`);
    }
    if (table.numRows !== descriptor.rowCount)
      throw new Error("Dataset row count mismatch");
    return table;
  }
  return { manifest, load };
}

async function main(url) {
  if (!url)
    throw new Error("Usage: node examples/read-arrow.js <manifest-url>");
  const { manifest, load } = await readRelease(url);
  const stops = await load(manifest.files.stops, "stops");
  const page = manifest.files.planning[0];
  if (!page) throw new Error("Release has no planning pages");
  const connections = await load(page, "planning");
  if (
    connections.schema.metadata.get("epochSeconds") !==
    String(page.epochSeconds)
  )
    throw new Error("Page epoch mismatch");
  const connection = connections.get(0);
  console.log(
    JSON.stringify(
      {
        releaseId: manifest.releaseId,
        iri: connection.iri,
        departure: {
          stop: stops.get(connection.departureStopIdx).name,
          time: new Date(
            (page.epochSeconds + connection.departureTimeOffset) * 1000,
          ).toISOString(),
        },
        arrival: {
          stop: stops.get(connection.arrivalStopIdx).name,
          time: new Date(
            (page.epochSeconds + connection.arrivalTimeOffset) * 1000,
          ).toISOString(),
        },
      },
      null,
      2,
    ),
  );
}

if (require.main === module)
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { readRelease };
