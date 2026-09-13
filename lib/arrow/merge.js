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
const { FILE_NAMES, loadStopRegions } = require("./dictionaries.js");

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

function monthKey(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 7); // "YYYY-MM", UTC
}

async function writeConnectionsFile(filePath, columns, order, compressed) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const sorted = {
    departureStopIdx: permute(Int32Array, columns.departureStopIdx, order),
    arrivalStopIdx: permute(Int32Array, columns.arrivalStopIdx, order),
    departureTime: permute(BigInt64Array, columns.departureTime, order),
    arrivalTime: permute(BigInt64Array, columns.arrivalTime, order),
    tripIdx: permute(Int32Array, columns.tripIdx, order),
    pickupType: permute(Uint8Array, columns.pickupType, order),
    dropOffType: permute(Uint8Array, columns.dropOffType, order),
  };

  const writer = new RecordBatchStreamWriter();
  writer.reset(undefined, CONNECTIONS_SCHEMA);
  const destination = compressed
    ? (() => {
        const gzip = zlib.createGzip();
        gzip.pipe(fs.createWriteStream(filePath));
        return gzip;
      })()
    : fs.createWriteStream(filePath);
  writer.toNodeStream({ objectMode: false }).pipe(destination);

  const totalRows = order.length;
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
}

/**
 * Reads every worker's independent `raw_{instance}.arrow.gz` Arrow IPC
 * stream, concatenates all of their connections, and writes them back out
 * partitioned by (region of the departure stop, calendar month of the
 * departure time) — one small, internally departure-time-sorted Arrow file
 * per (region, month) pair under `partitions/<regionId>/<YYYY-MM>.arrow`.
 *
 * GTFS trips are distributed round-robin across workers (see
 * `StopTimes2Cxs.js`), so worker output is not already time-ordered, and a
 * route planner running the Connection Scan Algorithm needs each file it
 * reads to be sorted — hence sorting per partition here rather than
 * leaving it to the client.
 *
 * Every column is a plain typed array, so this holds roughly
 * `rows * 30 bytes` in memory during the process — comparable to a few
 * hundred MB for a feed the size of a busy national railway's yearly
 * schedule. Very large feeds may eventually need a disk-backed sort
 * instead.
 */
async function mergeArrowWorkerOutput(outputPath, workerCount, compressed) {
  const regionOfStop = loadStopRegions(outputPath);

  let totalRows = 0;
  const allChunks = [];
  for (let instance = 0; instance < workerCount; instance += 1) {
    const rawFile = path.join(outputPath, `raw_${instance}.arrow.gz`);
    const { chunks, rowCount } = await readWorkerColumns(rawFile);
    allChunks.push(...chunks);
    totalRows += rowCount;
  }

  const columns = {
    departureStopIdx: concatenate(
      Int32Array,
      allChunks,
      "departureStopIdx",
      totalRows,
    ),
    arrivalStopIdx: concatenate(
      Int32Array,
      allChunks,
      "arrivalStopIdx",
      totalRows,
    ),
    departureTime: concatenate(
      BigInt64Array,
      allChunks,
      "departureTime",
      totalRows,
    ),
    arrivalTime: concatenate(
      BigInt64Array,
      allChunks,
      "arrivalTime",
      totalRows,
    ),
    tripIdx: concatenate(Int32Array, allChunks, "tripIdx", totalRows),
    pickupType: concatenate(Uint8Array, allChunks, "pickupType", totalRows),
    dropOffType: concatenate(Uint8Array, allChunks, "dropOffType", totalRows),
  };

  // Group row indices by (region, month) key.
  const groups = new Map(); // "regionId|YYYY-MM" -> number[]
  for (let i = 0; i < totalRows; i += 1) {
    const region = regionOfStop[columns.departureStopIdx[i]];
    const month = monthKey(Number(columns.departureTime[i]));
    const key = `${region}|${month}`;
    let indices = groups.get(key);
    if (!indices) {
      indices = [];
      groups.set(key, indices);
    }
    indices.push(i);
  }

  const monthsSeen = new Set();
  const files = {}; // regionId -> { month -> relative path }
  for (const [key, indices] of groups) {
    const [regionStr, month] = key.split("|");
    monthsSeen.add(month);
    indices.sort((a, b) =>
      columns.departureTime[a] < columns.departureTime[b]
        ? -1
        : columns.departureTime[a] > columns.departureTime[b]
          ? 1
          : 0,
    );

    const relativePath = path.posix.join(
      FILE_NAMES.partitionsDir,
      regionStr,
      `${month}.arrow${compressed ? ".gz" : ""}`,
    );
    await writeConnectionsFile(
      path.join(outputPath, relativePath),
      columns,
      indices,
      compressed,
    );

    if (!files[regionStr]) files[regionStr] = {};
    files[regionStr][month] = relativePath;
  }

  const manifestPath = path.join(outputPath, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.connections = {
    months: [...monthsSeen].sort(),
    files,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return manifestPath;
}

module.exports = { mergeArrowWorkerOutput };
