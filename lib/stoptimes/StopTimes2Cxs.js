const fs = require("node:fs");
const { rm } = require("node:fs/promises");
const { once } = require("node:events");
const { finished } = require("node:stream/promises");
const csv = require("fast-csv");
const Store = require("../stores/Store");
const St2C = require("./st2c");

module.exports = async function stopTimesToConnections(
  sourcePath,
  outPath,
  stores,
  fresh,
  workerCount,
) {
  const startedAt = Date.now();
  const historyPath = `${outPath}/history.db`;
  if (fresh) {
    console.error("Performing a fresh data transformation...");
    await rm(historyPath, { recursive: true, force: true });
  }

  const historyDB = Store(
    { fileName: historyPath, encoding: "json" },
    "LevelStore",
  );
  await historyDB.open();
  const writers = createWriteStreams("connections", outPath, workerCount);

  try {
    const stopTimes = fs
      .createReadStream(`${sourcePath}/stop_times.txt`, { encoding: "utf8" })
      .pipe(csv.parse({ headers: true, quote: '"' }))
      .pipe(
        new St2C(
          stores.stopsDB,
          stores.tripsDB,
          stores.routesDB,
          stores.servicesDB,
          historyDB,
        ),
      );

    let connectionIndex = -1;
    let currentTrip = null;
    let printedRows = 0;
    for await (const row of stopTimes) {
      if (row.trip.trip_id !== currentTrip) {
        currentTrip = row.trip.trip_id;
        connectionIndex = (connectionIndex + 1) % workerCount;
      }
      if (!writers[connectionIndex].write(`${JSON.stringify(row)}\n`)) {
        await once(writers[connectionIndex], "drain");
      }
      printedRows += 1;
    }

    writers.forEach((writer) => writer.end());
    await Promise.all(writers.map((writer) => finished(writer)));
    console.error(
      `Created ${printedRows} connection rules in ${Date.now() - startedAt} ms`,
    );
  } catch (error) {
    writers.forEach((writer) => writer.destroy());
    throw error;
  } finally {
    await closeStores(stores, historyDB);
  }
};

function createWriteStreams(name, outputPath, workerCount) {
  return Array.from({ length: workerCount }, (_, instance) =>
    fs.createWriteStream(`${outputPath}/${name}_${instance}.txt`, {
      encoding: "utf8",
    }),
  );
}

async function closeStores(stores, historyDB) {
  const persistentStores = [
    stores.stopsDB,
    stores.tripsDB,
    stores.routesDB,
    stores.servicesDB,
  ].filter((store) => !(store instanceof Map));
  await Promise.all(
    [...persistentStores, historyDB].map((store) => store.close()),
  );
}
