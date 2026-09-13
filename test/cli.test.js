const { execFile } = require("node:child_process");
const { cp, mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { gunzipSync } = require("node:zlib");
const { Parser } = require("rdf-parser-ts");
const { Parser: JellyParser } = require("rdfjs-jelly");

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
    "--compressed",
    "--format",
    "jelly",
    "--workers",
    "2",
    "--output",
    `${output}${path.sep}`,
    `${feed}${path.sep}`,
  ]);
  const contents = gunzipSync(
    await readFile(path.join(output, "linkedConnections.jelly.gz")),
  );
  const messages = new JellyParser().parseMessages(contents);
  expect(messages.length).toBeGreaterThan(0);
  expect(
    messages.every(
      (message) =>
        message.length > 0 &&
        new Set(message.map((quad) => quad.subject.value)).size === 1,
    ),
  ).toBe(true);
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
  ["jelly", "jelly", null],
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
    format === "jelly" ? undefined : "utf8",
  );
  if (marker) expect(contents).toContain(marker);
  if (format === "jelly") {
    const messages = new JellyParser().parseMessages(contents);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.every((message) => message.length > 0)).toBe(true);
  }
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

test("creates valid partitioned arrow output", async () => {
  await execFileAsync(process.execPath, [
    cli,
    "--format",
    "arrow",
    "--regions",
    "2",
    "--fresh",
    "--workers",
    "2",
    "--output",
    output,
    feed,
  ]);

  const manifest = JSON.parse(
    await readFile(path.join(output, "manifest.json"), "utf8"),
  );
  expect(manifest.format).toBe("gtfs2lc-arrow-connections");
  expect(manifest.counts.stops).toBeGreaterThan(0);
  expect(manifest.partitioning.method).toBe("hub");
  expect(manifest.partitioning.regionCount).toBe(2);
  expect(manifest.connections.months.length).toBeGreaterThan(0);
  expect(Object.keys(manifest.connections.files).length).toBe(2);

  const { Table, RecordBatchStreamReader } = require("apache-arrow");
  const loadTable = async (name) =>
    new Table(
      RecordBatchStreamReader.from(await readFile(path.join(output, name))),
    );

  const stops = await loadTable(manifest.files.stops);
  const trips = await loadTable(manifest.files.trips);

  let totalRows = 0;
  for (const monthsForRegion of Object.values(manifest.connections.files)) {
    for (const relativePath of Object.values(monthsForRegion)) {
      const connections = await loadTable(relativePath);
      totalRows += connections.numRows;

      let sorted = true;
      for (let row = 1; row < connections.numRows; row += 1) {
        if (
          connections.get(row).departureTime <
          connections.get(row - 1).departureTime
        ) {
          sorted = false;
          break;
        }
      }
      expect(sorted).toBe(true);

      if (connections.numRows > 0) {
        const first = connections.get(0);
        expect(stops.get(first.departureStopIdx).stopId).toBeTruthy();
        expect(trips.get(first.tripIdx).tripId).toBeTruthy();
      }
    }
  }
  expect(totalRows).toBeGreaterThan(0);
});
