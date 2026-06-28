#!/usr/bin/env node
// @ts-check

const fs = require("node:fs");
const { mkdtemp, rm } = require("node:fs/promises");
const { once } = require("node:events");
const { tmpdir } = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { finished } = require("node:stream/promises");

const chunkSize = 50_000;

async function* readJsonLines(fileName) {
  const lines = readline.createInterface({
    input: fs.createReadStream(fileName),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line);
  }
}

function compareValues(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareConnections(left, right) {
  for (const key of [
    "departureTime",
    "arrivalTime",
    "gtfs:route",
    "departureStop",
    "arrivalStop",
    "@id",
  ]) {
    const compared = compareValues(left[key] || "", right[key] || "");
    if (compared) return compared;
  }
  return 0;
}

async function writeChunk(rows, directory, prefix, index, compare) {
  rows.sort(compare);
  const fileName = path.join(directory, `${prefix}-${index}.ndjson`);
  const output = fs.createWriteStream(fileName);
  for (const row of rows) {
    if (!output.write(`${JSON.stringify(row)}\n`)) await once(output, "drain");
  }
  output.end();
  await finished(output);
  return fileName;
}

async function createSortedChunks(values, directory, prefix, compare) {
  const chunks = [];
  let rows = [];
  for await (const value of values) {
    rows.push(value);
    if (rows.length >= chunkSize) {
      chunks.push(
        await writeChunk(rows, directory, prefix, chunks.length, compare),
      );
      rows = [];
    }
  }
  if (rows.length)
    chunks.push(
      await writeChunk(rows, directory, prefix, chunks.length, compare),
    );
  return chunks;
}

async function* mergeChunks(chunks, compare) {
  const readers = chunks.map((fileName) =>
    readJsonLines(fileName)[Symbol.asyncIterator](),
  );
  const heads = await Promise.all(readers.map((reader) => reader.next()));

  while (heads.some((head) => !head.done)) {
    let selected = -1;
    for (let index = 0; index < heads.length; index += 1) {
      if (heads[index].done) continue;
      if (
        selected === -1 ||
        compare(heads[index].value, heads[selected].value) < 0
      )
        selected = index;
    }
    yield heads[selected].value;
    heads[selected] = await readers[selected].next();
  }
}

function sameMovement(left, right) {
  return (
    left.arrivalTime === right.arrivalTime &&
    left.departureTime === right.departureTime &&
    left.departureStop === right.departureStop &&
    left.arrivalStop === right.arrivalStop &&
    left["gtfs:route"] === right["gtfs:route"]
  );
}

function mergeMovement(connection, previous) {
  let merged;
  if (
    connection["gtfs:pickupType"] === "gtfs:NotAvailable" &&
    previous["gtfs:pickupType"] !== "gtfs:NotAvailable"
  ) {
    merged = previous;
    (merged.joinedWithTrip ||= []).push(connection["gtfs:trip"]);
  } else if (
    previous["gtfs:pickupType"] === "gtfs:NotAvailable" &&
    connection["gtfs:pickupType"] !== "gtfs:NotAvailable"
  ) {
    merged = connection;
    (merged.joinedWithTrip ||= []).push(previous["gtfs:trip"]);
  } else if (
    connection["gtfs:dropOffType"] === "gtfs:NotAvailable" &&
    previous["gtfs:dropOffType"] !== "gtfs:NotAvailable"
  ) {
    merged = previous;
    (merged.willSplitInto ||= []).push(connection["gtfs:trip"]);
  } else if (
    previous["gtfs:dropOffType"] === "gtfs:NotAvailable" &&
    connection["gtfs:dropOffType"] !== "gtfs:NotAvailable"
  ) {
    merged = connection;
    (merged.willSplitInto ||= []).push(previous["gtfs:trip"]);
  }
  return merged;
}

async function* joinConnections(connections) {
  const tripsLastConnection = new Map();
  const joinedTrips = new Map();
  let previous;

  const processConnection = (connection) => {
    for (const joinedTrip of connection.joinedWithTrip || []) {
      joinedTrips.set(joinedTrip, connection["gtfs:trip"]);
    }

    const nextForTrip = tripsLastConnection.get(connection["gtfs:trip"]);
    if (nextForTrip) {
      connection.nextConnection = [nextForTrip["@id"]];
      if (connection.willSplitInto && !nextForTrip.willSplitInto) {
        for (const splitTrip of connection.willSplitInto) {
          const splitConnection = tripsLastConnection.get(splitTrip);
          if (splitConnection)
            connection.nextConnection.push(splitConnection["@id"]);
        }
      }
    } else {
      const joinedTrip = joinedTrips.get(connection["gtfs:trip"]);
      const joinedConnection =
        joinedTrip && tripsLastConnection.get(joinedTrip);
      if (joinedConnection)
        connection.nextConnection = [joinedConnection["@id"]];
    }

    tripsLastConnection.set(connection["gtfs:trip"], {
      "@id": connection["@id"],
      willSplitInto: connection.willSplitInto,
    });
    delete connection.willSplitInto;
    delete connection.joinedWithTrip;
    return connection;
  };

  for await (const connection of connections) {
    if (!previous) {
      previous = connection;
      continue;
    }
    if (sameMovement(connection, previous)) {
      const merged = mergeMovement(connection, previous);
      if (merged) {
        previous = merged;
        continue;
      }
    }
    yield processConnection(previous);
    previous = connection;
  }
  if (previous) yield processConnection(previous);
}

async function main() {
  const input = process.argv[2] && path.resolve(process.argv[2]);
  if (!input)
    throw new Error(
      "Usage: linkedconnections-joinandsort <connections.ndjson>",
    );
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "gtfs2lc-sort-"),
  );
  let context;

  async function* connectionsOnly() {
    for await (const value of readJsonLines(input)) {
      if (value["@context"] && !context) context = value;
      else yield value;
    }
  }

  try {
    const descending = (left, right) => -compareConnections(left, right);
    const initialChunks = await createSortedChunks(
      connectionsOnly(),
      temporaryDirectory,
      "descending",
      descending,
    );
    const joined = joinConnections(mergeChunks(initialChunks, descending));
    const finalChunks = await createSortedChunks(
      joined,
      temporaryDirectory,
      "ascending",
      compareConnections,
    );

    if (context) process.stdout.write(`${JSON.stringify(context)}\n`);
    for await (const connection of mergeChunks(
      finalChunks,
      compareConnections,
    )) {
      if (!process.stdout.write(`${JSON.stringify(connection)}\n`))
        await once(process.stdout, "drain");
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
