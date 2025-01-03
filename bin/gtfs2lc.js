#!/usr/bin/env node

const program = require('commander');
const gtfs2lc = require('../lib/gtfs2lc.js');
const fs = require('fs');
const del = require('del');

console.error("GTFS to linked connections converter use --help to discover more functions");

program
  .option('-f, --format <format>', 'Format of the output. Possibilities: csv, n-triples, turtle, json, jsonld, mongo (extended JSON format to be used with mongoimport) or mongold (default: json)')
  .option('-b, --baseUris <baseUris>', 'Path to a file that describes the baseUris in json')
  .option('-o, --output <output>', 'Path to the folder where the result file will be stored')
  .option('-c, --compressed', 'Compress resulting connections file using gzip')
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

const output = program.output || program.path;
if (output.endsWith('/')) {
  output = output.slice(0, -1);
}

var baseUris = null;
if (program.baseUris) {
  baseUris = JSON.parse(fs.readFileSync(program.baseUris, 'utf-8'));
}

process.on('SIGINT', async () => {
  console.error("\nSIGINT Received, cleaning up...");
  await del(
    [
      output + '/.stops',
      output + '/.routes',
      output + '/.trips',
      output + '/.services',
      output + '/raw_*'
    ],
    { force: true }
  );
  console.error("Cleaned up!");
});

async function run() {
  console.error(`Converting GTFS to Linked Connections...`);
  const mapper = new gtfs2lc.Connections({
    store: !program.store || program.store === 'undefined' ? 'MemStore' : program.store,
    format: !program.format || program.format === 'undefined' ? 'json' : program.format,
    compressed: program.compressed,
    fresh: program.fresh,
    baseUris: baseUris
  });

  const connectionsFile = await mapper.convert(program.path, output);

  if (program.stream) {
    fs.createReadStream(connectionsFile).pipe(process.stdout);
  } else {
    console.error(`Linked Connections successfully created at ${connectionsFile}`);
  }
}

run();
