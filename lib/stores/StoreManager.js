const fs = require("node:fs");
const { access } = require("node:fs/promises");
const { Readable } = require("node:stream");
const csv = require("fast-csv");
const Store = require("./Store");
const CalendarExpander = require("../services/CalendarExpander");

module.exports = async function createStores(sourcePath, outPath, storeType) {
  const [stopsDB, routesDB, tripsDB, servicesDB] = await Promise.all([
    loadIndexData({
      stream: csvFile(`${sourcePath}/stops.txt`),
      type: storeType,
      fileName: `${outPath}/stops.db`,
      encoding: "json",
      key: "stop_id",
    }),
    loadIndexData({
      stream: csvFile(`${sourcePath}/routes.txt`),
      type: storeType,
      fileName: `${outPath}/routes.db`,
      encoding: "json",
      key: "route_id",
    }),
    loadIndexData({
      stream: csvFile(`${sourcePath}/trips.txt`),
      type: storeType,
      fileName: `${outPath}/trips.db`,
      encoding: "json",
      key: "trip_id",
    }),
    loadServiceDates(sourcePath, outPath, storeType),
  ]);

  return { stopsDB, routesDB, tripsDB, servicesDB };
};

function csvFile(fileName) {
  return fs
    .createReadStream(fileName, { encoding: "utf8" })
    .pipe(csv.parse({ headers: true }));
}

async function fileExists(fileName) {
  try {
    await access(fileName);
    return true;
  } catch {
    return false;
  }
}

async function loadServiceDates(sourcePath, outPath, storeType) {
  const calendarDates = new Map();
  const calendarDatesFile = `${sourcePath}/calendar_dates.txt`;

  if (await fileExists(calendarDatesFile)) {
    for await (const calendarDate of csvFile(calendarDatesFile)) {
      if (!calendarDates.has(calendarDate.service_id)) {
        calendarDates.set(calendarDate.service_id, {
          added: new Set(),
          removed: new Set(),
        });
      }
      const rules = calendarDates.get(calendarDate.service_id);
      if (calendarDate.exception_type === "1")
        rules.added.add(calendarDate.date);
      if (calendarDate.exception_type === "2")
        rules.removed.add(calendarDate.date);
    }
  }

  const calendarFile = `${sourcePath}/calendar.txt`;
  const calendarSource = (await fileExists(calendarFile))
    ? csvFile(calendarFile)
    : Readable.from([], { objectMode: true });
  const calendar = calendarSource.pipe(new CalendarExpander(calendarDates));

  return loadIndexData({
    stream: calendar,
    type: storeType,
    fileName: `${outPath}/services.db`,
    encoding: "json",
    key: "service_id",
    value: "dates",
  });
}

async function loadIndexData({ stream, type, fileName, encoding, key, value }) {
  const store = Store({ fileName, encoding }, type);
  for await (const data of stream) {
    if (!data[key]) continue;
    if (store instanceof Map) store.set(data[key], value ? data[value] : data);
    else await store.put(data[key], value ? data[value] : data);
  }
  console.error(`Created and loaded store in ${fileName}`);
  return store;
}
