const {
  makeVector,
  makeData,
  TimestampSecond,
  RecordBatchStreamWriter,
} = require("apache-arrow");
const {
  BATCH_SIZE,
  CONNECTIONS_SCHEMA,
  buildRecordBatch,
} = require("./schema.js");
const { loadIndexMaps } = require("./dictionaries.js");

function toEpochSeconds(date) {
  return BigInt(Math.floor(date.getTime() / 1000));
}

function requireIndex(map, key, kind) {
  const index = map.get(key);
  if (index === undefined) {
    throw new Error(`Arrow connections writer: unknown ${kind} id "${key}"`);
  }
  return index;
}

function emptyRows() {
  return {
    departureStopIdx: [],
    arrivalStopIdx: [],
    departureTime: [],
    arrivalTime: [],
    tripIdx: [],
    pickupType: [],
    dropOffType: [],
  };
}

function buildConnectionsRecordBatch(rows) {
  const vectors = {
    departureStopIdx: makeVector(Int32Array.from(rows.departureStopIdx)),
    arrivalStopIdx: makeVector(Int32Array.from(rows.arrivalStopIdx)),
    departureTime: makeVector(
      makeData({
        type: new TimestampSecond(),
        data: BigInt64Array.from(rows.departureTime),
      }),
    ),
    arrivalTime: makeVector(
      makeData({
        type: new TimestampSecond(),
        data: BigInt64Array.from(rows.arrivalTime),
      }),
    ),
    tripIdx: makeVector(Int32Array.from(rows.tripIdx)),
    pickupType: makeVector(Uint8Array.from(rows.pickupType)),
    dropOffType: makeVector(Uint8Array.from(rows.dropOffType)),
  };
  return buildRecordBatch(CONNECTIONS_SCHEMA, vectors);
}

/**
 * Creates a pipeline transform (an async generator function, usable directly
 * as a `stream.pipeline()` stage) that turns a stream of `connection`
 * objects into Arrow IPC stream bytes: `departureStop`/`arrivalStop`/`trip`
 * are resolved to the global integer indices assigned in `stops.arrow` and
 * `trips.arrow` (built up front by `buildDictionaries`), and rows are
 * batched into RecordBatches of `BATCH_SIZE` connections.
 *
 * Every worker uses its own writer/schema instance, so per-worker output
 * files stay independent, self-contained Arrow IPC streams; merging them is
 * handled separately (see `merge.js`).
 */
function createArrowConnectionsTransform({ outputPath }) {
  return async function* connections2Arrow(source) {
    const { stopIndex, tripIndex } = loadIndexMaps(outputPath);
    const writer = new RecordBatchStreamWriter();
    writer.reset(undefined, CONNECTIONS_SCHEMA);

    const producer = (async () => {
      let rows = emptyRows();
      let count = 0;
      for await (const connection of source) {
        rows.departureStopIdx.push(
          requireIndex(stopIndex, connection.departureStop.stop_id, "stop"),
        );
        rows.arrivalStopIdx.push(
          requireIndex(stopIndex, connection.arrivalStop.stop_id, "stop"),
        );
        rows.departureTime.push(toEpochSeconds(connection.departureTime));
        rows.arrivalTime.push(toEpochSeconds(connection.arrivalTime));
        rows.tripIdx.push(
          requireIndex(tripIndex, connection.trip.trip_id, "trip"),
        );
        rows.pickupType.push(Number.parseInt(connection.pickup_type, 10) || 0);
        rows.dropOffType.push(
          Number.parseInt(connection.drop_off_type, 10) || 0,
        );
        count += 1;
        if (count >= BATCH_SIZE) {
          writer.write(buildConnectionsRecordBatch(rows));
          rows = emptyRows();
          count = 0;
        }
      }
      if (count > 0) writer.write(buildConnectionsRecordBatch(rows));
      writer.close();
    })();

    for await (const chunk of writer) yield Buffer.from(chunk);
    await producer;
  };
}

module.exports = { createArrowConnectionsTransform };
