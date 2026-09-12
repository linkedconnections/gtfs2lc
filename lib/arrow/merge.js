const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  makeVector,
  makeData,
  TimestampSecond,
  RecordBatchStreamReader,
  RecordBatchStreamWriter,
} = require("apache-arrow");
const {
  BATCH_SIZE,
  CONNECTIONS_SCHEMA,
  buildRecordBatch,
} = require("./schema.js");
const { FILE_NAMES } = require("./dictionaries.js");

function columnValues(batch, name) {
  const field = CONNECTIONS_SCHEMA.fields.findIndex((f) => f.name === name);
  return batch.data.children[field].values;
}

async function readWorkerColumns(filePath) {
  const nodeStream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  const reader = await RecordBatchStreamReader.from(nodeStream);
  const chunks = [];
  let rowCount = 0;
  for await (const batch of reader) {
    if (batch.numRows === 0) continue;
    chunks.push({
      departureStopIdx: columnValues(batch, "departureStopIdx"),
      arrivalStopIdx: columnValues(batch, "arrivalStopIdx"),
      departureTime: columnValues(batch, "departureTime"),
      arrivalTime: columnValues(batch, "arrivalTime"),
      tripIdx: columnValues(batch, "tripIdx"),
      pickupType: columnValues(batch, "pickupType"),
      dropOffType: columnValues(batch, "dropOffType"),
      length: batch.numRows,
    });
    rowCount += batch.numRows;
  }
  return { chunks, rowCount };
}

function concatenate(TypedArrayConstructor, chunks, field, totalRows) {
  const result = new TypedArrayConstructor(totalRows);
  let offset = 0;
  for (const chunk of chunks) {
    // Arrow buffers are padded/aligned, so the raw `.values` array can be
    // longer than the batch's actual row count — only copy real rows.
    result.set(chunk[field].subarray(0, chunk.length), offset);
    offset += chunk.length;
  }
  return result;
}

function permute(TypedArrayConstructor, source, order) {
  const result = new TypedArrayConstructor(order.length);
  for (let i = 0; i < order.length; i += 1) result[i] = source[order[i]];
  return result;
}

/**
 * Reads every worker's independent `raw_{instance}.arrow.gz` Arrow IPC
 * stream, concatenates all of their connections, and sorts the result by
 * `departureTime`. GTFS trips are distributed round-robin across workers
 * (see `StopTimes2Cxs.js`), so worker output is not already time-ordered;
 * a route planner running the Connection Scan Algorithm requires a single,
 * globally departure-time-sorted array, so the sort happens here rather
 * than being left to the client.
 *
 * Every column is a plain typed array, so this holds roughly
 * `rows * 30 bytes` in memory during the sort — comparable to a few hundred
 * MB for a feed the size of a busy national railway's yearly schedule.
 * Very large feeds may eventually need a disk-backed sort instead.
 */
async function mergeArrowWorkerOutput(outputPath, workerCount, compressed) {
  const outputFile = path.join(
    outputPath,
    `${FILE_NAMES.connections}${compressed ? ".gz" : ""}`,
  );

  let totalRows = 0;
  const allChunks = [];
  for (let instance = 0; instance < workerCount; instance += 1) {
    const rawFile = path.join(outputPath, `raw_${instance}.arrow.gz`);
    const { chunks, rowCount } = await readWorkerColumns(rawFile);
    allChunks.push(...chunks);
    totalRows += rowCount;
  }

  const departureStopIdx = concatenate(
    Int32Array,
    allChunks,
    "departureStopIdx",
    totalRows,
  );
  const arrivalStopIdx = concatenate(
    Int32Array,
    allChunks,
    "arrivalStopIdx",
    totalRows,
  );
  const departureTime = concatenate(
    BigInt64Array,
    allChunks,
    "departureTime",
    totalRows,
  );
  const arrivalTime = concatenate(
    BigInt64Array,
    allChunks,
    "arrivalTime",
    totalRows,
  );
  const tripIdx = concatenate(Int32Array, allChunks, "tripIdx", totalRows);
  const pickupType = concatenate(
    Uint8Array,
    allChunks,
    "pickupType",
    totalRows,
  );
  const dropOffType = concatenate(
    Uint8Array,
    allChunks,
    "dropOffType",
    totalRows,
  );

  const order = Array.from({ length: totalRows }, (_, i) => i);
  order.sort((a, b) =>
    departureTime[a] < departureTime[b]
      ? -1
      : departureTime[a] > departureTime[b]
        ? 1
        : 0,
  );

  const sorted = {
    departureStopIdx: permute(Int32Array, departureStopIdx, order),
    arrivalStopIdx: permute(Int32Array, arrivalStopIdx, order),
    departureTime: permute(BigInt64Array, departureTime, order),
    arrivalTime: permute(BigInt64Array, arrivalTime, order),
    tripIdx: permute(Int32Array, tripIdx, order),
    pickupType: permute(Uint8Array, pickupType, order),
    dropOffType: permute(Uint8Array, dropOffType, order),
  };

  const writer = new RecordBatchStreamWriter();
  writer.reset(undefined, CONNECTIONS_SCHEMA);
  const destination = compressed
    ? (() => {
        const gzip = zlib.createGzip();
        gzip.pipe(fs.createWriteStream(outputFile));
        return gzip;
      })()
    : fs.createWriteStream(outputFile);
  writer.toNodeStream({ objectMode: false }).pipe(destination);

  for (let start = 0; start < totalRows; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, totalRows);
    const vectors = {
      departureStopIdx: makeVector(
        sorted.departureStopIdx.subarray(start, end),
      ),
      arrivalStopIdx: makeVector(sorted.arrivalStopIdx.subarray(start, end)),
      departureTime: makeVector(
        makeData({
          type: new TimestampSecond(),
          data: sorted.departureTime.subarray(start, end),
        }),
      ),
      arrivalTime: makeVector(
        makeData({
          type: new TimestampSecond(),
          data: sorted.arrivalTime.subarray(start, end),
        }),
      ),
      tripIdx: makeVector(sorted.tripIdx.subarray(start, end)),
      pickupType: makeVector(sorted.pickupType.subarray(start, end)),
      dropOffType: makeVector(sorted.dropOffType.subarray(start, end)),
    };
    writer.write(buildRecordBatch(CONNECTIONS_SCHEMA, vectors));
  }
  writer.close();

  await new Promise((resolve, reject) => {
    destination.on("finish", resolve);
    destination.on("error", reject);
  });

  return outputFile;
}

module.exports = { mergeArrowWorkerOutput };
