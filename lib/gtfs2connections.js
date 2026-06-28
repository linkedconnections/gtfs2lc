const { Worker, isMainThread, workerData } = require("node:worker_threads");
const { availableParallelism } = require("node:os");
const fs = require("node:fs");
const { mkdir, rm } = require("node:fs/promises");
const zlib = require("node:zlib");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { once } = require("node:events");
const { finished, pipeline } = require("node:stream/promises");
const { StreamWriter } = require("rdf-parser-ts");
const {
  PhysicalStreamType,
  StreamParser: JellyStreamParser,
  StreamWriter: JellyStreamWriter,
} = require("rdfjs-jelly");
const StoreManager = require("./stores/StoreManager");
const StopTimes2Cxs = require("./stoptimes/StopTimes2Cxs");
const JSONLinesParser = require("./streams/JSONLinesParser");
const JSONLinesStringer = require("./streams/JSONLinesStringer");
const RemoveRdfMessageVersion = require("./streams/RemoveRdfMessageVersion");
const ConnectionsBuilder = require("./ConnectionsBuilder");
const Connections2JSONLD = require("./Connections2JSONLD");
const Connections2CSV = require("./Connections2CSV");
const Connections2Mongo = require("./Connections2Mongo");
const Connections2Triples = require("./Connections2Triples");

const execFileAsync = promisify(execFile);
const supportedFormats = new Set([
  "json",
  "mongo",
  "jsonld",
  "mongold",
  "csv",
  "turtle",
  "ntriples",
  "jelly",
]);

class GTFSMapper {
  constructor(options = {}) {
    this._options = {
      format: "jelly",
      store: "MemStore",
      ...options,
    };
    this._options.format = normalizeFormat(this._options.format);

    if (!supportedFormats.has(this._options.format)) {
      throw new TypeError(`Unsupported output format: ${this._options.format}`);
    }
    if (!["MemStore", "LevelStore"].includes(this._options.store)) {
      throw new TypeError(`Unsupported store type: ${this._options.store}`);
    }
  }

  async convert(sourcePath, outputPath = sourcePath) {
    const startedAt = Date.now();
    const workerCount = getWorkerCount(this.options.workers);
    await mkdir(outputPath, { recursive: true });

    console.error("Cleaning up and sorting source files");
    await cleanUpSources(sourcePath);

    console.error("Creating index stores...");
    const stores = await StoreManager(
      sourcePath,
      outputPath,
      this.options.store,
    );

    console.error("Creating connection rules...");
    await StopTimes2Cxs(
      sourcePath,
      outputPath,
      stores,
      this.options.fresh,
      workerCount,
    );

    await Promise.all(
      Array.from({ length: workerCount }, (_, instance) =>
        runWorker(instance, outputPath, this.options),
      ),
    );

    console.error("Merging final Linked Connections file...");
    const outputFile = await mergeWorkerOutput(
      outputPath,
      workerCount,
      this.options.format,
      this.options.compressed,
    );
    await cleanIntermediateFiles(outputPath, workerCount, this.options.format);
    console.error(
      `${path.basename(outputFile)} created in ${Date.now() - startedAt} ms`,
    );
    return outputFile;
  }

  get options() {
    return this._options;
  }
}

function normalizeFormat(format = "jelly") {
  return format.toLowerCase().replace(/^n-?triples$/u, "ntriples");
}

function getWorkerCount(requested) {
  if (requested !== undefined) {
    const parsed = Number.parseInt(requested, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new TypeError("workers must be a positive integer");
    }
    return parsed;
  }
  return Math.max(1, Math.min(availableParallelism(), 8));
}

async function cleanUpSources(sourcePath) {
  const cleaner = path.resolve(__dirname, "../bin/gtfs2lc-clean.js");
  try {
    await execFileAsync(process.execPath, [cleaner, sourcePath]);
  } catch (error) {
    throw new Error(`Could not prepare GTFS source at ${sourcePath}`, {
      cause: error,
    });
  }
}

function runWorker(instance, output, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: { instance, output, options },
    });
    console.error(`Materializing connections in worker ${worker.threadId}`);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`Worker ${instance} stopped with exit code ${code}`));
    });
  });
}

function formatExtension(format) {
  if (format === "jelly") return "jelly";
  if (["json", "mongo", "jsonld", "mongold"].includes(format)) return "json";
  if (format === "turtle") return "ttl";
  if (format === "ntriples") return "nt";
  return "csv";
}

async function mergeWorkerOutput(output, workerCount, format, compressed) {
  if (format === "jelly") {
    return mergeJellyWorkerOutput(output, workerCount, compressed);
  }
  const extension = formatExtension(format);
  const outputFile = path.join(
    output,
    `linkedConnections.${extension}${compressed ? ".gz" : ""}`,
  );
  const destination = fs.createWriteStream(outputFile);

  try {
    for (let instance = 0; instance < workerCount; instance += 1) {
      const rawFile = path.join(output, `raw_${instance}.${extension}.gz`);
      const source = compressed
        ? fs.createReadStream(rawFile)
        : fs.createReadStream(rawFile).pipe(zlib.createGunzip());
      for await (const chunk of source) {
        if (!destination.write(chunk))
          await new Promise((resolve) => destination.once("drain", resolve));
      }
    }
    destination.end();
    await finished(destination);
    return outputFile;
  } catch (error) {
    destination.destroy();
    throw error;
  }
}

async function mergeJellyWorkerOutput(output, workerCount, compressed) {
  const outputFile = path.join(
    output,
    `linkedConnections.jelly${compressed ? ".gz" : ""}`,
  );
  const writer = new JellyStreamWriter({
    namespaces: rdfPrefixes(),
    physicalType: PhysicalStreamType.TRIPLES,
  });
  const outputStreams = compressed
    ? [writer, zlib.createGzip(), fs.createWriteStream(outputFile)]
    : [writer, fs.createWriteStream(outputFile)];
  const outputPipeline = pipeline(outputStreams);
  let globalMessageCounter = -1;

  try {
    for (let instance = 0; instance < workerCount; instance += 1) {
      const rawFile = path.join(output, `raw_${instance}.jelly.gz`);
      const parser = fs
        .createReadStream(rawFile)
        .pipe(zlib.createGunzip())
        .pipe(new JellyStreamParser({ messages: true }));
      let localMessageCounter = -1;

      for await (const entry of parser) {
        if (entry.messageCounter !== localMessageCounter) {
          localMessageCounter = entry.messageCounter;
          globalMessageCounter += 1;
        }
        if (
          !writer.write({
            quad: entry.quad,
            messageCounter: globalMessageCounter,
          })
        ) {
          await once(writer, "drain");
        }
      }
    }
    writer.end();
    await outputPipeline;
    return outputFile;
  } catch (error) {
    writer.destroy();
    throw error;
  }
}

async function cleanIntermediateFiles(output, workerCount, format) {
  const extension = formatExtension(format);
  const files = Array.from({ length: workerCount }, (_, instance) => [
    path.join(output, `connections_${instance}.txt`),
    path.join(output, `raw_${instance}.${extension}.gz`),
  ]).flat();
  const stores = ["stops.db", "routes.db", "trips.db", "services.db"].map(
    (name) => path.join(output, name),
  );
  await Promise.all(
    [...files, ...stores].map((file) =>
      rm(file, { recursive: true, force: true }),
    ),
  );
}

async function materializeConnections({ instance, output, options }) {
  const format = normalizeFormat(options.format);
  const extension = formatExtension(format);
  const streams = [
    fs.createReadStream(path.join(output, `connections_${instance}.txt`), {
      encoding: "utf8",
      highWaterMark: 4 * 1024,
    }),
    new JSONLinesParser(),
    new ConnectionsBuilder(),
  ];

  if (format === "mongo") streams.push(new Connections2Mongo());
  if (["json", "mongo"].includes(format)) streams.push(new JSONLinesStringer());

  if (["jsonld", "mongold"].includes(format)) {
    const context = instance === 0 ? linkedConnectionsContext() : undefined;
    streams.push(new Connections2JSONLD(options.baseUris, context));
    if (format === "mongold") streams.push(new Connections2Mongo());
    streams.push(new JSONLinesStringer());
  }

  if (format === "csv") streams.push(new Connections2CSV(instance === 0));
  if (format === "turtle") {
    streams.push(
      new Connections2Triples(options.baseUris, instance === 0 ? 0 : 1),
    );
    streams.push(
      new StreamWriter({
        format: "Turtle",
        prefixes: instance === 0 ? rdfPrefixes() : undefined,
        version: "1.2-messages",
      }),
    );
    if (instance > 0) streams.push(new RemoveRdfMessageVersion());
  }
  if (format === "ntriples") {
    streams.push(
      new Connections2Triples(options.baseUris, instance === 0 ? 0 : 1),
    );
    streams.push(
      new StreamWriter({ format: "N-Triples", version: "1.2-messages" }),
    );
    if (instance > 0) streams.push(new RemoveRdfMessageVersion());
  }
  if (format === "jelly") {
    streams.push(new Connections2Triples(options.baseUris));
    streams.push(
      new JellyStreamWriter({ physicalType: PhysicalStreamType.TRIPLES }),
    );
  }

  streams.push(
    zlib.createGzip(),
    fs.createWriteStream(path.join(output, `raw_${instance}.${extension}.gz`)),
  );
  await pipeline(streams);
}

function rdfPrefixes() {
  return {
    lc: "http://semweb.mmlab.be/ns/linkedconnections#",
    gtfs: "http://vocab.gtfs.org/terms#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
  };
}

function linkedConnectionsContext() {
  return {
    "@context": {
      lc: "http://semweb.mmlab.be/ns/linkedconnections#",
      gtfs: "http://vocab.gtfs.org/terms#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      trip: { "@type": "@id", "@id": "gtfs:trip" },
      Connection: "lc:Connection",
      CancelledConnection: "lc:CancelledConnection",
      departureTime: { "@type": "xsd:dateTime", "@id": "lc:departureTime" },
      departureStop: { "@type": "@id", "@id": "lc:departureStop" },
      arrivalStop: { "@type": "@id", "@id": "lc:arrivalStop" },
      arrivalTime: { "@type": "xsd:dateTime", "@id": "lc:arrivalTime" },
    },
  };
}

if (!isMainThread) {
  materializeConnections(workerData).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = GTFSMapper;
