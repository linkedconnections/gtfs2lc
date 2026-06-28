#!/usr/bin/env node

const fs = require("node:fs");
const {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
} = require("node:fs/promises");
const { once } = require("node:events");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline, finished } = require("node:stream/promises");
const { spawn } = require("node:child_process");
const csv = require("fast-csv");
const unzipper = require("unzipper");

const defaultUrl =
  "https://gtfs.flatturtle.cloud/sncb-nmbs/_latest/sncb-nmbs-gtfs.zip";
const defaultTimeZone = "Europe/Brussels";
const root = path.resolve(__dirname, "..");

function parsePositiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 366) {
    throw new TypeError(`${name} must be an integer between 1 and 366`);
  }
  return parsed;
}

function todayInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError(`Invalid date ${value}; expected YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`Invalid date ${value}`);
  }
  return date;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function compactDate(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

async function fileExists(fileName) {
  try {
    await access(fileName);
    return true;
  } catch {
    return false;
  }
}

async function filterCsv(fileName, transform) {
  if (!(await fileExists(fileName))) return;
  const temporaryFile = `${fileName}.tmp`;
  const parser = fs
    .createReadStream(fileName)
    .pipe(csv.parse({ headers: true }));
  const formatter = csv.format({ headers: true });
  const output = fs.createWriteStream(temporaryFile);
  formatter.pipe(output);

  try {
    for await (const row of parser) {
      const transformed = transform(row);
      if (transformed && !formatter.write(transformed))
        await once(formatter, "drain");
    }
    formatter.end();
    await finished(output);
    await rename(temporaryFile, fileName);
  } catch (error) {
    formatter.destroy();
    output.destroy();
    await rm(temporaryFile, { force: true });
    throw error;
  }
}

async function constrainCalendar(feedDirectory, startDate, endDate) {
  const start = compactDate(startDate);
  const end = compactDate(endDate);

  await filterCsv(path.join(feedDirectory, "calendar.txt"), (row) => {
    if (row.end_date < start || row.start_date > end) return null;
    return {
      ...row,
      start_date: row.start_date < start ? start : row.start_date,
      end_date: row.end_date > end ? end : row.end_date,
    };
  });
  await filterCsv(path.join(feedDirectory, "calendar_dates.txt"), (row) =>
    row.date >= start && row.date <= end ? row : null,
  );
}

async function findFeedDirectory(directory) {
  if (await fileExists(path.join(directory, "stop_times.txt")))
    return directory;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    if (await fileExists(path.join(candidate, "stop_times.txt")))
      return candidate;
  }
  throw new Error(
    "The downloaded ZIP does not contain a GTFS stop_times.txt file",
  );
}

async function download(url, destination) {
  console.error(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`GTFS download failed with HTTP ${response.status}`);
  }
  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destination),
  );
}

async function extract(zipFile, destination) {
  console.error("Extracting SNCB GTFS feed");
  await pipeline(
    fs.createReadStream(zipFile),
    unzipper.Extract({ path: destination }),
  );
}

async function runConverter(feedDirectory, outputDirectory, options) {
  const arguments_ = [
    path.join(root, "bin", "gtfs2lc.js"),
    "--fresh",
    "--format",
    options.format,
    "--store",
    "LevelStore",
    "--output",
    outputDirectory,
  ];
  if (options.compressed) arguments_.push("--compressed");
  if (options.workers) arguments_.push("--workers", String(options.workers));
  arguments_.push(feedDirectory);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: root,
      env: { ...process.env, TZ: options.timeZone },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `gtfs2lc exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
          ),
        );
    });
  });
}

async function main() {
  const timeZone = process.env.SNCB_TIMEZONE || defaultTimeZone;
  const startValue = process.env.SNCB_START_DATE || todayInTimeZone(timeZone);
  const days = parsePositiveInteger(process.env.SNCB_DAYS || "7", "SNCB_DAYS");
  const startDate = parseDate(startValue);
  const endDate = addDays(startDate, days - 1);
  const buildDirectory = path.resolve(
    root,
    process.env.SNCB_BUILD_DIR || path.join("build", "sncb"),
  );
  const outputDirectory = path.join(buildDirectory, "output");
  const workspace = await mkdtemp(path.join(tmpdir(), "gtfs2lc-sncb-"));
  const zipFile = path.join(workspace, "sncb-gtfs.zip");
  const extracted = path.join(workspace, "feed");

  console.error(
    `Building SNCB connections from ${compactDate(startDate)} through ${compactDate(endDate)}`,
  );
  await rm(buildDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(extracted, { recursive: true });

  try {
    await download(process.env.SNCB_GTFS_URL || defaultUrl, zipFile);
    await extract(zipFile, extracted);
    const feedDirectory = await findFeedDirectory(extracted);
    await constrainCalendar(feedDirectory, startDate, endDate);
    await runConverter(feedDirectory, outputDirectory, {
      compressed: process.env.SNCB_COMPRESSED === "1",
      format: process.env.SNCB_FORMAT || "jelly",
      timeZone,
      workers: process.env.SNCB_WORKERS,
    });
    console.error(`SNCB build created in ${outputDirectory}`);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { constrainCalendar, parseDate };
