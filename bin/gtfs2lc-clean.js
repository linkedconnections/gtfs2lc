#!/usr/bin/env node

const fs = require("node:fs");
const { mkdir, mkdtemp, rename, rm } = require("node:fs/promises");
const { once } = require("node:events");
const path = require("node:path");
const readline = require("node:readline");
const { finished } = require("node:stream/promises");
const csv = require("fast-csv");

const requiredFiles = [
  "stop_times.txt",
  "trips.txt",
  "routes.txt",
  "stops.txt",
];
const optionalFiles = ["calendar.txt", "calendar_dates.txt"];
const chunkSize = 50_000;

async function normalizeCsv(sourceFile, destinationFile) {
  const parser = fs
    .createReadStream(sourceFile)
    .pipe(csv.parse({ headers: true }));
  const formatter = csv.format({ headers: true });
  const output = fs.createWriteStream(destinationFile);
  formatter.pipe(output);
  for await (const row of parser) {
    if (!formatter.write(row)) await once(formatter, "drain");
  }
  formatter.end();
  await finished(output);
}

function compareStopTimes(left, right) {
  if (left.trip_id < right.trip_id) return -1;
  if (left.trip_id > right.trip_id) return 1;
  return Number(left.stop_sequence) - Number(right.stop_sequence);
}

async function writeChunk(rows, directory, index) {
  rows.sort(compareStopTimes);
  const fileName = path.join(directory, `chunk-${index}.ndjson`);
  const output = fs.createWriteStream(fileName);
  for (const row of rows) {
    if (!output.write(`${JSON.stringify(row)}\n`)) await once(output, "drain");
  }
  output.end();
  await finished(output);
  return fileName;
}

async function sortStopTimes(sourceFile, destinationFile, temporaryDirectory) {
  const parser = fs
    .createReadStream(sourceFile)
    .pipe(csv.parse({ headers: true }));
  const chunks = [];
  let rows = [];
  for await (const row of parser) {
    rows.push(row);
    if (rows.length >= chunkSize) {
      chunks.push(await writeChunk(rows, temporaryDirectory, chunks.length));
      rows = [];
    }
  }
  if (rows.length || chunks.length === 0) {
    chunks.push(await writeChunk(rows, temporaryDirectory, chunks.length));
  }

  const readers = chunks.map((fileName) => {
    const lines = readline.createInterface({
      input: fs.createReadStream(fileName),
      crlfDelay: Infinity,
    });
    return lines[Symbol.asyncIterator]();
  });
  const heads = await Promise.all(readers.map((reader) => reader.next()));
  const formatter = csv.format({ headers: true });
  const output = fs.createWriteStream(destinationFile);
  formatter.pipe(output);

  while (heads.some((head) => !head.done)) {
    let selected = -1;
    let selectedRow;
    for (let index = 0; index < heads.length; index += 1) {
      if (heads[index].done) continue;
      const row = JSON.parse(heads[index].value);
      if (selected === -1 || compareStopTimes(row, selectedRow) < 0) {
        selected = index;
        selectedRow = row;
      }
    }
    if (!formatter.write(selectedRow)) await once(formatter, "drain");
    heads[selected] = await readers[selected].next();
  }

  formatter.end();
  await finished(output);
}

async function main() {
  const sourcePath = process.argv[2] && path.resolve(process.argv[2]);
  if (!sourcePath) throw new Error("Usage: gtfs2lc-clean <path-to-gtfs-feed>");

  try {
    await mkdir(sourcePath, { recursive: false });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const temporaryDirectory = await mkdtemp(
    path.join(sourcePath, ".gtfs2lc-clean-"),
  );

  try {
    for (const fileName of [...requiredFiles, ...optionalFiles]) {
      const sourceFile = path.join(sourcePath, fileName);
      const destinationFile = path.join(temporaryDirectory, fileName);
      if (!fs.existsSync(sourceFile)) {
        if (requiredFiles.includes(fileName))
          throw new Error(`Missing required GTFS file: ${fileName}`);
        continue;
      }
      console.error(`Preparing ${fileName}`);
      if (fileName === "stop_times.txt") {
        await sortStopTimes(sourceFile, destinationFile, temporaryDirectory);
      } else {
        await normalizeCsv(sourceFile, destinationFile);
      }
      await rename(destinationFile, sourceFile);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
