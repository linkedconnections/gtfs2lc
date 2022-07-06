const fs = require('fs');
const csv = require('fast-csv');
const Store = require('./Store');
const CalendarExpander = require('../services/CalendarExpander');

module.exports = async function (outPath, storeType) {
   // Step 2: Read all the required GTFS files in a stream-fashion
   const stops = fs.createReadStream(`${outPath}/stops.txt`, { encoding: 'utf8', objectMode: true })
      .pipe(csv.parse({ objectMode: true, headers: true }))
      .on('error', function (e) {
         console.error(e);
      });

   const routes = fs.createReadStream(`${outPath}/routes.txt`, { encoding: 'utf8', objectMode: true })
      .pipe(csv.parse({ objectMode: true, headers: true }))
      .on('error', function (e) {
         console.error(e);
      });

   const trips = fs.createReadStream(`${outPath}/trips.txt`, { encoding: 'utf8', objectMode: true })
      .pipe(csv.parse({ objectMode: true, headers: true }))
      .on('error', function (e) {
         console.error(e);
      });

   // Store in LevelDB or in memory Map depending on the options
   const [
      stopsDB, routesDB, tripsDB, servicesDB
   ] = await Promise.all([
      loadIndexData({
         stream: stops,
         type: storeType,
         fileName: `${outPath}/stops.db`,
         encoding: 'json',
         key: 'stop_id',
      }),
      loadIndexData({
         stream: routes,
         type: storeType,
         fileName: `${outPath}/routes.db`,
         encoding: 'json',
         key: 'route_id',
      }),
      loadIndexData({
         stream: trips,
         type: storeType,
         fileName: `${outPath}/trips.db`,
         encoding: 'json',
         key: 'trip_id',
      }),
      loadServiceDates(outPath, storeType)
   ]);

   return { stopsDB, routesDB, tripsDB, servicesDB };
}

async function loadServiceDates(outPath, storeType) {
   // Load all calendar_dates in memory store
   const calendarDates = new Map();

   const calendarDatesStream = fs.createReadStream(`${outPath}/calendar_dates.txt`, { encoding: 'utf8', objectMode: true })
      .pipe(csv.parse({ objectMode: true, headers: true }))
      .on('error', function (e) {
         console.error(e);
      });

   for await (const cd of calendarDatesStream) {
      // Initialize calendar_date rule object
      if(!calendarDates.has(cd['service_id'])) {
         calendarDates.set(cd['service_id'], { added: new Set(), removed: new Set() });
      }
      // Set date addition/removal accordingly
      if(cd['exception_type'] === '1') {
         calendarDates.get(cd['service_id']).added.add(cd['date']);
      } else if(cd['exception_type'] === '2') {
         calendarDates.get(cd['service_id']).removed.add(cd['date']);
      }
   }

   // Load and merge all expanded service dates in data store.
   const calendar = fs.createReadStream(`${outPath}/calendar.txt`, { encoding: 'utf8', objectMode: true })
      .pipe(csv.parse({ objectMode: true, headers: true }))
      .pipe(new CalendarExpander(calendarDates))
      .on('error', function (e) {
         console.error(e);
      });

   return loadIndexData({
      stream: calendar,
      type: storeType,
      fileName: `${outPath}/services.db`,
      encoding: 'json',
      key: 'service_id',
      value: 'dates'
   });
}

async function loadIndexData({ stream, type, fileName, encoding, key, value }) {
   try {
      const store = Store({ fileName, encoding }, type);
      for await (const data of stream) {
         if (data[key]) {
            if (store instanceof Map) {
               store.set(data[key], value ? data[value] : data);
            } else {
               await store.put(data[key], value ? data[value] : data);
            }
         }
      }

      console.error(`Created and loaded store in ${fileName}`);
      return store;
   } catch (err) {
      console.error(err);
   }
}