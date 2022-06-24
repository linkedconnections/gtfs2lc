#!/usr/bin/env node

var program = require('commander'),
  gtfs2lc = require('../lib/gtfs2lc.js'),
  fs = require('fs'),
  del = require('del');

console.error("GTFS to linked connections converter use --help to discover more functions");

program
  .option('-f, --format <format>', 'Format of the output. Possibilities: csv, n-triples, turtle, json, jsonld, mongo (extended JSON format to be used with mongoimport) or mongold (default: json)')
  .option('-b, --baseUris <baseUris>', 'Path to a file that describes the baseUris in json')
  .option('-o, --output <output>', 'Path to the folder where the result file will be stored')
  .option('-s, --stream', 'Get the connections as a stream on the standard output')
  .option('-S, --store <store>', 'Store type: LevelStore (uses your disk to avoid that you run out of RAM) or MemStore (default)')
  .option('--fresh', 'Make sure to convert all Connection and ignore existing Historic records (which will be deleted)')
  .arguments('<path>', 'Path to sorted GTFS files')
  .action(function (path) {
    program.path = path;
  })
  .parse(process.argv);

if (!program.path) {
  console.error('Please provide a path to the extracted (and sorted using gtfs2lc-sort) GTFS folder as the first argument');
  process.exit(1);
}

if (program.path.endsWith('/')) {
  program.path = program.path.slice(0, -1);
}

var output = program.output || program.path;
if (output.endsWith('/')) {
  output = output.slice(0, -1);
}

var baseUris = null;
if (program.baseUris) {
  baseUris = JSON.parse(fs.readFileSync(program.baseUris, 'utf-8'));
}

var mapper = new gtfs2lc.Connections({
  store: !program.store || program.store === 'undefined' ? 'MemStore' : program.store,
  format: !program.format || program.format === 'undefined' ? 'json' : program.format,
  fresh: program.fresh,
  baseUris: baseUris
});

var resultStream = null;
mapper.resultStream(program.path, output, function (path) {
  if (program.stream) {
    fs.createReadStream(path).pipe(process.stdout);
  } else {
    console.error('Linked Connections successfully created at ' + path + '!');
  }
});

process.on('SIGINT', function () {
  console.error("\nSIGINT Received – Cleaning up");
  if (resultStream) {
    resultStream.end();
  } else {
    del([
      output + '/.stops',
      output + '/.routes',
      output + '/.trips',
      output + '/.services',
      output + '/raw_*'
    ],
      { force: true })
    .then(function () {
      process.exit(0);
    }, function (err) {
      console.error(err);
      process.exit(1);
    });
  }
});
