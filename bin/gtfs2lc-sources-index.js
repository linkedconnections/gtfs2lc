#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const targetDir = path.resolve(process.argv[2] || ".");
  const entries = await fs.readdir(targetDir, { withFileTypes: true });

  const sources = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(
        await fs.readFile(
          path.join(targetDir, entry.name, "manifest.jsonld"),
          "utf8",
        ),
      );
    } catch {
      continue;
    }
    if (
      !manifest ||
      manifest["@type"] !== "Timetable" ||
      manifest.schemaVersion !== "2-alpha"
    )
      continue;
    sources.push({
      id: entry.name,
      name: entry.name,
      manifest: `${entry.name}/manifest.jsonld`,
    });
  }
  sources.sort((a, b) => a.id.localeCompare(b.id));

  const outputPath = path.join(targetDir, "sources.json");
  await fs.writeFile(outputPath, JSON.stringify({ sources }, null, 2));
  console.error(
    `Wrote ${sources.length} source(s) to ${outputPath}: ${sources.map((s) => s.id).join(", ")}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
