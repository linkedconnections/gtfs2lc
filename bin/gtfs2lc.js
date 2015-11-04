#!/usr/bin/env node

var program = require('commander'),
    Mapper = require('../lib/gtfs2lc.js');

console.error("GTFS to linked connections converter use --help to discover more functions");

program
    .version('0.1.0')
    .option('-p, --path <path>', 'Path to sorted GTFS files (default: ./)')
    .parse(process.argv);

if (!program.path) {
    program.path = './'
}

var mapper = new Mapper();
mapper.resultStream(program.path, function (stream) {
  stream.on('data', function (connection) {
    console.log(JSON.stringify(connection));
  });
});
