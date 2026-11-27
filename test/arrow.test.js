const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  mkdtemp,
  mkdir,
  cp,
  readFile,
  readdir,
  rm,
  writeFile,
} = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { tableFromIPC } = require("apache-arrow");
const { definitions } = require("../lib/arrow/schema");
const { serviceEpoch } = require("../lib/arrow/time");
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
  return JSON.parse(
    await readFile(path.join(output, "manifest.jsonld"), "utf8"),
  );
}
function local(resource) {
  const iri = typeof resource === "string" ? resource : resource["@id"];
  return path.join(output, iri.replace(/^\/data\//, "/").slice(1));
}
async function table(resource) {
  return tableFromIPC(await readFile(local(resource)));
}

async function connectionRows(manifest) {
  const rows = [];
  for (const page of manifest.connections.pages) {
    for (const row of await table(page))
      rows.push({
        ...row.toJSON(),
        departureTime: page.epochSeconds + row.departureTimeOffset,
        arrivalTime: page.epochSeconds + row.arrivalTimeOffset,
      });
  }
  return rows;
}

test.each(["linked-connections-v2-alpha", "irail-cdn-v1"])(
  "publishes the draft's JSON-LD manifest and exact core schemas (%s)",
  async (profile) => {
    const manifest = await build(profile);
    expect(manifest).toMatchObject({
      "@context":
        "https://linkedconnections.org/specification/2-0-alpha/context.jsonld",
      "@id":
        profile === "irail-cdn-v1"
          ? "/data/manifest.jsonld"
          : "/manifest.jsonld",
      "@type": "Timetable",
      schemaVersion: "2-alpha",
      releaseId: "test-release",
      timeZone: "Europe/Brussels",
      connections: { "@type": "ConnectionCollection" },
    });
    expect(manifest.license).toBeUndefined();
    expect(manifest.rights).toBeUndefined();
    expect(manifest.files).toBeUndefined();
    expect(manifest.format).toBeUndefined();
    expect(manifest.version).toBeUndefined();
    expect(manifest.connections.paginationStrategy).toBeUndefined();
    const prefix = profile === "irail-cdn-v1" ? "/data" : "";
    for (const name of ["stops", "trips", "routes", "transfers"])
      expect(manifest[name]).toBe(
        `${prefix}/releases/test-release/${name}.arrow`,
      );
    for (const page of manifest.connections.pages)
      expect(Object.keys(page).sort()).toEqual([
        "@id",
        "@type",
        "arrivalRegions",
        "epochSeconds",
        "maxDepartureTime",
        "minDepartureTime",
        "region",
      ]);
    const expected = {
      connections: [
        "departureStopIdx:Int32",
        "arrivalStopIdx:Int32",
        "departureTimeOffset:Uint32",
        "arrivalTimeOffset:Uint32",
        "tripIdx:Int32",
        "pickupType:Uint8",
        "dropOffType:Uint8",
        "serviceDate:Uint32",
        "stopSequence:Uint32",
        "arrivalStopSequence:Uint32",
        "iri:Utf8",
      ],
      stops: [
        "name:Utf8?",
        "lat:Float64?",
        "lon:Float64?",
        "parentIdx:Int32",
        "minTransferTime:Uint32",
        "iri:Utf8",
        "regionIri:Utf8?",
      ],
      trips: [
        "routeIdx:Int32",
        "headsign:Utf8?",
        "shortName:Utf8?",
        "iri:Utf8",
      ],
      routes: [
        "shortName:Utf8?",
        "longName:Utf8?",
        "routeType:Int32",
        "iri:Utf8",
      ],
      transfers: [
        "fromStopIdx:Int32?",
        "toStopIdx:Int32?",
        "transferType:Uint8",
        "minTransferTime:Uint32?",
        "fromTripIdx:Int32?",
        "toTripIdx:Int32?",
        "fromRouteIdx:Int32?",
        "toRouteIdx:Int32?",
      ],
    };
    expect(Object.keys(definitions)).toEqual(Object.keys(expected));
    const tables = {};
    for (const [name, schema] of Object.entries(expected)) {
      const resources =
        name === "connections" ? manifest.connections.pages : [manifest[name]];
      tables[name] = [];
      for (const resource of resources) {
        const bytes = await readFile(local(resource));
        expect(bytes.subarray(0, 6).toString()).toBe("ARROW1");
        expect(bytes.subarray(-6).toString()).toBe("ARROW1");
        const data = tableFromIPC(bytes);
        expect(
          data.schema.fields.map(
            (f) => `${f.name}:${f.type}${f.nullable ? "?" : ""}`,
          ),
        ).toEqual(schema);
        expect(data.schema.metadata.get("dataset")).toBe(name);
        expect(data.schema.metadata.get("schemaVersion")).toBe("2-alpha");
        expect(data.schema.metadata.get("format")).toBe("linked-connections");
        expect(data.schema.metadata.get("releaseId")).toBe(manifest.releaseId);
        if (name === "connections") {
          const departures = [...data].map(
            (r) => resource.epochSeconds + r.departureTimeOffset,
          );
          expect(departures).toEqual([...departures].sort((a, b) => a - b));
          expect(Date.parse(resource.minDepartureTime) / 1000).toBe(
            departures[0],
          );
          expect(Date.parse(resource.maxDepartureTime) / 1000).toBe(
            departures.at(-1),
          );
          expect(data.schema.metadata.get("epochSeconds")).toBe(
            String(resource.epochSeconds),
          );
          expect(data.schema.metadata.get("region")).toBe(resource.region);
        }
        tables[name].push(...data);
      }
    }
    expect(tables.connections).toHaveLength(10);
    expect(tables.stops).toHaveLength(4);
    expect(tables.trips).toHaveLength(3);
    expect(tables.routes).toHaveLength(1);
    expect(tables.transfers).toHaveLength(1);
    const identityBase =
      profile === "irail-cdn-v1"
        ? "https://irail.be/id"
        : "https://example.org/id";
    expect(
      tables.trips.every((trip) =>
        trip.iri.startsWith(`${identityBase}/demo.fixture/trips/`),
      ),
    ).toBe(true);
    expect(
      (await readdir(path.join(output, "releases/test-release"))).sort(),
    ).toEqual([
      "connections",
      "manifest.jsonld",
      "routes.arrow",
      "stops.arrow",
      "transfers.arrow",
      "trips.arrow",
    ]);
    expect(new Set(tables.connections.map((r) => r.iri)).size).toBe(10);
    for (const page of manifest.connections.pages) {
      const arrivals = new Set();
      for (const row of await table(page)) {
        expect(row.arrivalTimeOffset).toBeGreaterThanOrEqual(
          row.departureTimeOffset,
        );
        expect(row.arrivalStopSequence).toBeGreaterThan(row.stopSequence);
        expect(tables.stops[row.departureStopIdx].regionIri).toBe(page.region);
        arrivals.add(tables.stops[row.arrivalStopIdx].regionIri);
        expect(tables.routes[tables.trips[row.tripIdx].routeIdx]).toBeDefined();
      }
      expect(page.arrivalRegions).toEqual([...arrivals].sort());
    }
    const rows = await connectionRows(manifest);
    expect(Date.parse(manifest.coverageStart) / 1000).toBe(
      Math.min(...rows.map((r) => r.departureTime)),
    );
    expect(Date.parse(manifest.coverageEnd) / 1000).toBe(
      Math.max(...rows.map((r) => r.departureTime)) + 1,
    );
    expect(
      await readFile(
        path.join(output, "releases/test-release/manifest.jsonld"),
        "utf8",
      ),
    ).toBe(await readFile(path.join(output, "manifest.jsonld"), "utf8"));
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

test("core connections retain after-midnight service dates, sequences and boarding restrictions", async () => {
  const file = path.join(feed, "stop_times.txt");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace("B,5,1,0,", "B,5,2,3,"),
  );
  const manifest = await build("linked-connections-v2-alpha", [
    "--start-date",
    "20261024",
    "--end-date",
    "20261024",
  ]);
  const rows = await connectionRows(manifest);
  expect(new Set(rows.map((r) => r.serviceDate))).toEqual(new Set([20261024]));
  const loop = rows.filter((r) => r.iri.includes("t%2Floop"));
  expect(loop.map((r) => [r.stopSequence, r.arrivalStopSequence])).toEqual([
    [1, 5],
    [5, 9],
  ]);
  expect(loop[0].dropOffType).toBe(3);
  expect(loop[1].pickupType).toBe(2);
  expect(loop[1].arrivalTime).toBe(Date.parse("2026-10-24T22:25:00Z") / 1000);
});

test("unpartitioned releases use null region IRIs and readable empty transfers", async () => {
  await writeFile(
    path.join(feed, "transfers.txt"),
    "from_stop_id,to_stop_id,transfer_type\n",
  );
  const manifest = await build("linked-connections-v2-alpha", [
    "--regions",
    "1",
  ]);
  expect((await table(manifest.transfers)).numRows).toBe(0);
  expect(
    [...(await table(manifest.stops))].every((s) => s.regionIri === null),
  ).toBe(true);
  for (const page of manifest.connections.pages) {
    expect(page.region).toBeUndefined();
    expect(page.arrivalRegions).toBeUndefined();
    expect((await table(page)).schema.metadata.has("region")).toBe(false);
  }
});

test("region IRIs describe cross-region rides and arrival page selection", async () => {
  const stops = path.join(feed, "stops.txt");
  await writeFile(
    stops,
    (await readFile(stops, "utf8")).replace(
      "C,Gamma,50.84,4.34",
      "C,Gamma,52,5",
    ) + "\nU,Upsilon,52,5,0,,\nV,Valley,52.01,5,0,,\n",
  );
  const trips = path.join(feed, "trips.txt");
  await writeFile(
    trips,
    (await readFile(trips, "utf8")) + "\nR,service,t/remote,Valley,IC4,\n",
  );
  const times = path.join(feed, "stop_times.txt");
  await writeFile(
    times,
    (await readFile(times, "utf8")) +
      "\nt/remote,,08:00:00,U,10,0,0,\nt/remote,08:30:00,,V,20,0,0,\n",
  );
  const manifest = await build();
  const regions = new Set(
    [...(await table(manifest.stops))].map((s) => s.regionIri),
  );
  expect(regions.size).toBe(2);
  expect(
    manifest.connections.pages.some((p) =>
      p.arrivalRegions.some((r) => r !== p.region),
    ),
  ).toBe(true);
  const rows = await connectionRows(manifest);
  expect(rows).toHaveLength(12);
  expect(new Set(rows.map((r) => r.iri)).size).toBe(12);
});

test.each(["linked-connections-v2-alpha", "irail-cdn-v1"])(
  "preserves linked trips for splits, joins and forbidden in-seat transfers (%s)",
  async (profile) => {
    await writeFile(
      path.join(feed, "transfers.txt"),
      "from_stop_id,to_stop_id,transfer_type,min_transfer_time,from_trip_id,to_trip_id\nB,B,2,120,,\n,,4,,t/through,t/shuttle\n,,4,,t/through,t/loop\nC,B,4,,t/loop,t/shuttle\n,,5,,t/shuttle,t/loop\n",
    );
    const manifest = await build(profile);
    const transfers = [...(await table(manifest.transfers))];
    const trips = [...(await table(manifest.trips))];
    expect(transfers.map((r) => r.transferType)).toEqual([2, 4, 4, 4, 5]);
    for (const row of transfers.slice(1)) {
      expect(row.minTransferTime).toBeNull();
      expect(trips[row.fromTripIdx]).toBeDefined();
      expect(trips[row.toTripIdx]).toBeDefined();
    }
    expect(transfers[1].fromStopIdx).toBeNull();
    expect(transfers[1].toStopIdx).toBeNull();
    expect(transfers[1].fromTripIdx).toBe(transfers[2].fromTripIdx);
    expect(transfers[1].toTripIdx).toBe(transfers[3].toTripIdx);
    expect(transfers[3].fromStopIdx).not.toBeNull();
  },
);

test.each([
  [",,4,,,t/shuttle", "requires both trips"],
  [",,5,0,t/through,t/shuttle", "must be null"],
  ["A,B,4,,t/through,t/shuttle", "must be stops"],
  [",,4,,unknown,t/shuttle", "Unknown transfer Trip"],
  [",,2,120,,", "Unknown transfer stop"],
  ["B,B,6,,,", "Unsupported transfer_type"],
])("rejects invalid transfer row %s", async (row, error) => {
  await writeFile(
    path.join(feed, "transfers.txt"),
    `from_stop_id,to_stop_id,transfer_type,min_transfer_time,from_trip_id,to_trip_id\n${row}\n`,
  );
  await expect(build()).rejects.toThrow(error);
});

test.each(["linked-connections-v2-alpha", "irail-cdn-v1"])(
  "publishes optional legal metadata and validates linked GTFS Realtime templates (%s)",
  async (profile) => {
    const feeds = [
      {
        "@id": "https://data.example.test/trip-updates",
        "@type": "GtfsRealtimeFeed",
        tripTemplate: "https://example.org/id/demo.fixture/trips/{trip_id}",
        stopTemplate: "https://example.org/id/demo.fixture/stops/{stop_id}",
        routeTemplate: "https://example.org/id/demo.fixture/routes/{route_id}",
      },
    ];
    const file = path.join(root, "realtime.json");
    await writeFile(file, JSON.stringify(feeds));
    const manifest = await build(profile, [
      "--id-base",
      "https://example.org/id",
      "--license",
      "https://example.test/license",
      "--rights",
      "Demo Transit attribution",
      "--realtime",
      file,
    ]);
    expect(manifest.license).toBe("https://example.test/license");
    expect(manifest.rights).toBe("Demo Transit attribution");
    expect(manifest.realtime).toEqual(feeds);
    feeds[0].tripTemplate = "https://example.org/incorrect/{trip_id}";
    await writeFile(file, JSON.stringify(feeds));
    await expect(
      build(profile, ["--release-id", "bad-feed", "--realtime", file]),
    ).rejects.toThrow("does not reproduce trip IRI");
    expect(
      JSON.parse(await readFile(path.join(output, "manifest.jsonld"), "utf8")),
    ).toEqual(manifest);
  },
);

test("the iRail preset filters service days without losing terminal arrivals", async () => {
  const manifest = await build("irail-cdn-v1", [
    "--start-date",
    "20261024",
    "--end-date",
    "20261024",
  ]);
  const rows = await connectionRows(manifest);
  expect(new Set(rows.map((c) => c.serviceDate))).toEqual(new Set([20261024]));
  const loop = rows.filter(
    (c) => c.iri.includes("t%2Floop") && c.arrivalStopSequence === 9,
  );
  expect(loop[0].arrivalTime).toBe(Date.parse("2026-10-24T22:25:00Z") / 1000);
});

test("failed conversions preserve discovery and refuse reused release IDs", async () => {
  await build();
  const original = await readFile(path.join(output, "manifest.jsonld"), "utf8");
  await expect(build()).rejects.toThrow("Release ID already exists");
  await writeFile(
    path.join(feed, "frequencies.txt"),
    "trip_id,start_time,end_time,headway_secs\nt/through,08:00:00,09:00:00,600\n",
  );
  await expect(
    build("linked-connections-v2-alpha", ["--release-id", "another"]),
  ).rejects.toThrow("Unsupported GTFS feature");
  expect(await readFile(path.join(output, "manifest.jsonld"), "utf8")).toBe(
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

test("keeps calendar exceptions and terminal arrivals while one-stop runs add no connections", async () => {
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
  const manifest = await build("irail-cdn-v1");
  const rows = await connectionRows(manifest);
  const trips = [...(await table(manifest.trips))];
  expect(new Set(rows.map((c) => c.serviceDate))).toEqual(
    new Set([20261024, 20261026, 20261027]),
  );
  const singleIdx = trips.findIndex((trip) => trip.iri.endsWith("/t%2Fsingle"));
  expect(singleIdx).toBeGreaterThanOrEqual(0);
  expect(rows.some((row) => row.tripIdx === singleIdx)).toBe(false);
  expect(
    rows.filter(
      (row) => row.iri.includes("t%2Floop") && row.arrivalStopSequence === 9,
    ),
  ).toHaveLength(3);
  expect(rows).toHaveLength(15);
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
  const stops = [...(await table(manifest.stops))];
  expect(
    stops.every((stop) =>
      stop.iri.startsWith("https://ids.example.test/transit/be.sncb/"),
    ),
  ).toBe(true);
  expect(stops.find((stop) => stop.iri.endsWith("/A")).minTransferTime).toBe(0);
  expect(stops.find((stop) => stop.iri.endsWith("/B")).minTransferTime).toBe(
    120,
  );
  expect(
    (await readdir(output)).some((name) => name.startsWith(".arrow-")),
  ).toBe(false);
});

test("does not publish a partial release after a late validation failure", async () => {
  await build();
  const original = await readFile(path.join(output, "manifest.jsonld"), "utf8");
  const file = path.join(feed, "stop_times.txt");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace("B,20,", "B,10,"),
  );
  await expect(
    build("linked-connections-v2-alpha", ["--release-id", "broken"]),
  ).rejects.toThrow("Duplicate stop_sequence");
  expect(await readFile(path.join(output, "manifest.jsonld"), "utf8")).toBe(
    original,
  );
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

test.each(["linked-connections-v2-alpha", "irail-cdn-v1"])(
  "the independent HTTP consumer follows table IRIs and checks page and release metadata (%s)",
  async (profile) => {
    const { readRelease } = require("../examples/read-arrow");
    const manifest = await build(profile);
    const fetcher = async (url) => {
      const pathname = new URL(url).pathname;
      const data = await readFile(local({ "@id": pathname }));
      return new Response(data);
    };
    const release = await readRelease(
      new URL(manifest["@id"], "https://data.example.test").href,
      fetcher,
    );
    for (const [dataset, count] of [
      ["stops", 4],
      ["trips", 3],
      ["routes", 1],
      ["transfers", 1],
    ])
      expect((await release.load(manifest[dataset], dataset)).numRows).toBe(
        count,
      );
    await expect(release.load(manifest.stops, "trips")).rejects.toThrow(
      "dataset mismatch",
    );
    const page = manifest.connections.pages[0];
    expect(
      (await release.load({ "@id": page["@id"] }, "connections")).numRows,
    ).toBe(3);
    await expect(
      release.load(
        { ...page, epochSeconds: page.epochSeconds + 1 },
        "connections",
      ),
    ).rejects.toThrow("epochSeconds mismatch");
    await expect(
      release.load(
        { ...page, minDepartureTime: "2000-01-01T00:00:00Z" },
        "connections",
      ),
    ).rejects.toThrow("minDepartureTime mismatch");
    const manifestUrl = new URL(manifest["@id"], "https://data.example.test")
      .href;
    const wrongRelease = await readRelease(manifestUrl, async (url) =>
      String(url) === manifestUrl
        ? Response.json({ ...manifest, releaseId: "different-release" })
        : fetcher(url),
    );
    await expect(wrongRelease.load(manifest.stops, "stops")).rejects.toThrow(
      "releaseId mismatch",
    );
    const corrupt = await readRelease(manifestUrl, async (url) =>
      String(url) === manifestUrl
        ? fetcher(url)
        : new Response("invalid IPC file"),
    );
    await expect(corrupt.load(manifest.stops, "stops")).rejects.toThrow(
      "Expected an Arrow IPC file",
    );
    const redirectedResponse = Response.json({
      ...manifest,
      stops: "releases/test-release/stops.arrow",
    });
    Object.defineProperty(redirectedResponse, "url", { value: manifestUrl });
    const redirectedUrl = "https://data.example.test/lookup/current";
    const redirected = await readRelease(redirectedUrl, async (url) =>
      String(url) === redirectedUrl ? redirectedResponse : fetcher(url),
    );
    expect(
      (await redirected.load(redirected.manifest.stops, "stops")).numRows,
    ).toBe(4);
  },
);

test("the source index discovers LC2 manifests and ignores legacy-only datasets", async () => {
  await build();
  await mkdir(path.join(root, "old-data"));
  await writeFile(
    path.join(root, "old-data", "manifest.json"),
    JSON.stringify({ format: "irail-cdn", version: 1 }),
  );
  await run(process.execPath, [
    path.join(__dirname, "../bin/gtfs2lc-sources-index.js"),
    root,
  ]);
  expect(
    JSON.parse(await readFile(path.join(root, "sources.json"), "utf8")),
  ).toEqual({
    sources: [{ id: "data", name: "data", manifest: "data/manifest.jsonld" }],
  });
});

test("external sorting preserves equal-departure ordering across independent pages", async () => {
  const { PlanningSpool } = require("../lib/arrow/merge");
  const spool = new PlanningSpool(path.join(root, "spool"), [
    { regionIdx: 0, regionIri: "https://example.test/north" },
    { regionIdx: 1, regionIri: "https://example.test/south" },
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
    return file;
  });
  expect(sizes).toEqual([50000, 3]);
  expect(
    pages.every(
      (page) =>
        page.minDepartureTime === new Date((epoch + 10) * 1000).toISOString() &&
        page.maxDepartureTime === new Date((epoch + 10) * 1000).toISOString() &&
        page.region === "https://example.test/north" &&
        page.arrivalRegions.join() === "https://example.test/south",
    ),
  ).toBe(true);
}, 30000);
