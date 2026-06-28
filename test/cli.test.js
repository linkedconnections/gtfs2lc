const { execFile } = require("node:child_process");
const { cp, mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { gunzipSync } = require("node:zlib");
const { Parser } = require("rdf-parser-ts");

const execFileAsync = promisify(execFile);
const cli = path.resolve(__dirname, "../bin/gtfs2lc.js");
let temporaryDirectory;
let feed;
let output;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "gtfs2lc cli "));
  feed = path.join(temporaryDirectory, "feed with spaces");
  output = path.join(temporaryDirectory, "output with spaces");
  await cp(path.resolve(__dirname, "sample-feed-test"), feed, {
    recursive: true,
  });
});

afterAll(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("accepts paths containing spaces and trailing separators", async () => {
  await execFileAsync(process.execPath, [
    cli,
    "--fresh",
    "--workers",
    "2",
    "--output",
    `${output}${path.sep}`,
    `${feed}${path.sep}`,
  ]);
  const firstLine = (
    await readFile(path.join(output, "linkedConnections.json"), "utf8")
  )
    .split("\n")
    .find(Boolean);
  expect(JSON.parse(firstLine).arrivalStop.stop_id).toBeDefined();
});

test("returns and retains the gzip filename for compressed output", async () => {
  await execFileAsync(process.execPath, [
    cli,
    "--compressed",
    "--format",
    "turtle",
    "--fresh",
    "--workers",
    "2",
    "--output",
    output,
    feed,
  ]);
  const compressed = await readFile(
    path.join(output, "linkedConnections.ttl.gz"),
  );
  const contents = gunzipSync(compressed).toString("utf8");
  const messages = new Parser({ format: "Turtle" }).parseMessages(contents);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.every((message) => message.length > 0)).toBe(true);
  expect((contents.match(/@version/gu) || []).length).toBe(1);
});

test("rejects unsupported formats", async () => {
  await expect(
    execFileAsync(process.execPath, [cli, "--format", "xml", feed]),
  ).rejects.toMatchObject({ code: 1 });
});

test.each([
  ["csv", "csv", '"departureStop"'],
  ["ntriples", "nt", 'VERSION "1.2-messages"'],
  ["mongo", "json", '"$date"'],
  ["mongold", "json", '"@context"'],
])("creates valid %s output", async (format, extension, marker) => {
  await execFileAsync(process.execPath, [
    cli,
    "--format",
    format,
    "--fresh",
    "--workers",
    "2",
    "--output",
    output,
    feed,
  ]);
  const contents = await readFile(
    path.join(output, `linkedConnections.${extension}`),
    "utf8",
  );
  expect(contents).toContain(marker);
  if (format === "ntriples") {
    const messages = new Parser({ format: "N-Triples" }).parseMessages(
      contents,
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(
      messages.every(
        (message) =>
          message.length > 0 &&
          new Set(message.map((quad) => quad.subject.value)).size === 1,
      ),
    ).toBe(true);
  }
});
