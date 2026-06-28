#!/usr/bin/env node

const { Command, InvalidArgumentError, Option } = require("commander");
const fs = require("node:fs");
const { readFile, readdir, rm } = require("node:fs/promises");
const { once } = require("node:events");
const path = require("node:path");
const gtfs2lc = require("../lib/gtfs2lc.js");
const packageJson = require("../package.json");

const program = new Command();

program
  .name("gtfs2lc")
  .description("Convert an extracted GTFS feed to Linked Connections")
  .version(packageJson.version)
  .argument("<path>", "path to the extracted GTFS feed")
  .option(
    "-f, --format <format>",
    "output format: csv, ntriples, turtle, json, jsonld, mongo, or mongold",
    "json",
  )
  .option("-b, --base-uris <path>", "JSON file containing URI templates")
  .addOption(new Option("--baseUris <path>").hideHelp())
  .option("-o, --output <path>", "directory in which to store the result")
  .option(
    "-c, --compressed",
    "keep the resulting connection file gzip-compressed",
  )
  .option(
    "-s, --stream",
    "write the resulting connection file to standard output",
  )
  .option("-S, --store <store>", "LevelStore or MemStore", "MemStore")
  .option("--fresh", "discard historic conversion records")
  .option(
    "--workers <count>",
    "number of conversion workers",
    parsePositiveInteger,
  )
  .showHelpAfterError()
  .action(run);

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}

async function run(sourceArgument, options) {
  const sourcePath = path.resolve(sourceArgument);
  const outputPath = path.resolve(options.output || sourcePath);
  const baseUris = options.baseUris
    ? JSON.parse(await readFile(options.baseUris, "utf8"))
    : null;

  const cleanup = async () => {
    const entries = await readdir(outputPath, { withFileTypes: true }).catch(
      () => [],
    );
    const temporary = entries
      .filter(
        (entry) =>
          entry.name.startsWith("raw_") ||
          entry.name.startsWith("connections_"),
      )
      .map((entry) =>
        rm(path.join(outputPath, entry.name), { recursive: true, force: true }),
      );
    await Promise.all(temporary);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      cleanup()
        .catch(console.error)
        .finally(() => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
    });
  }

  console.error("Converting GTFS to Linked Connections...");
  const mapper = new gtfs2lc.Connections({
    store: options.store,
    format: options.format,
    compressed: options.compressed,
    fresh: options.fresh,
    baseUris,
    workers: options.workers,
  });
  const connectionsFile = await mapper.convert(sourcePath, outputPath);

  if (options.stream) {
    for await (const chunk of fs.createReadStream(connectionsFile)) {
      if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
    }
  } else {
    console.error(
      `Linked Connections successfully created at ${connectionsFile}`,
    );
  }
}

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
