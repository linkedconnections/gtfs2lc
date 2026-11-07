"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_ID_BASE =
  exports.IriRegistry =
  exports.defaultIriConfiguration =
  exports.createIriStrategy =
  exports.absoluteIri =
    void 0;
exports.iriConfiguration = iriConfiguration;
exports.identifiers = identifiers;
exports.sncbStationIri = sncbStationIri;
const iri_strategy_js_1 = require("./iri-strategy.js");
var iri_strategy_js_2 = require("./iri-strategy.js");
Object.defineProperty(exports, "absoluteIri", {
  enumerable: true,
  get: function () {
    return iri_strategy_js_2.absoluteIri;
  },
});
Object.defineProperty(exports, "createIriStrategy", {
  enumerable: true,
  get: function () {
    return iri_strategy_js_2.createIriStrategy;
  },
});
Object.defineProperty(exports, "defaultIriConfiguration", {
  enumerable: true,
  get: function () {
    return iri_strategy_js_2.defaultIriConfiguration;
  },
});
Object.defineProperty(exports, "IriRegistry", {
  enumerable: true,
  get: function () {
    return iri_strategy_js_2.IriRegistry;
  },
});
exports.DEFAULT_ID_BASE =
  iri_strategy_js_1.defaultIriConfiguration.identityBase;
// The same bundled registry is used by builders and Worker collectors. A full JSON
// override is useful when several deployments share one independently managed registry.
function iriConfiguration(env = {}) {
  const config = env.IRI_STRATEGY_JSON
    ? JSON.parse(env.IRI_STRATEGY_JSON)
    : iri_strategy_js_1.defaultIriConfiguration;
  return { ...config, identityBase: env.ID_BASE_URL ?? config.identityBase };
}
function identifiers(
  sourceId,
  config = iri_strategy_js_1.defaultIriConfiguration,
  registry,
) {
  const strategy = (0, iri_strategy_js_1.createIriStrategy)(
    sourceId,
    typeof config === "string"
      ? { ...iri_strategy_js_1.defaultIriConfiguration, identityBase: config }
      : config,
    registry,
  );
  const mint = strategy.mint;
  const keyed = (kind, root, key) => mint(kind, { [root]: { key } }, [key]);
  const event = (kind, tripKey, date, sequence) => {
    const day = (0, iri_strategy_js_1.serviceDate)(date);
    if (
      sequence !== undefined &&
      (!Number.isInteger(sequence) || sequence < 0 || sequence > 0xffffffff)
    )
      throw new Error("Invalid stop sequence");
    return mint(
      kind,
      {
        trips: { key: tripKey },
        connection: { serviceDate: day, stopSequence: sequence },
      },
      sequence === undefined ? [tripKey, day] : [tripKey, day, sequence],
    );
  };
  return {
    ...strategy,
    source: mint("source", {}, [sourceId]),
    provider: (channel) => keyed("provider", "provider", channel),
    stop: (key) => keyed("stop", "stops", key),
    route: (key) => keyed("route", "routes", key),
    agency: (key) => keyed("agency", "agency", key),
    trip: (key) => keyed("trip", "trips", key),
    shape: (key) => keyed("shape", "shapes", key),
    unit: (key) => keyed("unit", "unit", key),
    run: (key, date) => event("run", key, date),
    call: (key, date, sequence) => event("call", key, date, sequence),
    connection: (key, date, sequence) =>
      event("connection", key, date, sequence),
    entity: (kind, key) =>
      mint("entity", { entity: { kind, key } }, [kind, key]),
  };
}
// Only call with a verified station UIC, never an arbitrary platform/raw international ID.
function sncbStationIri(uic) {
  const match = /^(?:00)?(\d{7})$/.exec(uic);
  if (!match)
    throw new Error("SNCB station UIC must have seven digits or a 00 prefix");
  const key = match[1];
  return (0, iri_strategy_js_1.createIriStrategy)("be.sncb").mint(
    "station",
    { stops: { key, uic: key } },
    [key],
  );
}
