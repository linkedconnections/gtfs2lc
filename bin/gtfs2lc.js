#!/usr/bin/env node

var program = require('commander'),
    Mapper = require('../lib/gtfs2lc.js'),
    fs = require('fs');

console.error("GTFS to linked connections converter use --help to discover more functions");

program
    .version('0.1.0')
    .option('-p, --path <s>', 'Path to sorted GTFS files')
    .parse(process.argv);

if (!program.path) {
    program.path = './'
}

console.log(program.path);

var mapper = new Mapper();
mapper.getStoreFromGTFSFiles([], function () {

});