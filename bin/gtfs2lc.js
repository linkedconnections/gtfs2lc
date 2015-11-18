#!/usr/bin/env node

var program = require('commander'),
    gtfs2lc = require('../lib/gtfs2lc.js'),
    MongoStream = require('../lib/Connections2Mongo.js'),
    N3 = require('n3'),
    jsonldstream = require('jsonld-stream'),
    fs = require('fs');

//ty http://www.geedew.com/remove-a-directory-that-is-not-empty-in-nodejs/
var deleteFolderRecursive = function(path) {
  if (fs.existsSync(path)) {
    fs.readdirSync(path).forEach(function (file,index){
      var curPath = path + "/" + file;
      if(fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(path);
  }
};

console.error("GTFS to linked connections converter use --help to discover more functions");

program
  .option('-f, --format <format>', 'Format of the output. Possibilities: csv, ntriples, turtle, json, jsonld (default: json), mongo (extended JSON format to be used with mongoimport) or mongold')
  .option('-s, --startDate <startDate>', 'startDate in YYYYMMDD format')
  .option('-e, --endDate <endDate>', 'endDate in YYYYMMDD format')
  .option('-b, --baseUris <baseUris>', 'path to a file that describes the baseUris in json')
  .option('-S, --store <store>', 'store type: LevelStore (uses your harddisk - for if you run out of RAM) or MemStore (default)')
  .option('-h --host [host]', 'host of a mongodb instance (default: localhost)')
  .option('-d --db [db]', 'database name within the mongodb instance (default: standard db)')
  .option('-c --collection [collection]', 'collection of mongodb (default: connections)')
  .option('--port', 'port of the mongodb (default: 27017)')
  .arguments('<path>', 'Path to sorted GTFS files')
  .action(function (path) {
    program.path = path;
  })
  .parse(process.argv);

if (!program.path) {
  console.error('Please provide a path to the extracted (and sorted using gtfs2lc-sort) GTFS folder as the first argument');
  process.exit();
}

var mapper = new gtfs2lc.Connections({
  startDate : program.startDate,
  endDate : program.endDate,
  store : program.store
});

var baseUris = null;
if (program.baseUris) {
  baseUris = JSON.parse(fs.readFileSync(program.baseUris, 'utf-8'));
}

var resultStream = null;
mapper.resultStream(program.path, function (stream) {
  resultStream = stream;
  if (!program.format || program.format === "json") {
    stream.on('data', function (connection) {
      console.log(JSON.stringify(connection));
    });
  } else if (program.format === 'mongo') {
    stream.pipe(new MongoStream()).on('data', function (connection) {
      console.log(JSON.stringify(connection));
    });
  } else if (program.format === 'csv') {
    //print header
    console.log('"id","departureStop","departureTime","arrivalStop","arrivalTime","trip"');
    var count = 0;
    stream.on('data', function (connection) {
      console.log(count + ',' + connection["departureStop"] + ',' + connection["departureTime"].toISOString() + ',' +  connection["arrivalStop"] + ',' +  connection["arrivalTime"].toISOString() + ',' + connection["trip"]);
      count ++;
    });
  } else if (['ntriples','turtle','jsonld','mongold'].indexOf(program.format) > -1) {
    stream = stream.pipe(new gtfs2lc.Connections2Triples(baseUris));
    if (program.format === 'ntriples') {
      stream = stream.pipe(new N3.StreamWriter({ format : 'N-Triples'}));
    } else if (program.format === 'turtle') {
      stream = stream.pipe(new N3.StreamWriter({ prefixes: { lc: 'http://semweb.mmlab.be/ns/linkedconnections#', gtfs : 'http://vocab.gtfs.org/terms#', xsd: 'http://www.w3.org/2001/XMLSchema#' } }));
    } else if (program.format === 'jsonld' || program.format === 'mongold') {
      var context = {
        '@context' : {
          lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
          gtfs : 'http://vocab.gtfs.org/terms#',
          xsd: 'http://www.w3.org/2001/XMLSchema#',
          trip : { '@type' : '@id', '@id' : 'gtfs:trip' },
          Connection : 'lc:Connection',
          departureTime : { '@type' : 'xsd:dateTime', '@id' : 'lc:departureTime' },
          departureStop : { '@type' : '@id', '@id' : 'lc:departureStop' },
          arrivalStop : { '@type' : '@id', '@id' : 'lc:arrivalStop' },
          arrivalTime : { '@type' : 'xsd:dateTime', '@id' : 'lc:arrivalTime' },
        }
      };
      //convert triples stream to jsonld stream
      stream = stream.pipe(new jsonldstream.TriplesToJSONLDStream(context));
      //prepare the output
      if (program.format === 'mongold') {
        //convert JSONLD Stream to MongoDB Stream
        stream = stream.pipe(new MongoStream());
      }
      stream = stream.pipe(new jsonldstream.Serializer());
    }
    stream.pipe(process.stdout);
  }
  stream.on('end', function () {
    //clean up the leveldb
    deleteFolderRecursive(program.path + "/.services");
    deleteFolderRecursive(program.path + "/.trips");
  });
});

process.on('SIGINT', function () {
  console.error("\nCleaning up");
  if (resultStream) {
    resultStream.end();
  } else {
    deleteFolderRecursive(program.path + "/.services");
    deleteFolderRecursive(program.path + "/.trips");
  }
  process.exit(0);
});
