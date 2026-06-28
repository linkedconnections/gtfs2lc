#!/usr/bin/env node

const { closeSync, openSync } = require("node:fs");
const { cp, mkdir, rm } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

const root = resolve(__dirname, "..");
const fixture = join(root, "test", "sample-feed-test");
const workingFeed = join(root, "test", "sample-feed");

async function runToFile(command, args, outputFile) {
  const output = openSync(outputFile, "w");
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", output, "inherit"],
  });

  try {
    await new Promise((resolveRun, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) resolveRun();
        else
          reject(
            new Error(
              `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
            ),
          );
      });
    });
  } finally {
    closeSync(output);
  }
}

async function main() {
  await rm(workingFeed, { recursive: true, force: true });
  await mkdir(workingFeed, { recursive: true });
  await cp(fixture, workingFeed, { recursive: true });

  const unjoined = join(workingFeed, "connections-notjoined.nldjsonld");
  await runToFile(
    process.execPath,
    [
      join(root, "bin", "gtfs2lc.js"),
      "-s",
      "-f",
      "jsonld",
      "--fresh",
      workingFeed,
    ],
    unjoined,
  );
  await runToFile(
    process.execPath,
    [join(root, "bin", "linkedconnections-sort.js"), unjoined],
    join(workingFeed, "connections.nldjsonld"),
  );
  await rm(join(workingFeed, "linkedConnections.json"), { force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
