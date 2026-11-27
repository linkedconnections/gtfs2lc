const {
  createIriStrategy,
  defaultIriConfiguration,
  IriRegistry,
  iriSegment,
  serviceDate,
} = require("../lib/arrow/iri-strategy");
const {
  identifiers,
  iriConfiguration,
  sncbStationIri,
} = require("../lib/arrow/identifiers");

function configuration(overrides = {}) {
  return { ...structuredClone(defaultIriConfiguration), ...overrides };
}

test("escapes identifier keys as one path segment", () => {
  expect(iriSegment("A/1 !'()*é")).toBe("A%2F1%20%21%27%28%29%2A%C3%A9");
  expect(iriSegment(0)).toBe("0");
  expect(iriSegment(false)).toBe("false");
});

test.each(["", ".", "..", null, {}, Infinity])(
  "rejects unsafe identifier key %p",
  (key) => {
    expect(() => iriSegment(key)).toThrow();
  },
);

test.each(["20240229", "2024-02-29"])(
  "normalizes valid service date %s",
  (date) => {
    expect(serviceDate(date)).toBe("20240229");
  },
);

test.each([
  "20260229",
  "2026-02-30",
  "20261301",
  "2026-1-01",
  "20260101T00:00:00Z",
])("rejects invalid service date %s", (date) => {
  expect(() => serviceDate(date)).toThrow("Invalid service date");
});

test("registry permits repeat claims but rejects collisions and identity changes", () => {
  const registry = new IriRegistry();
  const iri = "https://example.test/stops/A";
  expect(registry.claim(iri, "stop:A")).toBe(iri);
  expect(registry.claim(iri, "stop:A")).toBe(iri);
  expect(() => registry.claim(iri, "stop:B")).toThrow("IRI collision");
  expect(() => registry.claim(`${iri}2`, "stop:A")).toThrow(
    "Identifier changed",
  );
});

test("identifier helpers keep entities, runs and calls in stable distinct namespaces", () => {
  const ids = identifiers("demo.fixture", "https://data.example.test/id/");
  const base = "https://data.example.test/id/demo.fixture";
  expect(ids.source).toBe(`${base}/source`);
  for (const [kind, directory] of [
    ["provider", "providers"],
    ["stop", "stops"],
    ["route", "routes"],
    ["agency", "agencies"],
    ["trip", "trips"],
    ["shape", "shapes"],
    ["unit", "units"],
  ]) {
    expect(ids[kind]("A/1")).toBe(`${base}/${directory}/A%2F1`);
  }
  expect(ids.run("T", "2026-10-25")).toBe(`${base}/runs/T/20261025`);
  expect(ids.call("T", "20261025", 0)).toBe(`${base}/runs/T/20261025/calls/0`);
  expect(ids.connection("T", "20261025", 7)).toBe(
    `${base}/runs/T/20261025/connections/7`,
  );
  expect(ids.entity("regions", "A/1")).toBe(`${base}/regions/A%2F1`);
  expect(ids.stop("A/1")).toBe(`${base}/stops/A%2F1`);
});

test.each([-1, 1.5, 0x100000000])(
  "rejects invalid call sequence %p",
  (sequence) => {
    expect(() =>
      identifiers("demo.fixture").call("T", "20261025", sequence),
    ).toThrow("Invalid stop sequence");
  },
);

test("canonical SNCB station identities accept verified UICs with either prefix", () => {
  expect(sncbStationIri("8814001")).toBe(
    "http://irail.be/stations/NMBS/008814001",
  );
  expect(sncbStationIri("008814001")).toBe(sncbStationIri("8814001"));
  expect(() => sncbStationIri("8814001_1")).toThrow("SNCB station UIC");
});

test("environment overrides do not mutate bundled identity defaults", () => {
  expect(iriConfiguration()).toEqual(defaultIriConfiguration);
  const config = iriConfiguration({
    IRI_STRATEGY_JSON: JSON.stringify(
      configuration({ identityProfile: "custom" }),
    ),
    ID_BASE_URL: "https://custom.example.test/id",
  });
  expect(config.identityProfile).toBe("custom");
  expect(config.identityBase).toBe("https://custom.example.test/id");
  expect(defaultIriConfiguration.identityBase).toBe("https://example.org/id");
});

test("resolver composition falls back for missing fields and escapes the final result once", () => {
  const strategy = createIriStrategy(
    "demo.fixture",
    configuration({
      templates: { stop: "{base}/{label}/{label}" },
      resolve: {
        key: { coalesce: ["stops.absent", { literal: "" }, "stops.key"] },
        padded: { padStart: { value: "key", length: 4 } },
        label: { concat: [{ literal: "stop/" }, "padded"] },
      },
    }),
  );
  expect(strategy.mint("stop", { stops: { key: 12 } }, [12])).toBe(
    "https://example.org/id/stop%2F0012/stop%2F0012",
  );
});

test("legacy date and substring resolvers respect the configured timezone", () => {
  const strategy = createIriStrategy(
    "demo.fixture",
    configuration({
      templates: { trip: "{base}/{short}/{day}" },
      resolve: {
        short: "trips.key.substring(0, 2);",
        day: "format(trips.startTime, 'yyyy-MM-dd');",
      },
    }),
  );
  expect(
    strategy.mint(
      "trip",
      { trips: { key: "IC123", startTime: "2026-10-24T23:30:00Z" } },
      ["IC123"],
    ),
  ).toBe("https://example.org/id/IC/2026-10-25");
});

test("source overrides and detached snapshots preserve the configured identity", () => {
  const config = configuration({
    bases: { stops: "https://stops.example.test/" },
    templates: { stop: "{bases.stops}/{stops.key}" },
  });
  const strategy = createIriStrategy("demo.fixture", config);
  config.templates.stop = "{base}/changed";
  strategy.snapshot.templates.stop = "{base}/also-changed";
  expect(strategy.mint("stop", { stops: { key: "A" } }, ["A"])).toBe(
    "https://stops.example.test/A",
  );
});

test.each([
  ["value", "value", "Cyclic IRI resolver"],
  ["value", "process.exit(1)", "Invalid resolver path"],
  ["value", "stops.constructor", "Invalid resolver path"],
  ["value", { coalesce: ["stops.missing"] }, "No IRI resolver fallback"],
  [
    "value",
    { padStart: { value: "stops.key", length: 0 } },
    "Invalid IRI padding",
  ],
  ["value", { unknown: true }, "Unknown IRI resolver operation"],
])("rejects invalid resolver %p = %p", (name, resolver, error) => {
  const strategy = createIriStrategy(
    "demo.fixture",
    configuration({
      templates: { stop: `{base}/{${name}}` },
      resolve: { [name]: resolver },
    }),
  );
  expect(() => strategy.mint("stop", { stops: { key: "A" } }, ["A"])).toThrow(
    error,
  );
});

test.each([
  "{base}/stops/{stops.key}?query=1",
  "{base}/stops/{stops.key}#fragment",
  "{base}/../{stops.key}",
  "https://user:password@example.test/{stops.key}",
])("rejects noncanonical identity template %s", (template) => {
  const strategy = createIriStrategy(
    "demo.fixture",
    configuration({ templates: { stop: template } }),
  );
  expect(() => strategy.mint("stop", { stops: { key: "A" } }, ["A"])).toThrow(
    "normalized HTTP(S) path",
  );
});

test.each(["../source", "Uppercase", "", "demo..fixture"])(
  "rejects invalid source namespace %p",
  (sourceId) => {
    expect(() => createIriStrategy(sourceId)).toThrow(
      "Invalid registered source ID",
    );
  },
);

test("a shared registry detects constant-template collisions across entities", () => {
  const strategy = createIriStrategy(
    "demo.fixture",
    configuration({ templates: { stop: "{base}/constant" } }),
  );
  strategy.mint("stop", {}, ["A"]);
  expect(() => strategy.mint("stop", {}, ["B"])).toThrow("IRI collision");
});
