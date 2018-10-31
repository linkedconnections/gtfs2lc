const cluster = require('cluster');
const EventEmitter = require('events');
const fs = require('fs');
const util = require('util');
const csv = require('fast-csv');
const N3 = require('n3');
const Store = require('./stores/Store.js');
const ConnectionRules = require('./stoptimes/st2c.js');
const ConnectionsBuilder = require('./ConnectionsBuilder.js');
const gtfs2lc = require('./gtfs2lc.js');
const jsonldstream = require('jsonld-stream');
const eventEmitter = new EventEmitter();

/**
 * Function to get the EventEmitter that allows communication between 
 * the master process and the sub-processes.
 */
var init = () => {
    return eventEmitter;
};

/**
 * Function that execute clustering based on the splitted files found in 
 * the provided path folder. 
 */
var execute = params => {
    // If no main folder path or specific file path is provided don't do anything 
    if ((params && params.path) || (process.argv[2] && cluster.isWorker)) {
        // Check if is the master cluster
        if (cluster.isMaster) {
            let workersCount = 0;
            let files = fs.readdirSync(params.path + '/tmp');
            let filesCount = files.length;
            let fileRefs = [];

            // Create output folder
            if (!fs.existsSync(params.path + '/linked_connections')) {
                fs.mkdirSync(params.path + '/linked_connections');
            }


            // Iterate over files found in given main folder path
            for (let i in files) {
                // Configure cluster to run this script and give a specific 
                // file path as a parameter
                cluster.setupMaster({
                    exec: './lib/ClusterHandler.js',
                    args: [params.path, files[i]]
                });

                // Create sub-process
                let worker = cluster.fork();
                // Send necessary parameters to sub-process to start creating
                // the connections
                worker.send({
                    store: params.store,
                    format: params.format,
                    baseUris: params.baseUris,
                    stops: params.stopsdb,
                    trips: params.tripsdb,
                    routes: params.routesdb,
                    services: params.servicesdb
                });

                // Keep a reference for the connections file that will be created
                fileRefs.push({
                    path: params.path + '/linked_connections/',
                    name: files[i].split('.')[0],
                    format: params.format
                });
            }

            // Notify main process when all sub-processes have finished
            cluster.on('exit', (worker, code, signal) => {
                workersCount++;
                if (workersCount >= filesCount) {
                    eventEmitter.emit('end', fileRefs);
                }
            });
        } else {
            // Here is the logic executed only in forked clusters or sub-processes
            let path = process.argv[2];
            let fileName = process.argv[3];

            // Function that receives required parameters to start creating connections
            process.on('message', async indexes => {
                let stopsdb = Store(indexes.store, indexes.stops.name, indexes.stops._store);
                let routesdb = Store(indexes.store, indexes.routes.name, indexes.routes._store);
                let tripsdb = Store(indexes.store, indexes.trips.name, indexes.trips._store);
                let servicesdb = Store(indexes.store, indexes.services.name, indexes.services._store);
                let format = indexes.format;
                let baseUris = indexes.baseUris;

                let connections = fs.createReadStream(path + '/tmp/' + fileName, { encoding: 'utf8', objectMode: true })
                    .pipe(csv({ objectMode: true, headers: true }))
                    .pipe(new ConnectionRules(stopsdb))
                    .pipe(new ConnectionsBuilder(tripsdb, servicesdb, routesdb));

                if (!format || format === 'json') {
                    connections = connections.pipe(new jsonldstream.Serializer())
                        .pipe(new fs.createWriteStream(path + '/linked_connections/' + fileName.split('.')[0] + '.json', 'utf8'));
                } else if (format === 'jsonld') {
                    connections = connections.pipe(new gtfs2lc.Connections2JSONLD(baseUris))
                        .pipe(new jsonldstream.Serializer())
                        .pipe(new fs.createWriteStream(path + '/linked_connections/' + fileName.split('.')[0] + '.jsonld', 'utf8'));
                } else if (format === 'turtle') {
                    connections = connections.pipe(new gtfs2lc.Connections2Triples(baseUris))
                        .pipe(new N3.StreamWriter({
                            prefixes: {
                                lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
                                gtfs: 'http://vocab.gtfs.org/terms#',
                                xsd: 'http://www.w3.org/2001/XMLSchema#',
                                schema: "http://schema.org/"
                            }
                        }))
                        .pipe(new fs.createWriteStream(path + '/linked_connections/' + fileName.split('.')[0] + '.ttl', 'utf8'));
                } else if (format === 'ntriples') {
                    connections = connections.pipe(new gtfs2lc.Connections2Triples(baseUris))
                        .pipe(new N3.StreamWriter({ format: 'N-Triples' }))
                        .pipe(new fs.createWriteStream(path + '/linked_connections/' + fileName.split('.')[0] + '.n3', 'utf8'));
                }

                connections.on('error', e => {
                    console.error(e);
                    process.exit();
                }).on('finish', () => {
                    // Finished producing connections, kill this sub-process
                    process.exit();
                });
            });
        }
    }
};

module.exports = {
    init: init,
    execute: execute
};
execute();