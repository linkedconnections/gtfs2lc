const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { mkdtemp, cp, readFile, rm, writeFile } = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { createHash } = require("node:crypto");
const { tableFromIPC } = require("apache-arrow");
const { definitions } = require("../lib/arrow/schema");
const { serviceEpoch } = require("../lib/arrow/time");
const { createIriStrategy } = require("../lib/arrow/iri-strategy");
const run = promisify(execFile);
let root, feed, output;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lc-arrow-"));
  feed = path.join(root, "feed");
  output = path.join(root, "data");
  await cp(path.join(__dirname, "arrow-feed"), feed, { recursive: true });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function build(profile = "linked-connections-v2-alpha", extra = []) {
  await run(
    process.execPath,
    [
      path.join(__dirname, "../bin/gtfs2lc.js"),
      "--format",
      "arrow",
      "--source-id",
      "demo.fixture",
      "--profile",
      profile,
      "--release-id",
      "test-release",
      "--regions",
      "2",
      "--output",
      output,
      ...extra,
      feed,
    ],
    { env: { ...process.env, TZ: "Pacific/Honolulu" } },
  ).catch((error) => {
    throw new Error(error.stderr || error.message);
  });
  return JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
}
function local(descriptor) {
  return path.join(output, descriptor.path.replace(/^\/data\//, "/").slice(1));
}
async function table(descriptor) {
  return tableFromIPC(await readFile(local(descriptor)));
}

test.each(["linked-connections-v2-alpha", "irail-cdn-v1"])(
  "publishes complete immutable IPC files and coherent joins (%s)",
  async (profile) => {
    const manifest = await build(profile);
    expect(manifest.format).toBe(
      profile === "irail-cdn-v1" ? "irail-cdn" : "linked-connections",
    );
    expect(manifest.version).toBe(profile === "irail-cdn-v1" ? 1 : "2-alpha");
    const tables = {};
    for (const [name, value] of Object.entries(manifest.files)) {
      const list = Array.isArray(value) ? value : [value];
      tables[name] = [];
      for (const descriptor of list) {
        const bytes = await readFile(local(descriptor));
        expect(bytes.subarray(0, 6).toString()).toBe("ARROW1");
        expect(bytes.subarray(-6).toString()).toBe("ARROW1");
        expect(bytes.length).toBe(descriptor.byteLength);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          descriptor.sha256,
        );
        const data = tableFromIPC(bytes);
        expect(data.numRows).toBe(descriptor.rowCount);
        expect(
          data.schema.fields.map((f) => [
            f.name,
            f.type.toString(),
            f.nullable,
          ]),
        ).toEqual(definitions[name].map((f) => [f.name, f.type, f.nullable]));
        expect(data.schema.metadata.get("format")).toBe(manifest.format);
        expect(data.schema.metadata.get("releaseId")).toBe(manifest.releaseId);
        tables[name].push(...data);
      }
    }
    expect(tables.calls).toHaveLength(16);
    expect(tables.planning).toHaveLength(10);
    const calls = new Map(tables.calls.map((c) => [c.iri, c]));
    for (const row of tables.planning) {
      expect(row.arrivalStopSequence).toBeGreaterThan(row.stopSequence);
      const departure = calls.get(row.departureCallIri),
        arrival = calls.get(row.arrivalCallIri);
      expect(departure.runIri).toBe(row.runIri);
      expect(arrival.runIri).toBe(row.runIri);
      expect(departure.stopIri).toBe(row.departureStopIri);
      expect(arrival.stopIri).toBe(row.arrivalStopIri);
      expect(tables.trips[row.tripIdx].iri).toBe(row.tripIri);
      expect(tables.stops[row.departureStopIdx].iri).toBe(row.departureStopIri);
    }
    expect(tables.calls.some((c) => c.arrivalTime === null)).toBe(true);
    expect(tables.calls.some((c) => c.departureTime === null)).toBe(true);
    expect(tables.planning[0].crowdednessScore).toBeUndefined();
    expect(manifest.files.occupancy).toBeUndefined();
    for (const page of manifest.files.planning) {
      const data = await table(page);
      let previous = -Infinity;
      for (const row of data) {
        const dep = page.epochSeconds + row.departureTimeOffset;
        expect(dep).toBeGreaterThanOrEqual(previous);
        expect(row.departureTimeOffset).toBeLessThan(21600);
        expect(calls.get(row.departureCallIri).departureTime).toBe(BigInt(dep));
        expect(calls.get(row.arrivalCallIri).arrivalTime).toBe(
          BigInt(page.epochSeconds + row.arrivalTimeOffset),
        );
        previous = dep;
      }
      expect(data.schema.metadata.get("epochSeconds")).toBe(
        String(page.epochSeconds),
      );
    }
    const loop = tables.planning.filter(
      (row) => tables.trips[row.tripIdx].tripId === "t/loop",
    );
    expect(new Set(loop.map((c) => c.iri)).size).toBe(4);
    expect(loop.every((row) => row.iri.includes("t%2Floop"))).toBe(true);
    const rules = JSON.parse(
      await readFile(local(manifest.identityStrategy), "utf8"),
    );
    expect(
      createIriStrategy(manifest.sourceId, { ...rules, sources: {} }).mint(
        "stop",
        { stops: { key: "A/1" } },
        ["A/1"],
      ),
    ).toBe(tables.stops.find((s) => s.stopId === "A/1").iri);
    expect(
      await readFile(
        path.join(output, "releases/test-release/manifest.json"),
        "utf8",
      ),
    ).toBe(await readFile(path.join(output, "manifest.json"), "utf8"));
  },
);

test("expands service dates using agency timezone and noon-minus-12 across DST", () => {
  expect(serviceEpoch("20261025", "Europe/Brussels")).toBe(
    Date.parse("2026-10-24T23:00:00Z") / 1000,
  );
  expect(serviceEpoch("20260329", "Europe/Brussels")).toBe(
    Date.parse("2026-03-28T22:00:00Z") / 1000,
  );
  expect(serviceEpoch("20261024", "Europe/Brussels")).toBe(
    Date.parse("2026-10-23T22:00:00Z") / 1000,
  );
});

test("filters service days without losing after-midnight calls", async () => {
  const manifest = await build("linked-connections-v2-alpha", [
    "--start-date",
    "20261024",
    "--end-date",
    "20261024",
  ]);
  const calls = await table(manifest.files.calls);
  expect(new Set([...calls].map((c) => c.serviceDate))).toEqual(
    new Set([20261024]),
  );
  const loop = [...calls].filter((c) => c.stopSequence === 9);
  expect(loop[0].arrivalTime).toBe(
    BigInt(Date.parse("2026-10-24T22:25:00Z") / 1000),
  );
});

test("failed conversions preserve discovery and refuse reused release IDs", async () => {
  await build();
  const original = await readFile(path.join(output, "manifest.json"), "utf8");
  await expect(build()).rejects.toThrow("Release ID already exists");
  await writeFile(
    path.join(feed, "frequencies.txt"),
    "trip_id,start_time,end_time,headway_secs\nt/through,08:00:00,09:00:00,600\n",
  );
  await expect(
    build("linked-connections-v2-alpha", ["--release-id", "another"]),
  ).rejects.toThrow("Unsupported GTFS feature");
  expect(await readFile(path.join(output, "manifest.json"), "utf8")).toBe(
    original,
  );
});

test("rejects duplicate sequences and untimed interior calls", async () => {
  const file = path.join(feed, "stop_times.txt");
  const original = await readFile(file, "utf8");
  await writeFile(file, original.replace("B,20,", "B,10,"));
  await expect(build()).rejects.toThrow("Duplicate stop_sequence");
  await writeFile(file, original.replace("08:10:00,08:12:00,B", ",,B"));
  await expect(build()).rejects.toThrow("Untimed stop");
});

test("enforces collisions for custom URI templates", async () => {
  const config = structuredClone(
    require("../lib/arrow/identity-defaults.json"),
  );
  config.templates.stop = "{base}/constant";
  const file = path.join(root, "strategy.json");
  await writeFile(file, JSON.stringify(config));
  await expect(
    build("linked-connections-v2-alpha", ["--iri-strategy", file]),
  ).rejects.toThrow("IRI collision");
});

test("keeps calendar exceptions, terminal calls and one-stop runs", async () => {
  await writeFile(
    path.join(feed, "calendar.txt"),
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nservice,1,1,1,1,1,1,1,20261024,20261026\n",
  );
  await writeFile(
    path.join(feed, "calendar_dates.txt"),
    "service_id,date,exception_type\nservice,20261025,2\nservice,20261027,1\n",
  );
  const tripFile = path.join(feed, "trips.txt");
  await writeFile(
    tripFile,
    (await readFile(tripFile, "utf8")).trimEnd() +
      "\nR,service,t/single,Alpha,IC4,\n",
  );
  const stopFile = path.join(feed, "stop_times.txt");
  await writeFile(
    stopFile,
    (await readFile(stopFile, "utf8")).trimEnd() +
      "\nt/single,12:00:00,,A/1,999,0,0,\n",
  );
  const manifest = await build();
  const calls = [...(await table(manifest.files.calls))];
  const trips = [...(await table(manifest.files.trips))];
  expect(new Set(calls.map((c) => c.serviceDate))).toEqual(
    new Set([20261024, 20261026, 20261027]),
  );
  const single = calls.filter((c) => trips[c.tripIdx].tripId === "t/single");
  expect(single).toHaveLength(3);
  expect(
    single.every((c) => c.stopSequence === 999 && c.departureTime === null),
  ).toBe(true);
  expect(
    manifest.files.planning.reduce((sum, page) => sum + page.rowCount, 0),
  ).toBe(15);
});

test("isolates disk stores and honors explicit identity and transfer configuration", async () => {
  const manifest = await build("irail-cdn-v1", [
    "--source-id",
    "be.sncb",
    "--id-base",
    "https://ids.example.test/transit",
    "--default-transfer-time",
    "0",
    "--store",
    "LevelStore",
  ]);
  expect(manifest.identityBase).toBe("https://ids.example.test/transit");
  const stops = [...(await table(manifest.files.stops))];
  expect(
    stops.every((stop) =>
      stop.iri.startsWith("https://ids.example.test/transit/be.sncb/"),
    ),
  ).toBe(true);
  expect(stops.find((stop) => stop.stopId === "A").minTransferTime).toBe(0);
  expect(stops.find((stop) => stop.stopId === "B").minTransferTime).toBe(120);
  const { readdir } = require("node:fs/promises");
  expect(
    (await readdir(output)).some((name) => name.startsWith(".arrow-")),
  ).toBe(false);
});

test("does not publish a partial release after a late validation failure", async () => {
  await build();
  const original = await readFile(path.join(output, "manifest.json"), "utf8");
  const file = path.join(feed, "stop_times.txt");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace("B,20,", "B,10,"),
  );
  await expect(
    build("linked-connections-v2-alpha", ["--release-id", "broken"]),
  ).rejects.toThrow("Duplicate stop_sequence");
  expect(await readFile(path.join(output, "manifest.json"), "utf8")).toBe(
    original,
  );
  const { readdir } = require("node:fs/promises");
  expect(await readdir(path.join(output, "releases"))).toEqual([
    "test-release",
  ]);
  expect(
    (await readdir(output)).some((name) => name.startsWith(".arrow-")),
  ).toBe(false);
});

test("rejects duplicate dictionary IDs and foreign-key orphans", async () => {
  const file = path.join(feed, "stops.txt");
  const original = await readFile(file, "utf8");
  await writeFile(file, original.trimEnd() + "\nA,Duplicate,50,4,1,,\n");
  await expect(build()).rejects.toThrow("Duplicate stop_id");
  await writeFile(file, original);
  const times = path.join(feed, "stop_times.txt");
  await writeFile(
    times,
    (await readFile(times, "utf8")).replace("B,20,", "missing,20,"),
  );
  await expect(build()).rejects.toThrow("Unknown stop-time stop");
});

test("the independent HTTP consumer verifies hashes and release metadata", async () => {
  const { readRelease } = require("../examples/read-arrow");
  const manifest = await build();
  const fetcher = async (url) => {
    const pathname = new URL(url).pathname;
    const data = await readFile(path.join(output, pathname));
    return new Response(data);
  };
  const release = await readRelease(
    "https://data.example.test/manifest.json",
    fetcher,
  );
  expect((await release.load(manifest.files.calls, "calls")).numRows).toBe(16);
  await expect(
    release.load({ ...manifest.files.calls, sha256: "0".repeat(64) }, "calls"),
  ).rejects.toThrow("hash mismatch");
  await expect(release.load(manifest.files.calls, "stops")).rejects.toThrow(
    "dataset mismatch",
  );
});

test("external sorting preserves equal-departure ordering across independent pages", async () => {
  const { PlanningSpool } = require("../lib/arrow/merge");
  const spool = new PlanningSpool(path.join(root, "spool"), [
    { regionIdx: 0 },
    { regionIdx: 1 },
  ]);
  const epoch = Date.parse("2026-11-07T06:00:00Z") / 1000;
  for (let i = 50002; i >= 0; i--)
    await spool.add({
      departureStopIdx: 0,
      arrivalStopIdx: 1,
      departureTime: epoch + 10,
      arrivalTime: epoch + 21601,
      tripIdx: i,
      serviceDate: 20261107,
      stopSequence: 10,
    });
  const sizes = [];
  let previous = -1;
  const pages = await spool.publish(async (_name, file, rows, metadata) => {
    sizes.push(rows.length);
    expect(metadata.epochSeconds).toBe(String(epoch));
    for (const row of rows) {
      expect(row.tripIdx).toBe(previous + 1);
      expect(row.arrivalTimeOffset).toBe(21601);
      previous = row.tripIdx;
    }
    return { path: file, rowCount: rows.length };
  });
  expect(sizes).toEqual([50000, 3]);
  expect(
    pages.every(
      (page) =>
        page.minDepartureTime === epoch + 10 &&
        page.maxDepartureTime === epoch + 10 &&
        page.arrivalRegions.join() === "1",
    ),
  ).toBe(true);
}, 30000);
