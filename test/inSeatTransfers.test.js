const { execFile } = require("node:child_process");
const { cp, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const { tableFromIPC } = require("apache-arrow");
const { Connections } = require("../lib/gtfs2lc");
const sncb = require("./fixtures/sncb-block-111112.json");

const run = promisify(execFile);
const first = {
  id: "A",
  from: "A/1",
  to: "B",
  departure: "08:00:00",
  arrival: "08:30:00",
};
const second = {
  id: "B",
  from: "B",
  to: "C",
  departure: "08:35:00",
  arrival: "09:00:00",
};
let root, feed, output;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lc-block-"));
  feed = path.join(root, "feed");
  output = path.join(root, "output");
  await cp(path.join(__dirname, "arrow-feed"), feed, { recursive: true });
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function prepare(
  trips = [first, second],
  dates = ["service,20261024,1", "service,20261025,1"],
  transfers = [],
) {
  await writeFile(
    path.join(feed, "trips.txt"),
    [
      "route_id,service_id,trip_id,trip_short_name,block_id",
      ...trips.map(
        (t) =>
          `R,${t.service ?? "service"},${t.id},${t.id},${t.block ?? "shared"}`,
      ),
    ].join("\n") + "\n",
  );
  await writeFile(
    path.join(feed, "stop_times.txt"),
    [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      ...trips.flatMap((t) => [
        `${t.id},,${t.departure},${t.from},10`,
        `${t.id},${t.arrival},,${t.to},20`,
      ]),
    ].join("\n") + "\n",
  );
  await writeFile(
    path.join(feed, "calendar_dates.txt"),
    "service_id,date,exception_type\n" + dates.join("\n") + "\n",
  );
  await writeFile(
    path.join(feed, "transfers.txt"),
    "from_stop_id,to_stop_id,transfer_type,min_transfer_time,from_trip_id,to_trip_id\n" +
      transfers.join("\n") +
      "\n",
  );
}

async function release(options = {}, cliArgs) {
  if (cliArgs) {
    await run(process.execPath, [
      path.join(__dirname, "../bin/gtfs2lc.js"),
      "--format",
      "arrow",
      "--source-id",
      "demo.fixture",
      "--release-id",
      "blocks",
      "--output",
      output,
      ...cliArgs,
      feed,
    ]);
  } else {
    await new Connections({
      format: "arrow",
      sourceId: "demo.fixture",
      releaseId: "blocks",
      ...options,
    }).convert(feed, output);
  }
  const load = async (name) =>
    tableFromIPC(
      await readFile(path.join(output, "releases/blocks", `${name}.arrow`)),
    );
  const transfers = await load("transfers");
  const trips = [...(await load("trips"))];
  return {
    rows: [...transfers].map((r) => r.toJSON()),
    pairs: [...transfers].map((r) => [
      trips[r.fromTripIdx]?.shortName ?? null,
      trips[r.toTripIdx]?.shortName ?? null,
    ]),
    summary: JSON.parse(
      transfers.schema.metadata.get("inSeatTransferDerivation"),
    ),
    load,
  };
}

test.each(["linked-connections-v2-alpha", "irail-cdn-v1"])(
  "derives each consecutive trip pair once across multiple dates (%s)",
  async (profile) => {
    await prepare([
      second,
      {
        id: "C",
        from: "C",
        to: "B",
        departure: "09:05:00",
        arrival: "09:30:00",
      },
      first,
    ]);
    const { rows, pairs, summary } = await release({ profile });
    expect(pairs).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(
      rows.every(
        (r) =>
          r.transferType === 4 &&
          r.minTransferTime === null &&
          r.fromStopIdx === r.toStopIdx,
      ),
    ).toBe(true);
    expect(summary).toMatchObject({
      enabled: true,
      maxGapSeconds: 1500,
      derivedLinks: 2,
      qualifyingPairDays: 4,
    });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('"derivedLinks":2'),
    );
  },
);

test("reused block IDs never link trips on different service dates", async () => {
  await prepare(
    [
      { ...first, service: "one", departure: "23:00:00", arrival: "24:10:00" },
      { ...second, service: "two", departure: "00:15:00", arrival: "01:00:00" },
    ],
    ["one,20261024,1", "two,20261025,1"],
  );
  expect((await release()).pairs).toEqual([]);
});

test("calendar removals, additions, and the requested horizon control shared block days", async () => {
  await prepare(
    [
      { ...first, service: "one" },
      { ...second, service: "two" },
    ],
    ["one,20261024,2", "two,20261024,1", "two,20261025,1"],
  );
  await writeFile(
    path.join(feed, "calendar.txt"),
    "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\none,1,1,1,1,1,1,1,20261024,20261025\n",
  );
  const { pairs, summary } = await release({
    startDate: "20261024",
    endDate: "20261024",
  });
  expect(pairs).toEqual([]);
  expect(summary.qualifyingPairDays).toBe(0);
  output = path.join(root, "next-day");
  const next = await release({ startDate: "20261025", endDate: "20261025" });
  expect(next.pairs).toEqual([["A", "B"]]);
  expect(next.summary.qualifyingPairDays).toBe(1);
});

test("an incompatible intermediate trip cannot be bypassed to invent a chain", async () => {
  await prepare([
    first,
    {
      id: "intermediate",
      from: "C",
      to: "A/1",
      departure: "08:32:00",
      arrival: "08:45:00",
    },
    second,
  ]);
  expect((await release()).pairs).toEqual([]);
});

test.each([
  ["08:55:00", true],
  ["08:56:00", false],
])(
  "a continuation at %s obeys the inclusive 25-minute limit",
  async (departure, linked) => {
    await prepare([first, { ...second, departure }]);
    const { pairs, summary } = await release();
    expect(pairs).toHaveLength(linked ? 1 : 0);
    expect(summary.skipped.gapTooLarge).toBe(linked ? 0 : 2);
  },
);

test.each([
  [{ ...second, from: "A/1" }, "differentStop"],
  [{ ...second, departure: "08:29:00" }, "timeOverlap"],
])("skips incompatible consecutive block runs: %s", async (to, reason) => {
  await prepare([first, to]);
  const { pairs, summary } = await release();
  expect(pairs).toEqual([]);
  expect(summary.skipped[reason]).toBe(2);
});

test("junction matching uses the exact stop, even when platforms share a station", async () => {
  await writeFile(
    path.join(feed, "stops.txt"),
    (await readFile(path.join(feed, "stops.txt"), "utf8")) +
      "\nA/2,Alpha platform 2,50.8,4.3,0,A,2\n",
  );
  await prepare([
    { ...first, to: "A/1" },
    { ...second, from: "A/2" },
  ]);
  expect((await release()).summary.skipped.differentStop).toBe(2);
});

test.each([4, 5])(
  "explicit type-%s rules win even with different stop selectors",
  async (type) => {
    await prepare(undefined, undefined, [`,,${type},,A,B`]);
    const { rows, pairs, summary } = await release();
    expect(pairs).toEqual([["A", "B"]]);
    expect(rows[0].transferType).toBe(type);
    expect(rows[0].fromStopIdx).toBeNull();
    expect(summary.derivedLinks).toBe(0);
    expect(summary.skipped.explicitRulePresent).toBe(2);
  },
);

test("ordinary transfers and reverse-direction explicit rules do not suppress a continuation", async () => {
  await prepare(undefined, undefined, ["B,B,2,120,,", ",,5,,B,A"]);
  const { rows, pairs, summary } = await release();
  expect(rows.map((r) => r.transferType)).toEqual([2, 5, 4]);
  expect(pairs.at(-1)).toEqual(["A", "B"]);
  expect(summary.derivedLinks).toBe(1);
});

test.each(["", "separate"])(
  "empty or different block IDs produce no links (%p)",
  async (block) => {
    await prepare([first, { ...second, block }]);
    expect((await release()).pairs).toEqual([]);
  },
);

test("after-midnight times continue within the original service date", async () => {
  await prepare([
    { ...first, departure: "23:00:00", arrival: "24:10:00" },
    { ...second, departure: "24:15:00", arrival: "25:00:00" },
  ]);
  expect((await release()).pairs).toEqual([["A", "B"]]);
});

test("the NMBS 7401 to 5130 fixture derives the seven-minute Midi continuation", async () => {
  await writeFile(
    path.join(feed, "stops.txt"),
    "stop_id,stop_name,stop_lat,stop_lon\n" +
      sncb.stops.map(([id, name]) => `${id},${name},,`).join("\n") +
      "\n",
  );
  await prepare(sncb.trips);
  const { pairs, summary } = await release({ sourceId: "be.sncb" });
  expect(pairs).toEqual([["7401", "5130"]]);
  expect(summary.derivedLinks).toBe(1);
});

test("the CLI opt-out preserves explicit links and records that derivation was disabled", async () => {
  await prepare(undefined, undefined, [",,5,,B,A"]);
  const { rows, summary } = await release({}, [
    "--no-derive-in-seat-transfers",
  ]);
  expect(rows.map((r) => r.transferType)).toEqual([5]);
  expect(summary).toMatchObject({
    enabled: false,
    derivedLinks: 0,
    maxGapSeconds: 1500,
  });
});

test("the CLI accepts a configurable gap including zero", async () => {
  await prepare([first, { ...second, departure: first.arrival }]);
  const { pairs, summary } = await release({}, [
    "--max-in-seat-transfer-gap",
    "0",
  ]);
  expect(pairs).toEqual([["A", "B"]]);
  expect(summary.maxGapSeconds).toBe(0);
});

test("a larger configured gap allows the otherwise rejected 26-minute turnaround", async () => {
  await prepare([first, { ...second, departure: "08:56:00" }]);
  expect(
    (await release({}, ["--max-in-seat-transfer-gap", "1560"])).pairs,
  ).toEqual([["A", "B"]]);
});

test.each([-1, 1.5, 0x100000000])(
  "the library rejects invalid maximum gaps (%p)",
  async (maxInSeatTransferGap) => {
    await prepare();
    await expect(release({ maxInSeatTransferGap })).rejects.toThrow(
      "maximum in-seat transfer gap",
    );
  },
);

test.each(["-1", "1.5", "4294967296"])(
  "the CLI rejects invalid maximum gap %s",
  async (gap) => {
    await expect(
      run(process.execPath, [
        path.join(__dirname, "../bin/gtfs2lc.js"),
        "--format",
        "arrow",
        "--max-in-seat-transfer-gap",
        gap,
        feed,
      ]),
    ).rejects.toMatchObject({ code: 1 });
  },
);
