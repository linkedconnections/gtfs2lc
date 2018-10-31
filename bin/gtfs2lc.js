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
  .option('-b, --baseUris <baseUris>', 'path to a file containing the baseUris templates in json format')
  .option('-fb, --fragmentBy <fragmentBy>', 'column name in stop_times.txt that determines fragmentation')
  .option('-fi, --fragmentIndex <fragmentIndex>', 'path to a file containing the index that determines fragmentation')
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

var baseUris = null;
if (program.baseUris) {
  baseUris = JSON.parse(fs.readFileSync(program.baseUris, 'utf-8'));
}

var fragmentIndex = null;
if (program.fragmentIndex) {
  fragmentIndex = new Map(JSON.parse(fs.readFileSync(program.fragmentIndex, 'utf8')));
}

var mapper = new gtfs2lc.Connections(program.path, {
  format: program.format,
  baseUris: baseUris,
  startDate: program.startDate,
  endDate: program.endDate,
  store: program.store,
  fragmentBy: program.fragmentBy,
  fragmentIndex: fragmentIndex
});

mapper.map().then(files => {
  console.error('Linked Connections created successfully here:');
  console.error(files);
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
