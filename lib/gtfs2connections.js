const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const ChildProcess = require('child_process');
const del = require('del');
const util = require('util');
const N3 = require('n3');
const StoreManager = require('./stores/StoreManager');
const StopTimes2Cxs = require('./stoptimes/StopTimes2Cxs');
const { parser: JSONLParser } = require('stream-json/jsonl/Parser');
const JSONLStringer = require('stream-json/jsonl/Stringer');
const ConnectionsBuilder = require('./ConnectionsBuilder');
const Connections2JSONLD = require('./Connections2JSONLD');
const Connections2CSV = require('./Connections2CSV');
const Connections2Mongo = require('./Connections2Mongo');
const Connections2Triples = require('./Connections2Triples');


const readdir = util.promisify(fs.readdir);
const exec = util.promisify(ChildProcess.exec);

const numCPUs = require('os').cpus().length;


const Mapper = function (options) {
   this._options = options;
   if (!this._options.store) {
      this._options.store = 'MemStore';
   }
};

/**
* Returns a resultStream for connections
* Step 1: Clean up and sort source files by calling bin/gtfs2lc-sort.sh
* Step 2: Create index of stops.txt, routes.txt, trips.txt and, 
*         convert calendar_dates.txt and calendar.txt to service ids mapped to a long list of dates.
* Step 3: Produce (diff) connection rules based on available CPU cores
* Step 4: Use Node.js worker threads to process the connection rules in parallel.
* Step 5: Merge the files created in parallel and return the file path.
*/
Mapper.prototype.resultStream = async function (path, output, done) {
   const t0 = new Date();
   // Step 1: Clean up and sort source files by calling bin/gtfs2lc-sort.sh
   console.error('Cleaning up and sorting source files');
   await cleanUpSources(path);

   // Step 2: Read all the required GTFS files and create reusable indexes
   console.error('Creating index stores...');
   const stores = await StoreManager(path, output, this._options.store);

   // Step 3: Produce (diff) connection rules based on available CPU cores
   console.error('Creating Connection rules...');
   await StopTimes2Cxs(path, output, stores, this._options.fresh);

   // Step 4: Materialize connections in parallel using worker threads
   let w = 0;
   const raws = [];
   // Create as many worker threads as there are available CPUs
   for (let i = 0; i < numCPUs; i++) {
      const worker = new Worker(__filename, {
         workerData: {
            instance: i,
            output,
            options: this._options
         }
      });

      console.error(`Materializing Connections in worker thread (PID ${worker.threadId})`);

      worker.on('message', async () => {
         raws.push(`raw_${w}`);
         w++;
         if (w === numCPUs) {
            // Step 5: Merge all the created files into one
            const format = this._options.format;
            let ext = null;
            let gz = '';
            let mergeCommand = 'zcat';

            if (!format || ['json', 'mongo', 'jsonld', 'mongold'].indexOf(format) >= 0) {
               await appendLineBreaks(output);
               ext = 'json';
            } else if (format === 'csv') {
               ext = 'csv';
            } else if (format === 'turtle') {
               await removePrefixes(output);
               ext = 'ttl';
            } else if (format === 'ntriples') {
               ext = 'nt';
            }

            try {
               console.error('Merging final Linked Connections file...');
               if (this._options.compressed) {
                  mergeCommand = 'cat';
                  gz = '.gz';
               }

               // Join all resulting files into one
               await exec(`for i in ${raws.map(r => { return `${r}.${ext}.gz` }).join(" ")} ; do ${mergeCommand} "$i" >> linkedConnections.${ext}${gz} && rm "$i" || break ; done`, { cwd: output });
               let t1 = new Date();
               console.error('linkedConnections.' + ext + ' File created in ' + (t1.getTime() - t0.getTime()) + ' ms');
               await del(
                  [
                     output + '/connections_*',
                     output + '/stops.db',
                     output + '/routes.db',
                     output + '/trips.db',
                     output + '/services.db'
                  ],
                  { force: true }
               );
               done(`${output}/linkedConnections.${ext}`);
            } catch (err) {
               throw err;
            }
         }
      }).on('error', err => {
         console.error(err);
      }).on('exit', (code) => {
         if (code !== 0) {
            console.error(new Error(`Worker stopped with exit code ${code}`));
         }
      });
   }
};

async function cleanUpSources(sources) {
   try {
      await exec(`${path.resolve(`${__dirname}/../bin/gtfs2lc-clean.sh`)} ${sources}`);
   } catch (err) {
      console.error(err);
      throw new Error('Process gtfs2lc-clean.sh exit with code: ' + code);
   }
}

async function appendLineBreaks(output) {
   const files = (await readdir(output)).filter(raw => raw.startsWith('raw_'));
   const promises = [];
   for (const [i, f] of files.entries()) {
      if (i < files.length - 1) {
         promises.push(exec(`echo "" | gzip >> ${f}`, { cwd: output }));
      }
   }

   await Promise.all(promises);
}

async function removePrefixes(output) {
   const files = (await readdir(output)).filter(raw => raw.startsWith('raw_'));
   const promises = [];
   for (const [i, f] of files.entries()) {
      if (i > 0) {
         // TODO: find a not hard-coded way to remove prefixes
         promises.push(exec(`zcat ${f} | tail -n +4 | gzip > ${f}.temp && mv ${f}.temp ${f}`, { cwd: output }))
      }
   }

   await Promise.all(promises);
}

// Code executed only on a Worker Thread
if (!isMainThread) {
   let fmt = 'json';
   // Read the connection rules file created in the master thread and build the Connection objects!
   // Use a low highWaterMark to prevent backpressure memory leaks given that this is an inflating pipeline.
   let connectionStream = fs.createReadStream(
      `${workerData['output']}/connections_${workerData['instance']}.txt`,
      { encoding: 'utf8', objectMode: true, highWaterMark: 4 * 1024 }
   ).pipe(JSONLParser())
      .pipe(new ConnectionsBuilder())
      .on('error', function (e) {
         console.error(e);
      });

   // Now, proceed to parse the connections according to the requested format
   const format = workerData['options']['format'];
   if (!format || ['json', 'mongo'].includes(format)) {
      if (format === 'mongo') {
         connectionStream = connectionStream.pipe(new Connections2Mongo());
      }
      connectionStream = connectionStream.pipe(new JSONLStringer());
   } else if (['jsonld', 'mongold'].includes(format)) {
      let context = undefined;
      // Only include the context for the first instance
      if (workerData['instance'] === 0) {
         context = {
            '@context': {
               lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
               gtfs: 'http://vocab.gtfs.org/terms#',
               xsd: 'http://www.w3.org/2001/XMLSchema#',
               trip: { '@type': '@id', '@id': 'gtfs:trip' },
               Connection: 'lc:Connection',
               CancelledConnection: 'lc:CancelledConnection',
               departureTime: { '@type': 'xsd:dateTime', '@id': 'lc:departureTime' },
               departureStop: { '@type': '@id', '@id': 'lc:departureStop' },
               arrivalStop: { '@type': '@id', '@id': 'lc:arrivalStop' },
               arrivalTime: { '@type': 'xsd:dateTime', '@id': 'lc:arrivalTime' },
            }
         };
      }
      // Convert json object stream to jsonld stream
      connectionStream = connectionStream.pipe(new Connections2JSONLD(workerData['options']['baseUris'], context));

      if (format === 'mongold') {
         connectionStream = connectionStream.pipe(new Connections2Mongo());
      }
      // Pipe the objects to a file
      connectionStream = connectionStream.pipe(new JSONLStringer());
   } else if (format === 'csv') {
      fmt = 'csv';
      // Only include the header on the first file
      let header = false;
      if (workerData['instance'] === 0) {
         header = true;
      }
      connectionStream = connectionStream.pipe(new Connections2CSV(header));
   } else if (format === 'turtle') {
      fmt = 'ttl';
      let prefixes = {
         lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
         gtfs: 'http://vocab.gtfs.org/terms#',
         xsd: 'http://www.w3.org/2001/XMLSchema#'
      };
      connectionStream = connectionStream.pipe(new Connections2Triples(workerData['options']['baseUris']))
         .pipe(new N3.StreamWriter({ prefixes: prefixes }));
   } else if (format === 'ntriples') {
      fmt = 'nt';
      connectionStream = connectionStream.pipe(new Connections2Triples(workerData['options']['baseUris']))
         .pipe(new N3.StreamWriter({ format: 'N-Triples' }));
   }

   connectionStream.on('finish', () => {
      parentPort.postMessage('done');
   });

   connectionStream.pipe(zlib.createGzip())
      .pipe(fs.createWriteStream(`${workerData['output']}/raw_${workerData['instance']}.${fmt}.gz`));

}

module.exports = Mapper;
