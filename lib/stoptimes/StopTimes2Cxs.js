const fs = require('fs');
const del = require('del');
const csv = require('fast-csv');
const Store = require('../stores/Store');
const St2C = require('./st2c');
const numCPUs = require('os').cpus().length;

module.exports = function (sourcePath, outPath, stores, fresh) {
   return new Promise(async resolve => {
      const t0 = new Date();

      if (fresh) {
         console.error('Performing a fresh data transformation...');
         // Delete existing historic store if fresh conversion is being requested
         await del([`${outPath}/history.db`], { force: true });
      }
      // Load or create historic connections LevelDB store
      const historyDB = Store({ fileName: `${outPath}/history.db`, encoding: 'json' }, 'LevelStore');
      await historyDB.open();

      // Fragment stop_times.txt according to the number of available CPU cores
      const stopTimes = fs.createReadStream(`${sourcePath}/stop_times.txt`, { encoding: 'utf8', objectMode: true })
         .pipe(csv.parse({ objectMode: true, headers: true, quote: '"' }))
         .on('error', function (e) {
            console.error(e);
         });

      const connectionsPool = createWriteStreams('connections', outPath);
      let connIndex = -1;
      let currentTrip = null;
      let printedRows = 0;

      const connectionRules = stopTimes.pipe(new St2C(
         stores.stopsDB,
         stores.tripsDB,
         stores.routesDB,
         stores.servicesDB,
         historyDB
      ));

      connectionRules.on('error', err => {
         console.error(err);
         process.exit(-1);
      })

      connectionRules.on('data', row => {
         if (row.trip['trip_id'] !== currentTrip) {
            currentTrip = row.trip['trip_id'];
            connIndex = connIndex < numCPUs - 1 ? connIndex + 1 : 0;
         }

         connectionsPool[connIndex].write(JSON.stringify(row) + '\n');
         printedRows++;
      });

      connectionRules.on('end', () => {
         for (let i in connectionsPool) {
            connectionsPool[i].end();
         }

         // Close all LevelDB stores as they will not be used any further on this process
         if (!(stores.stopsDB instanceof Map)) {
            stores.stopsDB.close();
            stores.tripsDB.close();
            stores.routesDB.close();
            stores.servicesDB.close();
            historyDB.close();
         }
         
         console.error(`Created ${printedRows} Connection rules in ${new Date() - t0} ms`);
         resolve();
      });
   });
}

function createWriteStreams(name, path) {
   const writers = [];
   for (let i = 0; i < numCPUs; i++) {
      const stream = fs.createWriteStream(`${path}/${name}_${i}.txt`, { encoding: 'utf8' });
      writers.push(stream);
   }

   return writers;
}