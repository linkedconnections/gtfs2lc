const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const csv = require("fast-csv");
const {
  RecordBatchFileWriter,
  RecordBatch,
  Struct,
  makeData,
  vectorFromArray,
  tableFromIPC,
} = require("apache-arrow");
const { schemaFor } = require("./schema");

async function* readCsv(sourcePath, name) {
  const file = path.join(sourcePath, name);
  if (!fs.existsSync(file)) return;
  const input = fs.createReadStream(file);
  const parser = csv.parse({ headers: true, ignoreEmpty: true });
  input.on("error", (error) => parser.destroy(error));
  input.pipe(parser);
  try {
    yield* parser;
  } finally {
    input.destroy();
    parser.destroy();
  }
}

function batchFor(schema, rows) {
  const vectors = schema.fields.map((field) =>
    vectorFromArray(
      rows.map((row) => {
        const value = row[field.name] ?? null;
        if (value === null && !field.nullable)
          throw new Error(`Missing required ${field.name}`);
        return value;
      }),
      field.type,
    ),
  );
  return new RecordBatch(
    schema,
    makeData({
      type: new Struct(schema.fields),
      length: rows.length,
      children: vectors.map((v) => v.data[0]),
    }),
  );
}

async function writeRows(file, name, rows, metadata) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const writer = new RecordBatchFileWriter();
  const schema = schemaFor(name, metadata);
  writer.reset(undefined, schema);
  const completed = pipeline(writer, fs.createWriteStream(file));
  // Observe asynchronous failures while synchronous vector construction is running.
  completed.catch(() => {});
  let pending = [];
  let rowCount = 0;
  try {
    for await (const row of rows) {
      pending.push(row);
      rowCount++;
      if (pending.length >= 50000) {
        writer.write(batchFor(schema, pending));
        pending = [];
      }
    }
    if (pending.length || rowCount === 0)
      writer.write(batchFor(schema, pending));
    writer.close();
    await completed;
  } catch (error) {
    // Close the private, incomplete file before the release builder removes it.
    // Arrow's Node adapter does not handle a rejected queue pull on abort.
    writer.close();
    await completed.catch(() => {});
    throw error;
  }
  return rowCount;
}

function loadTable(file) {
  return tableFromIPC(fs.readFileSync(file));
}
function uint(value, name, fallback) {
  if (
    (value === "" || value === undefined || value === null) &&
    fallback !== undefined
  )
    return fallback;
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > 0xffffffff
  )
    throw new Error(`Invalid ${name}`);
  return Number(value);
}
function optionalNumber(value, name, min = -Infinity, max = Infinity) {
  if (value === "" || value === undefined || value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`Invalid ${name}`);
  return number;
}
function enumValue(value, name, max, fallback = null) {
  if (value === "" || value === undefined || value === null) return fallback;
  const number = uint(value, name);
  if (number > max) throw new Error(`Unsupported ${name}: ${value}`);
  return number;
}
module.exports = {
  readCsv,
  writeRows,
  loadTable,
  uint,
  optionalNumber,
  enumValue,
};
