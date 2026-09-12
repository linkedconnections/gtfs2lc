const fs = require("node:fs");
const path = require("node:path");
const {
  Utf8,
  Float64,
  vectorFromArray,
  makeVector,
  RecordBatchStreamWriter,
  RecordBatchStreamReader,
  Table,
} = require("apache-arrow");
const URIStrategy = require("../URIStrategy.js");
const {
  STOPS_SCHEMA,
  ROUTES_SCHEMA,
  TRIPS_SCHEMA,
  buildRecordBatch,
} = require("./schema.js");

const FILE_NAMES = {
  stops: "stops.arrow",
  routes: "routes.arrow",
  trips: "trips.arrow",
  connections: "linkedConnections.arrow",
};

async function* iterateStore(store) {
  if (store instanceof Map) {
    yield* store;
  } else {
    yield* store.iterator();
  }
}

function utf8Vector(values) {
  return vectorFromArray(values, new Utf8());
}

function float64Vector(values) {
  return vectorFromArray(values, new Float64());
}

function int32Vector(values) {
  return makeVector(Int32Array.from(values));
}

function writeArrowFile(filePath, schema, vectors) {
  const batch = buildRecordBatch(schema, vectors);
  const writer = new RecordBatchStreamWriter();
  writer.reset(undefined, schema);
  writer.write(batch);
  writer.close();
  fs.writeFileSync(filePath, writer.toUint8Array(true));
}

/**
 * Builds the global stops/routes/trips dictionaries once, before any worker
 * starts, and writes them to `stops.arrow`, `routes.arrow`, and
 * `trips.arrow` in `outputPath`. Every connection worker (and every
 * RecordBatch page in the final connections stream) refers to GTFS entities
 * through these same, stable integer indices, so identifiers stay
 * consistent across pages without repeating the full identifier on every
 * connection.
 */
async function buildDictionaries(stores, outputPath, baseUris, compressed) {
  const routeIndex = new Map();
  const routeIds = [];
  const routeShortNames = [];
  const routeLongNames = [];
  for await (const [routeId, route] of iterateStore(stores.routesDB)) {
    routeIndex.set(routeId, routeIds.length);
    routeIds.push(routeId);
    routeShortNames.push(route.route_short_name || null);
    routeLongNames.push(route.route_long_name || null);
  }
  writeArrowFile(path.join(outputPath, FILE_NAMES.routes), ROUTES_SCHEMA, {
    routeId: utf8Vector(routeIds),
    shortName: utf8Vector(routeShortNames),
    longName: utf8Vector(routeLongNames),
  });

  const stopIndex = new Map();
  const stopIds = [];
  const names = [];
  const lats = [];
  const lons = [];
  const parentStationIds = [];
  for await (const [stopId, stop] of iterateStore(stores.stopsDB)) {
    stopIndex.set(stopId, stopIds.length);
    stopIds.push(stopId);
    names.push(stop.stop_name || null);
    lats.push(stop.stop_lat ? Number.parseFloat(stop.stop_lat) : null);
    lons.push(stop.stop_lon ? Number.parseFloat(stop.stop_lon) : null);
    parentStationIds.push(stop.parent_station || null);
  }
  // A stop's `parent_station` may be defined before or after it in
  // stops.txt, so it can only be resolved to an index once every stop id
  // has been assigned one.
  const parentIdx = parentStationIds.map((parentStationId) =>
    parentStationId && stopIndex.has(parentStationId)
      ? stopIndex.get(parentStationId)
      : -1,
  );
  writeArrowFile(path.join(outputPath, FILE_NAMES.stops), STOPS_SCHEMA, {
    stopId: utf8Vector(stopIds),
    name: utf8Vector(names),
    lat: float64Vector(lats),
    lon: float64Vector(lons),
    parentIdx: int32Vector(parentIdx),
  });

  const tripIndex = new Map();
  const tripIds = [];
  const tripRouteIdx = [];
  const headsigns = [];
  for await (const [tripId, trip] of iterateStore(stores.tripsDB)) {
    tripIndex.set(tripId, tripIds.length);
    tripIds.push(tripId);
    tripRouteIdx.push(
      routeIndex.has(trip.route_id) ? routeIndex.get(trip.route_id) : -1,
    );
    headsigns.push(trip.trip_headsign || null);
  }
  writeArrowFile(path.join(outputPath, FILE_NAMES.trips), TRIPS_SCHEMA, {
    tripId: utf8Vector(tripIds),
    routeIdx: int32Vector(tripRouteIdx),
    headsign: utf8Vector(headsigns),
  });

  fs.writeFileSync(
    path.join(outputPath, "manifest.json"),
    JSON.stringify(
      {
        format: "gtfs2lc-arrow-connections",
        // 1: initial schema. 2: stops.arrow gained `parentIdx` (GTFS
        // `parent_station`, resolved to a row index, -1 if none).
        version: 2,
        generatedAt: new Date().toISOString(),
        files: {
          ...FILE_NAMES,
          connections: `${FILE_NAMES.connections}${compressed ? ".gz" : ""}`,
        },
        compressed: Boolean(compressed),
        baseUris: URIStrategy.resolveBaseUris(baseUris),
        counts: {
          stops: stopIds.length,
          routes: routeIds.length,
          trips: tripIds.length,
        },
      },
      null,
      2,
    ),
  );

  return { stopIndex, routeIndex, tripIndex };
}

function readStringIndexColumn(filePath, column) {
  const bytes = fs.readFileSync(filePath);
  const reader = RecordBatchStreamReader.from(bytes);
  const table = new Table(reader);
  const vector = table.getChild(column);
  const index = new Map();
  for (let row = 0; row < table.numRows; row += 1) {
    index.set(vector.get(row), row);
  }
  return index;
}

/**
 * Loads the stops/routes/trips dictionaries built by `buildDictionaries`
 * back into lookup maps. Used by each worker to translate GTFS identifiers
 * on a connection into the global integer indices already assigned to them.
 */
function loadIndexMaps(outputPath) {
  return {
    stopIndex: readStringIndexColumn(
      path.join(outputPath, FILE_NAMES.stops),
      "stopId",
    ),
    routeIndex: readStringIndexColumn(
      path.join(outputPath, FILE_NAMES.routes),
      "routeId",
    ),
    tripIndex: readStringIndexColumn(
      path.join(outputPath, FILE_NAMES.trips),
      "tripId",
    ),
  };
}

module.exports = { FILE_NAMES, buildDictionaries, loadIndexMaps };
