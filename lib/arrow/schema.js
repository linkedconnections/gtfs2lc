const {
  Field,
  Schema,
  Struct,
  Int32,
  Uint8,
  Float64,
  Utf8,
  TimestampSecond,
  RecordBatch,
  makeData,
} = require("apache-arrow");

// Number of connections gathered into a single Arrow RecordBatch (a "page").
// Chosen so a browser client can start route planning after downloading a
// few hundred KB, without paying excessive per-batch framing overhead.
const BATCH_SIZE = 50_000;

const CONNECTIONS_SCHEMA = new Schema([
  new Field("departureStopIdx", new Int32()),
  new Field("arrivalStopIdx", new Int32()),
  new Field("departureTime", new TimestampSecond()),
  new Field("arrivalTime", new TimestampSecond()),
  new Field("tripIdx", new Int32()),
  new Field("pickupType", new Uint8()),
  new Field("dropOffType", new Uint8()),
]);

const STOPS_SCHEMA = new Schema([
  new Field("stopId", new Utf8()),
  new Field("name", new Utf8(), true),
  new Field("lat", new Float64(), true),
  new Field("lon", new Float64(), true),
  // Row index into stops.arrow itself (GTFS `parent_station`), or -1 when
  // this stop has no parent. A stop that other stops list as their parent
  // is a station; a client planning a journey from a station should accept
  // a departure/arrival at any of its child stops (platforms, boarding
  // areas, ...), not just the station row itself.
  new Field("parentIdx", new Int32()),
  // Precomputed geospatial partition (see lib/arrow/regions.js) this stop
  // belongs to — an index into manifest.json's `partitioning.regions`, and
  // the first half of the (region, month) key connections are filed under.
  new Field("regionIdx", new Int32()),
]);

const ROUTES_SCHEMA = new Schema([
  new Field("routeId", new Utf8()),
  new Field("shortName", new Utf8(), true),
  new Field("longName", new Utf8(), true),
]);

const TRIPS_SCHEMA = new Schema([
  new Field("tripId", new Utf8()),
  new Field("routeIdx", new Int32()),
  new Field("headsign", new Utf8(), true),
]);

/**
 * Assembles a RecordBatch for `schema` out of one already-built Arrow vector
 * per field. `vectors` must have one entry per field in `schema`, keyed by
 * field name.
 */
function buildRecordBatch(schema, vectors) {
  const children = schema.fields.map((field) => vectors[field.name].data[0]);
  const structData = makeData({ type: new Struct(schema.fields), children });
  return new RecordBatch(schema, structData);
}

module.exports = {
  BATCH_SIZE,
  CONNECTIONS_SCHEMA,
  STOPS_SCHEMA,
  ROUTES_SCHEMA,
  TRIPS_SCHEMA,
  buildRecordBatch,
};
