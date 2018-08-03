#!/usr/bin/env node

const program = require('commander');
const gtfs2lc = require('../lib/gtfs2lc.js');
const MongoStream = require('../lib/Connections2Mongo.js');
const N3 = require('n3');
const jsonldstream = require('jsonld-stream');
const Connections2JSONLD = require('../lib/Connections2JSONLD.js');
const fs = require('fs');
const del = require('del');

console.error("GTFS to linked connections converter use --help to discover more functions");

program
  .option('-f, --format <format>', 'Format of the output. Possibilities: csv, ntriples, turtle, json, jsonld (default: json), mongo (extended JSON format to be used with mongoimport) or mongold')
  .option('-s, --startDate <startDate>', 'startDate in YYYYMMDD format')
  .option('-e, --endDate <endDate>', 'endDate in YYYYMMDD format')
  .option('-b, --baseUris <baseUris>', 'path to a file that describes the baseUris in json')
  .option('-S, --store <store>', 'store type: LevelStore (uses your harddisk - for if you run out of RAM) or MemStore (default)')
  .arguments('<path>', 'Path to sorted GTFS files')
  .action(function (path) {
    program.path = path;
  })
  .parse(process.argv);

if (!program.path) {
  console.error('Please provide a path to the extracted (and sorted using gtfs2lc-sort) GTFS folder as the first argument');
  process.exit();
}

var mapper = new gtfs2lc.Connections(program.path, {
  startDate: program.startDate,
  endDate: program.endDate,
  store: program.store
});

var baseUris = null;
if (program.baseUris) {
  baseUris = JSON.parse(fs.readFileSync(program.baseUris, 'utf-8'));
}

mapper.getConnectionsByZones().then(connectionSources => {
  Object.keys(connectionSources).forEach(key => {
    let stream = connectionSources[key];
    if (!program.format || program.format === "json") {
      stream.on('data', connection => {
        console.log(JSON.stringify(connection));
      });
    } else if (program.format === 'mongo') {
      stream.pipe(new MongoStream()).on('data', connection => {
        console.log(JSON.stringify(connection));
      });
    } else if (program.format === 'csv') {
      //print header
      console.log('"id","departureStop","departureTime","arrivalStop","arrivalTime","trip","route","operationZone"');
      var count = 0;
      stream.on('data', connection => {
        console.log(count + ',' + connection["departureStop"] + ',' + connection["departureTime"].toISOString() + ','
          + connection["arrivalStop"] + ',' + connection["arrivalTime"].toISOString() + ',' + connection["trip"]["trip_id"] + ','
          + connection["trip"]["route_id"] + ',' + connection["operationZone"]);
        count++;
      });
    } else if (['jsonld', 'mongold'].indexOf(program.format) > -1) {
      //convert triples stream to jsonld stream
      stream = stream.pipe(new Connections2JSONLD(baseUris));
      //prepare the output
      if (program.format === 'mongold') {
        //convert JSONLD Stream to MongoDB Stream
        stream = stream.pipe(new MongoStream());
      }
      stream = stream.on('data', connection => {
        console.log(JSON.stringify(connection));
      });
    } else if (['ntriples', 'turtle'].indexOf(program.format) > -1) {
      stream = stream.pipe(new gtfs2lc.Connections2Triples(baseUris));
      if (program.format === 'ntriples') {
        stream = stream.pipe(new N3.StreamWriter({ format: 'N-Triples' }));
      } else if (program.format === 'turtle') {
        stream = stream.pipe(new N3.StreamWriter({
          prefixes: {
            lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
            gtfs: 'http://vocab.gtfs.org/terms#',
            xsd: 'http://www.w3.org/2001/XMLSchema#',
            schema: "http://schema.org/"
          }
        }));
      }

      stream.on('data', triple => {
        console.log(triple);
      });
    }

    stream.on('end', () => {
      cleanUp();
    });
  });
}).catch(err => {
  console.error(err);
  process.exit();
});

process.on('SIGINT', function () {
  console.error("\nCleaning up");
  cleanUp();
});

function cleanUp() {
  del([
    program.path + 'tmp',
    program.path + '.routes',
    program.path + '.trips',
    program.path + '.services',
    program.path + '.stops'
  ], { force: true })
    .then(() => {
      console.error('The process was properly closed');
      process.exit(0);
    });
}
