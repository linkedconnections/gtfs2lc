const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { pipeline } = require("node:stream/promises");
const {
  TIME_PARTITION_SECONDS,
  timePartitionKey,
} = require("./partitioning.js");
const {
  makeVector,
  Schema,
  RecordBatchStreamReader,
  RecordBatchStreamWriter,
} = require("apache-arrow");
const {
  BATCH_SIZE,
  CONNECTIONS_SCHEMA,
  PROFILE_CONNECTIONS_SCHEMA,
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

function relativeTimes(values, order, epoch) {
  const offsets = new Uint32Array(order.length);
  for (let i = 0; i < order.length; i += 1) {
    const offset = Number(values[order[i]]) - epoch;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 0xffffffff)
      throw new Error("Arrow page timestamp offset is outside Uint32 range");
    offsets[i] = offset;
  }
  return offsets;
}

async function writeConnectionsPage(
  filePath,
  columns,
  order,
  compressed,
  epoch,
) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const schema = new Schema(
    PROFILE_CONNECTIONS_SCHEMA.fields,
    new Map([["epochSeconds", String(epoch)]]),
  );
  const vectors = {
    departureStopIdx: makeVector(
      permute(Int32Array, columns.departureStopIdx, order),
    ),
    arrivalStopIdx: makeVector(
      permute(Int32Array, columns.arrivalStopIdx, order),
    ),
    departureTimeOffset: makeVector(
      relativeTimes(columns.departureTime, order, epoch),
    ),
    arrivalTimeOffset: makeVector(
      relativeTimes(columns.arrivalTime, order, epoch),
    ),
    tripIdx: makeVector(permute(Int32Array, columns.tripIdx, order)),
    pickupType: makeVector(permute(Uint8Array, columns.pickupType, order)),
    dropOffType: makeVector(permute(Uint8Array, columns.dropOffType, order)),
  };
  const writer = new RecordBatchStreamWriter();
  writer.reset(undefined, schema);
  const streams = [writer.toNodeStream({ objectMode: false })];
  if (compressed) streams.push(zlib.createGzip());
  streams.push(fs.createWriteStream(filePath));
  const completed = pipeline(streams);
  completed.catch(() => {});
  writer.write(buildRecordBatch(schema, vectors));
  writer.close();
  await completed;
}

/**
 * Reads every worker's independent `raw_{instance}.arrow.gz` Arrow IPC
 * stream, concatenates all of their connections, and writes them back out
 * partitioned by (region of the departure stop, six-hour UTC bucket of the
 * departure time) — one small, internally departure-time-sorted Arrow file
 * per page under `partitions/<regionId>/<YYYY-MM-DDTHH>/<page>.arrow`.
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

  // Group row indices by (region, period) key.
  const groups = new Map(); // "regionId|YYYY-MM-DDTHH" -> number[]
  for (let i = 0; i < totalRows; i += 1) {
    const region = regionOfStop[columns.departureStopIdx[i]];
    const period = timePartitionKey(Number(columns.departureTime[i]));
    const key = `${region}|${period}`;
    let indices = groups.get(key);
    if (!indices) {
      indices = [];
      groups.set(key, indices);
    }
    indices.push(i);
  }

  const periodsSeen = new Set();
  const pages = {}; // regionId -> { period -> indexed independent Arrow pages }
  for (const [key, indices] of groups) {
    const [regionStr, period] = key.split("|");
    periodsSeen.add(period);
    indices.sort((a, b) =>
      columns.departureTime[a] < columns.departureTime[b]
        ? -1
        : columns.departureTime[a] > columns.departureTime[b]
          ? 1
          : 0,
    );

    const epoch = Date.parse(`${period}:00:00Z`) / 1000;
    if (!pages[regionStr]) pages[regionStr] = {};
    const pageIndex = (pages[regionStr][period] = []);
    for (let start = 0; start < indices.length; start += BATCH_SIZE) {
      const order = indices.slice(start, start + BATCH_SIZE);
      const relativePath = path.posix.join(
        FILE_NAMES.partitionsDir,
        regionStr,
        period,
        `${String(pageIndex.length).padStart(5, "0")}.arrow${compressed ? ".gz" : ""}`,
      );
      await writeConnectionsPage(
        path.join(outputPath, relativePath),
        columns,
        order,
        compressed,
        epoch,
      );
      pageIndex.push({
        path: relativePath,
        epochSeconds: epoch,
        minDepartureTime: Number(columns.departureTime[order[0]]),
        maxDepartureTime: Number(
          columns.departureTime[order[order.length - 1]],
        ),
        rowCount: order.length,
        arrivalRegions: [
          ...new Set(
            order.map((row) => regionOfStop[columns.arrivalStopIdx[row]]),
          ),
        ].sort((a, b) => a - b),
        byteLength: (
          await fs.promises.stat(path.join(outputPath, relativePath))
        ).size,
      });
    }
  }

  const manifestPath = path.join(outputPath, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = 5;
  manifest.connections = {
    timePartitionSeconds: TIME_PARTITION_SECONDS,
    periods: [...periodsSeen].sort(),
    pages,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return manifestPath;
}

module.exports = { mergeArrowWorkerOutput };
