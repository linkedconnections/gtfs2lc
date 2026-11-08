#!/usr/bin/env node

const { tableFromIPC } = require("apache-arrow");
const { definitions } = require("../lib/arrow/schema");

async function readRelease(manifestUrl, fetcher = fetch) {
  const response = await fetcher(manifestUrl);
  if (!response.ok)
    throw new Error(`Manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (
    manifest["@type"] !== "Timetable" ||
    manifest.schemaVersion !== "2-alpha"
  ) {
    throw new Error("Unsupported Arrow Connections format/version");
  }
  const base = response.url || manifestUrl;
  async function load(resource, dataset) {
    const reference =
      typeof resource === "string" ? { "@id": resource } : resource;
    const result = await fetcher(new URL(reference["@id"], base));
    if (!result.ok) throw new Error(`Dataset returned HTTP ${result.status}`);
    const bytes = Buffer.from(await result.arrayBuffer());
    const listedPage = dataset === "connections";
    if (
      bytes.subarray(0, 6).toString() !== "ARROW1" ||
      bytes.subarray(-6).toString() !== "ARROW1"
    )
      throw new Error("Expected an Arrow IPC file");
    const table = tableFromIPC(bytes);
    for (const [key, value] of Object.entries({
      schemaVersion: manifest.schemaVersion,
      releaseId: manifest.releaseId,
      dataset,
    })) {
      if (table.schema.metadata.get(key) !== value)
        throw new Error(`Dataset ${key} mismatch`);
    }
    const fields = definitions[dataset];
    if (!fields) throw new Error("Unknown dataset");
    fields.forEach((expected) => {
      const field = table.schema.fields.find(
        (field) => field.name === expected.name,
      );
      if (
        !field ||
        field.name !== expected.name ||
        field.type.toString() !== expected.type ||
        field.nullable !== expected.nullable
      )
        throw new Error(`Dataset column mismatch: ${expected.name}`);
    });
    if (listedPage) {
      const epoch = table.schema.metadata.get("epochSeconds");
      if (!/^-?\d+$/.test(epoch ?? "") || !Number.isSafeInteger(Number(epoch)))
        throw new Error("Invalid page epochSeconds");
      for (const key of ["epochSeconds", "region"]) {
        if (
          reference[key] !== undefined &&
          table.schema.metadata.get(key) !== String(reference[key])
        )
          throw new Error(`Page ${key} mismatch`);
      }
      let previous = -Infinity;
      for (const row of table) {
        const departure = Number(epoch) + row.departureTimeOffset;
        if (
          departure < previous ||
          row.arrivalTimeOffset < row.departureTimeOffset
        )
          throw new Error("Invalid page time order");
        previous = departure;
      }
      for (const [key, row] of [
        ["minDepartureTime", table.get(0)],
        ["maxDepartureTime", table.get(table.numRows - 1)],
      ]) {
        if (
          reference[key] !== undefined &&
          (!row ||
            Date.parse(reference[key]) / 1000 !==
              Number(epoch) + row.departureTimeOffset)
        )
          throw new Error(`Page ${key} mismatch`);
      }
    }
    return table;
  }
  return { manifest, load };
}

async function main(url) {
  if (!url)
    throw new Error("Usage: node examples/read-arrow.js <manifest-url>");
  const { manifest, load } = await readRelease(url);
  const stops = await load(manifest.stops, "stops");
  const page = manifest.connections.pages[0];
  if (!page) throw new Error("Release has no planning pages");
  const connections = await load(page, "connections");
  const epochSeconds = Number(connections.schema.metadata.get("epochSeconds"));
  if (
    page.epochSeconds !== undefined &&
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
            (epochSeconds + connection.departureTimeOffset) * 1000,
          ).toISOString(),
        },
        arrival: {
          stop: stops.get(connection.arrivalStopIdx).name,
          time: new Date(
            (epochSeconds + connection.arrivalTimeOffset) * 1000,
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
