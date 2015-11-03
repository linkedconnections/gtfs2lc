#!/usr/bin/env node
/* Pieter Colpaert */

/**
 * This script reads an unzipped GTFS archive and maps it to a stream of connections
 */

var fs = require('fs'),
    N3 = require('n3'),
    N3Util = N3.util,
    program = require('commander'),
    Mapper = require('./lib/gtfs2lc.js');

console.error("GTFS to Linked Connections convertor. Use --help to discover more options.");

var die = function (msg) {
  console.log(msg);
  process.exit();
}

//check whether the location of the zip has been set and zip exists
var path = "",
    version = "",
    baseuri = "";
if (process.argv[2]) {
  path = process.argv[2];
}else {
  die("Give a path towards your gtfs feed as a first argument");
}

if (!fs.existsSync(path)) {
  die(path + " not found");
}

//get the feedname: the name of the zip file
if (/(.*\/)?(.*?)\.zip/.exec(path)) {
  var feedname = /(.*\/)?(.*?)\.zip/.exec(path)[2];
} else {
  die ("Not a zipfile: " + path);
}

var mapper = new Mapper({feedname: feedname});
mapper.promiseConnectionsStream(fs.createReadStream(path)).then(function (stream) {
  stream.on("data", function (data) {
    console.log(data);
  }).on("error", function (error) {
    console.error(error);
  });
});
