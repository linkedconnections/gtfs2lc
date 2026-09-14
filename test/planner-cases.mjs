import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, URL } from "node:url";
import { Worker } from "node:worker_threads";
import { gzipSync } from "node:zlib";
import { createPlanner } from "../public/planner-core.mjs";
import { buildNetwork, WALK_SPEED } from "../public/planner-network.mjs";
import { computeProfile } from "../public/planner-profile.mjs";
import { computeIsochrone } from "../public/planner-isochrone.mjs";
import {
  PageCache,
  readConnectionBatches,
  scanBackward,
} from "../public/planner-data.mjs";
import { LoaderPool } from "../public/planner-loader-pool.mjs";
import { PlannerClient } from "../public/planner-client.mjs";

const require = createRequire(import.meta.url);
const arrow = require("apache-arrow");
const { timePartitionKey } = require("../lib/arrow/partitioning.js");
const {
  CONNECTIONS_SCHEMA,
  buildRecordBatch,
} = require("../lib/arrow/schema.js");
const planner = createPlanner(arrow);
const seconds = (date) => Date.parse(date) / 1000;
const start = seconds("2026-09-14T06:00:00Z");

function connections(rows) {
  const vectors = {};
  for (const field of CONNECTIONS_SCHEMA.fields) {
    const times = field.name.endsWith("Time");
    const values = rows.map((r) => r[field.name] ?? 0);
    vectors[field.name] = times
      ? arrow.makeVector(
          arrow.makeData({
            type: new arrow.TimestampSecond(),
            data: BigInt64Array.from(values, BigInt),
          }),
        )
      : arrow.makeVector(
          field.name.endsWith("Type")
            ? Uint8Array.from(values)
            : Int32Array.from(values),
        );
  }
  return new arrow.Table(buildRecordBatch(CONNECTIONS_SCHEMA, vectors));
}

async function fixture(compressed = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "planner-test-"));
  const stops = arrow.tableFromArrays({
    stopId: ["origin", "interchange", "destination"],
    name: ["Origin", "Interchange", "Destination"],
    lat: new Float64Array([51, 51.01, 51.02]),
    lon: new Float64Array([4, 4.01, 4.02]),
    parentIdx: new Int32Array([-1, -1, -1]),
    regionIdx: new Int32Array([0, 0, 0]),
  });
  const trips = arrow.tableFromArrays({
    tripId: ["t0", "t1", "t2", "t3"],
    routeIdx: new Int32Array([0, 0, 0, 0]),
    headsign: ["Destination", "Destination", "Destination", "Destination"],
  });
  const routes = arrow.tableFromArrays({
    routeId: ["r0"],
    shortName: ["IC"],
    longName: ["Intercity"],
  });
  for (const [name, table] of Object.entries({ stops, trips, routes })) {
    await writeFile(
      path.join(directory, `${name}.arrow`),
      arrow.tableToIPC(table),
    );
  }
  const rows = [
    // Before the query, then a useful direct ride and a later two-leg ride.
    {
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start - 1,
      arrivalTime: start + 10,
      tripIdx: 0,
    },
    {
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start,
      arrivalTime: start + 100,
      tripIdx: 0,
    },
    {
      departureStopIdx: 0,
      arrivalStopIdx: 1,
      departureTime: start + 21600,
      arrivalTime: start + 21700,
      tripIdx: 1,
    },
    {
      departureStopIdx: 1,
      arrivalStopIdx: 2,
      departureTime: start + 21800,
      arrivalTime: start + 21900,
      tripIdx: 2,
    },
    // Departs inside the window but arrives outside it: must not appear.
    {
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start + 86390,
      arrivalTime: start + 86410,
      tripIdx: 3,
    },
    {
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start + 86400,
      arrivalTime: start + 86500,
      tripIdx: 3,
    },
  ];
  const relative = `partitions/0/2026-09.arrow${compressed ? ".gz" : ""}`;
  await mkdir(path.join(directory, "partitions/0"), { recursive: true });
  const data = arrow.tableToIPC(connections(rows));
  await writeFile(
    path.join(directory, relative),
    compressed ? gzipSync(data) : data,
  );
  const manifest = {
    format: "gtfs2lc-arrow-connections",
    version: 3,
    compressed,
    counts: { stops: 3, routes: 1, trips: 4 },
    files: {
      stops: "stops.arrow",
      trips: "trips.arrow",
      routes: "routes.arrow",
    },
    connections: { months: ["2026-09"], files: { 0: { "2026-09": relative } } },
  };
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
  return { directory, rows };
}

test("UTC buckets match the producer across midnight, month/year boundaries and DST", () => {
  const manifest = { connections: { timePartitionSeconds: 21600 } };
  for (const date of [
    "2026-09-14T06:00:00Z",
    "2026-09-30T23:00:00Z",
    "2026-12-31T23:00:00Z",
    "2026-10-25T00:30:00Z",
  ]) {
    const from = seconds(date);
    const keys = planner.partitionsInRange(manifest, from, from + 86400);
    assert.equal(keys.length, from % 21600 === 0 ? 4 : 5);
    assert.equal(keys[0], timePartitionKey(from));
    assert.equal(keys.at(-1), timePartitionKey(from + 86400 - 1));
    for (let t = from; t < from + 86400; t += 60)
      assert.ok(keys.includes(timePartitionKey(t)));
  }
  assert.deepEqual(
    planner.partitionsInRange(
      { connections: {} },
      seconds("2026-09-30T23:00:00Z"),
      seconds("2026-10-01T23:00:00Z"),
    ),
    ["2026-09", "2026-10"],
  );
  assert.deepEqual(
    planner.partitionsInRange(
      { connections: {} },
      seconds("2026-09-30T00:00:00Z"),
      seconds("2026-10-01T00:00:00Z"),
    ),
    ["2026-09"],
  );
});

// Run the actual worker entry and message protocol in a real thread. Only the
// CDN import and browser transport/fetch are adapted to Node for this test.
async function startWorker(directory) {
  const bootstrap = `
    const { parentPort, Worker: NodeWorker, workerData } = require("node:worker_threads");
    const fs = require("node:fs");
    const path = require("node:path");
    const { pathToFileURL, fileURLToPath } = require("node:url");
    const bootstrap = workerData.bootstrap;
    global.self = {
      addEventListener: (_, handler) => parentPort.on("message", data => handler({data})),
      postMessage: (data, transfer) => parentPort.postMessage(data, transfer),
    };
    global.Worker = class {
      constructor(url) {
        this.worker = new NodeWorker(bootstrap, {eval: true, workerData: {...workerData, entry: url.href}});
      }
      addEventListener(type, handler) {
        this.worker.on(type, type === "message" ? data => {
          if (data.fetched) parentPort.postMessage(data);
          else handler({data});
        } : handler);
      }
      postMessage(data, transfer) { this.worker.postMessage(data, transfer); }
      terminate() { return this.worker.terminate(); }
    };
    global.fetch = async url => {
      parentPort.postMessage({ fetched: url });
      try { return new Response(await fs.promises.readFile(path.join(workerData.directory, url))); }
      catch { return new Response("missing", {status:404}); }
    };
    let entry = fs.readFileSync(fileURLToPath(workerData.entry), "utf8");
    entry = entry.replaceAll('"https://cdn.jsdelivr.net/npm/apache-arrow@21.2.0/+esm"', JSON.stringify(workerData.arrow));
    entry = entry.replace(/from "(\\.\\/[^"]+)"/g, (_, specifier) => 'from ' + JSON.stringify(new URL(specifier, workerData.entry).href));
    entry = entry.replaceAll("import.meta.url", JSON.stringify(workerData.entry));
    import('data:text/javascript;base64,' + Buffer.from(entry).toString('base64')).catch(error => {throw error;});
  `;
  const worker = new Worker(bootstrap, {
    eval: true,
    workerData: {
      bootstrap,
      directory,
      entry: new URL("../public/planner-worker.mjs", import.meta.url).href,
      arrow: pathToFileURL(require.resolve("apache-arrow")).href,
    },
  });
  const fetched = [];
  worker.on("message", (data) => {
    if (data.fetched) fetched.push(data.fetched);
  });
  const adapter = {
    addEventListener(type, listener) {
      worker.on(
        type,
        type === "message" ? (data) => listener({ data }) : listener,
      );
    },
    postMessage: (data) => worker.postMessage(data),
    terminate: () => worker.terminate(),
  };
  return { client: new PlannerClient(adapter), fetched, worker };
}

for (const [partitioned, compressed] of [
  [false, false],
  [true, false],
  [true, true],
])
  test(`worker plans a 24-hour window, caches data, and loads labels lazily (v${partitioned ? 4 : 3}, gzip=${compressed})`, async () => {
    const { directory, rows } = await fixture(compressed);
    let worker;
    try {
      if (partitioned) {
        const manifestPath = path.join(directory, "manifest.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const groups = Map.groupBy(rows, (row) =>
          timePartitionKey(row.departureTime),
        );
        const files = {};
        for (const [period, periodRows] of groups) {
          const relative = `partitions/0/${period}.arrow${compressed ? ".gz" : ""}`;
          const bytes = arrow.tableToIPC(connections(periodRows));
          await writeFile(
            path.join(directory, relative),
            compressed ? gzipSync(bytes) : bytes,
          );
          files[period] = relative;
        }
        manifest.version = 4;
        manifest.connections = {
          timePartitionSeconds: 21600,
          periods: [...groups.keys()],
          files: { 0: files },
        };
        await writeFile(manifestPath, JSON.stringify(manifest));
      }
      const running = await startWorker(directory);
      worker = running.worker;
      const { client, fetched } = running;
      const sources = await client.request("init");
      assert.equal(sources.length, 1);
      assert.deepEqual(fetched, [
        "sources.json",
        "manifest.json",
        "stops.arrow",
      ]);
      assert.equal(sources[0].connectionsCache, undefined);
      assert.equal(sources[0].trips, undefined);
      const request = {
        origin: { sourceId: "default", stopIdx: 0 },
        destination: { sourceId: "default", stopIdx: 2 },
        departureAfter: start,
        maxWalkMeters: 500,
      };
      const progress = [];
      const result = await client.request("plan", request, (data) =>
        progress.push(data),
      );
      assert.equal(result.found, true);
      assert.equal(result.scanned, 4);
      assert.equal(result.options.length, 2);
      assert.equal(result.options[0].arrival, start + 100);
      assert.equal(result.options[1].arrival, start + 21900);
      assert.equal(result.options[0].legs[0].routeName, "IC");
      assert.ok(progress.length > 0);
      assert.ok(fetched.includes("trips.arrow"));
      if (partitioned)
        assert.ok(!fetched.includes("partitions/0/2026-09-15T06.arrow"));
      const count = fetched.length;
      assert.deepEqual(await client.request("plan", request), result);
      assert.equal(fetched.length, count);
      await assert.rejects(
        client.request("unknown"),
        /Unknown planner request/,
      );
      assert.deepEqual(await client.request("plan", request), result);
    } finally {
      if (worker) await worker.terminate();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("worker failure rejects pending and subsequent requests", async () => {
  const listeners = {};
  let terminated = false;
  const client = new PlannerClient({
    addEventListener: (type, fn) => (listeners[type] = fn),
    postMessage() {},
    terminate() {
      terminated = true;
    },
  });
  const pending = client.request("init");
  listeners.error({ message: "Cannot load module" });
  await assert.rejects(pending, /Cannot load module/);
  await assert.rejects(client.request("plan"), /Cannot load module/);
  assert.equal(terminated, true);
});

test("worker returns both operators' labeled legs for a cross-source journey", async () => {
  const { directory } = await fixture();
  const second = await fixture();
  let worker;
  try {
    await cp(second.directory, path.join(directory, "b"), { recursive: true });
    const writeStops = async (folder, latitudes) => {
      const original = arrow.tableFromIPC(
        await readFile(path.join(folder, "stops.arrow")),
      );
      const columns = Object.fromEntries(
        original.schema.fields.map((f) => [f.name, original.getChild(f.name)]),
      );
      columns.lat = arrow.makeVector(new Float64Array(latitudes));
      columns.lon = arrow.makeVector(new Float64Array([4, 4, 4]));
      await writeFile(
        path.join(folder, "stops.arrow"),
        arrow.tableToIPC(new arrow.Table(columns)),
      );
    };
    // Only A's interchange and B's origin are within walking distance.
    await writeStops(directory, [50, 51, 52]);
    await writeStops(path.join(directory, "b"), [51, 53, 54]);
    await writeFile(
      path.join(directory, "b/partitions/0/2026-09.arrow"),
      arrow.tableToIPC(
        connections([
          {
            departureStopIdx: 0,
            arrivalStopIdx: 2,
            departureTime: start + 22000,
            arrivalTime: start + 22100,
            tripIdx: 0,
          },
        ]),
      ),
    );
    await writeFile(
      path.join(directory, "sources.json"),
      JSON.stringify({
        sources: [
          { id: "a", name: "A", manifest: "manifest.json" },
          { id: "b", name: "B", manifest: "b/manifest.json" },
        ],
      }),
    );
    const running = await startWorker(directory);
    worker = running.worker;
    await running.client.request("init");
    const result = await running.client.request("plan", {
      origin: { sourceId: "a", stopIdx: 0 },
      destination: { sourceId: "b", stopIdx: 2 },
      departureAfter: start,
      maxWalkMeters: 100,
    });
    assert.equal(result.found, true);
    assert.ok(result.options[0].legs.some((leg) => leg.kind === "walk"));
    assert.equal(result.options[0].arrival, start + 22100);
    assert.equal(
      result.options[0].legs.find((leg) => leg.kind === "walk").from.stopIdx,
      1,
    );
    assert.equal(
      result.options[0].legs.find((leg) => leg.kind === "walk").to.stopIdx,
      0,
    );
    assert.equal(result.options[0].legs[0].routeName, "IC");
    assert.equal(result.options[0].legs.at(-1).routeName, "IC");
  } finally {
    if (worker) await worker.terminate();
    await rm(directory, { recursive: true, force: true });
    await rm(second.directory, { recursive: true, force: true });
  }
});

async function multimodalFixture() {
  const { directory } = await fixture();
  const second = await fixture();
  await cp(second.directory, path.join(directory, "b"), { recursive: true });
  await rm(second.directory, { recursive: true, force: true });
  const configure = async (folder, latitudes, rows) => {
    const count = latitudes.length;
    const stops = arrow.tableFromArrays({
      stopId: Array.from({ length: count }, (_, i) => `s${i}`),
      name: Array.from({ length: count }, (_, i) => `Stop ${i}`),
      lat: new Float64Array(latitudes),
      lon: new Float64Array(count).fill(4),
      parentIdx: new Int32Array(count).fill(-1),
      regionIdx: new Int32Array(count),
    });
    await writeFile(path.join(folder, "stops.arrow"), arrow.tableToIPC(stops));
    await writeFile(
      path.join(folder, "partitions/0/2026-09.arrow"),
      arrow.tableToIPC(connections(rows)),
    );
    const manifest = JSON.parse(
      await readFile(path.join(folder, "manifest.json"), "utf8"),
    );
    manifest.counts.stops = count;
    await writeFile(
      path.join(folder, "manifest.json"),
      JSON.stringify(manifest),
    );
  };
  // A -> B -> A is fastest between A's endpoints. There are also B stops
  // near the origin and destination so access/egress walking can be tested.
  await configure(
    directory,
    [50, 51, 52, 53],
    [
      {
        departureStopIdx: 0,
        arrivalStopIdx: 3,
        departureTime: start + 10,
        arrivalTime: start + 1000,
        tripIdx: 0,
      },
      {
        departureStopIdx: 0,
        arrivalStopIdx: 1,
        departureTime: start + 100,
        arrivalTime: start + 200,
        tripIdx: 1,
      },
      {
        departureStopIdx: 2,
        arrivalStopIdx: 3,
        departureTime: start + 500,
        arrivalTime: start + 600,
        tripIdx: 2,
      },
    ],
  );
  await configure(
    path.join(directory, "b"),
    [51, 52, 50.001, 53.001],
    [
      {
        departureStopIdx: 0,
        arrivalStopIdx: 1,
        departureTime: start + 300,
        arrivalTime: start + 400,
        tripIdx: 0,
      },
      {
        departureStopIdx: 2,
        arrivalStopIdx: 3,
        departureTime: start + 700,
        arrivalTime: start + 800,
        tripIdx: 1,
      },
    ],
  );
  await writeFile(
    path.join(directory, "sources.json"),
    JSON.stringify({
      sources: [
        { id: "a", name: "A", manifest: "manifest.json" },
        { id: "b", name: "B", manifest: "b/manifest.json" },
      ],
    }),
  );
  return directory;
}

test("same-operator endpoints can use A–B–A and selected networks constrain the scan", async () => {
  const directory = await multimodalFixture();
  let worker;
  try {
    const running = await startWorker(directory);
    worker = running.worker;
    await running.client.request("init");
    const request = {
      origin: { sourceId: "a", stopIdx: 0 },
      destination: { sourceId: "a", stopIdx: 3 },
      departureAfter: start,
      maxWalkMeters: 0,
      sourceIds: ["a", "b"],
    };
    const result = await running.client.request("plan", request);
    const mixed = result.options.find((o) => o.arrival === start + 600);
    assert.ok(mixed);
    assert.deepEqual(
      mixed.legs.filter((l) => l.kind === "ride").map((l) => l.sourceId),
      ["a", "b", "a"],
    );
    assert.equal(mixed.transfers, 2);
    const restricted = await running.client.request("plan", {
      ...request,
      sourceIds: ["a"],
    });
    assert.equal(restricted.options[0].arrival, start + 1000);
    assert.ok(
      restricted.options.every((o) =>
        o.legs.every((l) => l.kind !== "ride" || l.sourceId === "a"),
      ),
    );
  } finally {
    if (worker) await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cross-operator journey can start on foot, and same-operator endpoints can walk at both ends", async () => {
  const directory = await multimodalFixture();
  let worker;
  try {
    const running = await startWorker(directory);
    worker = running.worker;
    await running.client.request("init");
    const request = {
      origin: { sourceId: "a", stopIdx: 0 },
      destination: { sourceId: "b", stopIdx: 3 },
      departureAfter: start,
      maxWalkMeters: 200,
      sourceIds: ["a", "b"],
    };
    const result = await running.client.request("plan", request);
    const access = result.options.find(
      (o) =>
        o.legs[0]?.kind === "walk" &&
        o.legs.some(
          (l) => l.kind === "ride" && l.trip === 1 && l.sourceId === "b",
        ),
    );
    assert.ok(access);
    assert.equal(access.legs[0].from.sourceId, "a");
    assert.equal(access.legs[0].to.sourceId, "b");
    assert.equal(access.transfers, 0);
    assert.ok(access.departure >= start);
    const bothEnds = await running.client.request("plan", {
      ...request,
      destination: { sourceId: "a", stopIdx: 3 },
    });
    assert.ok(
      bothEnds.options.some(
        (o) =>
          o.legs[0]?.kind === "walk" &&
          o.legs.at(-1)?.kind === "walk" &&
          o.legs.filter((l) => l.kind === "ride").length === 1,
      ),
    );
    const tooFar = await running.client.request("plan", {
      ...request,
      maxWalkMeters: 50,
    });
    assert.equal(tooFar.found, false);
  } finally {
    if (worker) await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker computes an isochrone from a clicked point, walking to stops and riding beyond walking range", async () => {
  const { directory } = await fixture();
  let worker;
  try {
    const running = await startWorker(directory);
    worker = running.worker;
    const { client } = running;
    await client.request("init");
    const result = await client.request("isochrone", {
      origin: { lat: 51, lon: 4 },
      departureAfter: start,
      maxWalkMeters: 2000,
      maxDurationSeconds: 1800,
    });
    assert.equal(result.found, true);
    assert.equal(result.noAccess, false);
    const origin = result.points.find((p) => p.name === "Origin");
    assert.ok(origin);
    assert.equal(origin.durationSeconds, 0);
    // Too far to walk (~2.6 km); only reachable via the direct ride.
    const destination = result.points.find((p) => p.name === "Destination");
    assert.ok(destination);
    assert.equal(destination.durationSeconds, 100);

    const wayOff = await client.request("isochrone", {
      origin: { lat: 0, lon: 0 },
      departureAfter: start,
      maxWalkMeters: 1000,
      maxDurationSeconds: 1800,
    });
    assert.equal(wayOff.found, false);
    assert.equal(wayOff.noAccess, true);
    assert.deepEqual(wayOff.points, []);
  } finally {
    if (worker) await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});

function inMemoryNetwork(rows, count = 4, spacing = 1, maxWalkMeters = 0) {
  const source = {
    id: "s",
    manifest: { counts: { trips: 100 } },
    stops: {
      id: Array.from({ length: count }, (_, i) => String(i)),
      parentIdx: new Int32Array(count).fill(-1),
      lat: Float64Array.from({ length: count }, (_, i) => 40 + i * spacing),
      lon: new Float64Array(count),
    },
  };
  const network = buildNetwork([source], maxWalkMeters);
  const batch = { epoch: 0, length: rows.length, source: network.sources[0] };
  for (const key of ["dep", "arr", "dS", "aS", "trip", "pickup", "dropOff"])
    batch[key] = Float64Array.from(rows.map((r) => r[key] || 0));
  return { network, batch };
}

test("ordered profiles match exhaustive small-network journeys", () => {
  let seed = 42;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 60; trial += 1) {
    const rows = Array.from({ length: 16 }, (_, trip) => {
      const dep = random(90);
      return {
        dep,
        arr: dep + 1 + random(10),
        dS: random(4),
        aS: random(4),
        trip,
      };
    }).sort((a, b) => a.dep - b.dep);
    const candidates = [];
    function explore(stop, time, departure, rides) {
      if (stop === 3) {
        candidates.push({ departure, arrival: time, transfers: rides - 1 });
        return;
      }
      for (const row of rows)
        if (row.dS === stop && row.dep >= time && row.arr <= 100)
          explore(row.aS, row.arr, rides ? departure : row.dep, rides + 1);
    }
    explore(0, 0, 0, 0);
    const front = candidates.filter(
      (a, i) =>
        !candidates.some(
          (b, j) =>
            j !== i &&
            b.departure >= a.departure &&
            b.arrival <= a.arrival &&
            b.transfers <= a.transfers &&
            (j < i ||
              b.departure > a.departure ||
              b.arrival < a.arrival ||
              b.transfers < a.transfers),
        ),
    );
    front.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
    const { network, batch } = inMemoryNetwork(rows);
    const result = computeProfile([batch], network, 0, 3, 0, 100);
    assert.equal(result.totalOptions, front.length, `trial ${trial}`);
    assert.deepEqual(
      result.options.map(({ departure, arrival, transfers }) => ({
        departure,
        arrival,
        transfers,
      })),
      front.slice(0, 6),
      `trial ${trial}`,
    );
  }
});

test("reverse merge handles page ties and zero-duration through-rides without boarding restrictions breaking continuity", () => {
  const rows = [
    { dep: 10, arr: 10, dS: 0, aS: 1, trip: 0 },
    { dep: 10, arr: 10, dS: 1, aS: 2, trip: 0, pickup: 1, dropOff: 1 },
    { dep: 10, arr: 20, dS: 2, aS: 3, trip: 0, pickup: 1 },
  ];
  const { network, batch } = inMemoryNetwork(rows);
  const batches = rows
    .map((_, i) =>
      Object.fromEntries(
        Object.entries(batch).map(([key, value]) => [
          key,
          ArrayBuffer.isView(value)
            ? value.subarray(i, i + 1)
            : key === "length"
              ? 1
              : value,
        ]),
      ),
    )
    .reverse();
  const result = computeProfile(batches, network, 0, 3, 0, 100);
  assert.equal(result.options[0].arrival, 20);
  assert.equal(result.options[0].transfers, 0);
  assert.equal(result.options[0].legs.length, 1);
  assert.equal(result.scanned, 3);
});

test("column cursors share buffers and cache eviction does not detach active data", () => {
  const { batch } = inMemoryNetwork([
    { dep: 10, arr: 20, dS: 0, aS: 1, trip: 0 },
    { dep: 30, arr: 40, dS: 1, aS: 2, trip: 1 },
  ]);
  const cache = new PageCache(112);
  cache.set("one", [batch]);
  const retained = cache.get("one");
  assert.equal(retained[0].dep.buffer, batch.dep.buffer);
  const other = { ...batch, dep: batch.dep.slice() };
  cache.set("two", [other]);
  assert.equal(cache.get("one"), undefined);
  const times = [];
  scanBackward(retained, 0, 25, (_, __, dep) => {
    times.push(dep);
    return false;
  });
  assert.deepEqual(times, [10]);
  assert.ok(cache.bytes <= cache.budget);
});

test("v5 export splits independent pages, preserves cross-bucket arrivals and skips irrelevant pages in the worker", async () => {
  const { directory } = await fixture();
  const { mergeArrowWorkerOutput } = require("../lib/arrow/merge.js");
  let worker;
  try {
    const rows = Array.from({ length: 50001 }, (_, i) => ({
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start + Math.floor(i / 50),
      arrivalTime: start + 30000 + Math.floor(i / 50),
      tripIdx: 0,
    }));
    rows.unshift({
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start - 1,
      arrivalTime: start + 1,
      tripIdx: 0,
    });
    rows.push({
      departureStopIdx: 0,
      arrivalStopIdx: 2,
      departureTime: start + 86400,
      arrivalTime: start + 86410,
      tripIdx: 0,
    });
    await writeFile(
      path.join(directory, "raw_0.arrow.gz"),
      gzipSync(arrow.tableToIPC(connections(rows))),
    );
    await mergeArrowWorkerOutput(directory, 1, false);
    const manifest = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    );
    assert.equal(manifest.version, 5);
    const pages = manifest.connections.pages[0]["2026-09-14T06"];
    assert.deepEqual(
      pages.map((p) => p.rowCount),
      [50000, 1],
    );
    assert.deepEqual(pages[0].arrivalRegions, [0]);
    const fetchBefore = globalThis.fetch;
    try {
      globalThis.fetch = async (url) =>
        new globalThis.Response(await readFile(url));
      const batches = await readConnectionBatches(arrow.RecordBatchReader, {
        url: path.join(directory, pages[0].path),
        epochSeconds: pages[0].epochSeconds,
        compressed: false,
        from: -Infinity,
        to: Infinity,
      });
      assert.ok(batches[0].dep instanceof Uint32Array);
      assert.ok(batches[0].arr instanceof Uint32Array);
      assert.equal(batches[0].epoch + batches[0].arr[0], start + 30000);
      assert.equal(batches[0].length, 50000);
    } finally {
      globalThis.fetch = fetchBefore;
    }
    const running = await startWorker(directory);
    worker = running.worker;
    await running.client.request("init");
    const result = await running.client.request("plan", {
      origin: { sourceId: "default", stopIdx: 0 },
      destination: { sourceId: "default", stopIdx: 2 },
      departureAfter: start,
      maxWalkMeters: 0,
    });
    assert.equal(result.scanned, 50001);
    assert.equal(result.options[0].arrival, start + 30000);
    assert.deepEqual(
      running.fetched.filter((url) => url.startsWith("partitions/")).sort(),
      pages.map((p) => p.path).sort(),
    );
  } finally {
    if (worker) await worker.terminate();
    await rm(directory, { recursive: true, force: true });
  }
});

test("walking continuation profiles match exhaustive routes with access, transfers and egress", () => {
  let seed = 91;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 25; trial += 1) {
    const rows = Array.from({ length: 12 }, (_, trip) => {
      const dep = random(1100);
      return {
        dep,
        arr: dep + 1 + random(50),
        dS: random(4),
        aS: random(4),
        trip,
      };
    }).sort((a, b) => a.dep - b.dep);
    const { network, batch } = inMemoryNetwork(rows, 4, 0.002, 250);
    const distances = Array.from({ length: 4 }, (_, stop) => {
      const neighbors = network.neighbors(stop);
      return new Map(
        Array.from(neighbors.stops, (other, i) => [
          other,
          neighbors.meters[i] / WALK_SPEED,
        ]),
      );
    });
    const candidates = [];
    function explore(stop, time, departure, rides) {
      const finalWalk = distances[stop].get(3);
      if (rides && finalWalk !== undefined && time + finalWalk <= 1200)
        candidates.push({
          departure,
          arrival: time + finalWalk,
          transfers: rides - 1,
        });
      if (stop === 3) return;
      for (const row of rows) {
        const walk = distances[stop].get(row.dS);
        if (walk !== undefined && row.dep >= time + walk && row.arr <= 1200)
          explore(
            row.aS,
            row.arr,
            rides ? departure : row.dep - walk,
            rides + 1,
          );
      }
    }
    explore(0, 0, 0, 0);
    const front = candidates.filter(
      (a, i) =>
        !candidates.some(
          (b, j) =>
            j !== i &&
            b.departure >= a.departure &&
            b.arrival <= a.arrival &&
            b.transfers <= a.transfers &&
            (j < i ||
              b.departure > a.departure ||
              b.arrival < a.arrival ||
              b.transfers < a.transfers),
        ),
    );
    front.sort((a, b) => a.departure - b.departure || a.arrival - b.arrival);
    const result = computeProfile([batch], network, 0, 3, 0, 1200);
    assert.equal(result.totalOptions, front.length, `walking trial ${trial}`);
    assert.deepEqual(
      result.options.map(({ departure, arrival, transfers }) => ({
        departure,
        arrival,
        transfers,
      })),
      front.slice(0, 6),
      `walking trial ${trial}`,
    );
  }
});

test("loader pool bounds parallel work and rejects all pending work on worker failure", async () => {
  const workers = [];
  const create = () => {
    const worker = {
      listeners: {},
      requests: [],
      addEventListener(type, handler) {
        this.listeners[type] = handler;
      },
      postMessage(request) {
        this.requests.push(request);
      },
      terminate() {
        this.terminated = true;
      },
    };
    workers.push(worker);
    return worker;
  };
  const pool = new LoaderPool(create, 2);
  const first = pool.load("first");
  const second = pool.load("second");
  const third = pool.load("third");
  assert.deepEqual(
    workers.map((w) => w.requests),
    [["first"], ["second"]],
  );
  workers[0].listeners.message({ data: { batches: ["loaded"] } });
  assert.deepEqual(await first, ["loaded"]);
  assert.deepEqual(workers[0].requests, ["first", "third"]);
  const failures = Promise.all([
    assert.rejects(second, /loader crash/),
    assert.rejects(third, /loader crash/),
  ]);
  workers[1].listeners.error({ message: "loader crash" });
  await failures;
  await assert.rejects(pool.load("fourth"), /loader crash/);
  assert.ok(workers.every((w) => w.terminated));
  let calls = 0;
  assert.throws(
    () =>
      new LoaderPool(() => {
        if (calls++) throw new Error("construction failed");
        return create();
      }, 2),
    /construction failed/,
  );
  assert.ok(workers.at(-1).terminated);
});

test("walking-only alternatives prune inferior rides, and arrival at the deadline is included", () => {
  const walk = inMemoryNetwork(
    [{ dep: 0, arr: 500, dS: 0, aS: 1, trip: 0 }],
    2,
    0.002,
    250,
  );
  const result = computeProfile([walk.batch], walk.network, 0, 1, 0, 1000);
  assert.equal(result.totalOptions, 1);
  assert.equal(result.options[0].legs[0].kind, "walk");
  const deadline = inMemoryNetwork(
    [
      { dep: 10, arr: 100, dS: 0, aS: 1, trip: 0 },
      { dep: 50, arr: 101, dS: 0, aS: 1, trip: 1 },
      { dep: 100, arr: 100, dS: 0, aS: 1, trip: 2 },
    ],
    2,
  );
  const bounded = computeProfile(
    [deadline.batch],
    deadline.network,
    0,
    1,
    0,
    100,
  );
  assert.equal(bounded.totalOptions, 1);
  assert.equal(bounded.options[0].arrival, 100);
  assert.equal(bounded.scanned, 2);
});

test("station families share profiles while returned ride legs retain platform indices", () => {
  const source = {
    id: "station-feed",
    manifest: { counts: { trips: 1 } },
    stops: {
      id: ["origin", "platform-1", "platform-2", "destination", "platform-3"],
      parentIdx: new Int32Array([-1, 0, 0, -1, 3]),
      lat: new Float64Array([NaN, 50, 50, 51, 51]),
      lon: new Float64Array(5).fill(4),
    },
  };
  const network = buildNetwork([source], 0);
  const { batch } = inMemoryNetwork(
    [{ dep: 10, arr: 20, dS: 2, aS: 4, trip: 0 }],
    5,
  );
  batch.source = network.sources[0];
  const result = computeProfile(
    [batch],
    network,
    network.globalStop({ sourceId: source.id, stopIdx: 1 }),
    network.globalStop({ sourceId: source.id, stopIdx: 3 }),
    0,
    100,
  );
  assert.equal(result.found, true);
  assert.equal(result.options[0].legs[0].boardStop, 2);
  assert.equal(result.options[0].legs[0].alightStop, 4);
});

test("isochrone reaches a clicked point's walking neighbors, then rides beyond walking range", () => {
  // Three stops roughly 222 m apart along a meridian; stop 2 is out of a
  // 300 m walking radius from stop 0, so it can only be reached by riding.
  const { network, batch } = inMemoryNetwork(
    [{ dep: 200, arr: 300, dS: 1, aS: 2, trip: 0 }],
    3,
    0.002,
    300,
  );
  const clickNearStop0 = { lat: 40, lon: 0 };
  const result = computeIsochrone(
    [batch],
    network,
    clickNearStop0,
    0,
    1000,
    300,
  );
  assert.equal(result.found, true);
  assert.equal(result.noAccess, false);
  const byStop = new Map(result.reachable.map((r) => [r.stopIdx, r]));
  assert.equal(byStop.get(0).durationSeconds, 0);
  assert.ok(byStop.get(1).durationSeconds > 0);
  assert.ok(byStop.get(1).durationSeconds < 300);
  // Only reachable by riding from stop 1, arriving at the connection's
  // scheduled time — not by a direct walk, which would exceed 300 m.
  assert.equal(byStop.get(2).arrival, 300);

  const tooFarToWalkAtAll = computeIsochrone(
    [batch],
    network,
    { lat: 0, lon: 0 },
    0,
    1000,
    300,
  );
  assert.equal(tooFarToWalkAtAll.found, false);
  assert.equal(tooFarToWalkAtAll.noAccess, true);
  assert.deepEqual(tooFarToWalkAtAll.reachable, []);
});

test("planIsochrone rejects an out-of-range duration or walking limit before loading any data", async () => {
  const empty = createPlanner(arrow);
  const base = {
    sources: [],
    origin: { lat: 51, lon: 4 },
    departureAfter: start,
    maxWalkMeters: 1000,
    maxDurationSeconds: 1800,
  };
  await assert.rejects(
    empty.planIsochrone({ ...base, maxDurationSeconds: 30 }),
    /duration/,
  );
  await assert.rejects(
    empty.planIsochrone({ ...base, maxDurationSeconds: 4 * 3600 }),
    /duration/,
  );
  await assert.rejects(
    empty.planIsochrone({ ...base, maxWalkMeters: -1 }),
    /walking limit/,
  );
  const result = await empty.planIsochrone(base);
  assert.equal(result.found, false);
});
