#!/usr/bin/env node

var program = require('commander'),
    gtfs2lc = require('../lib/gtfs2lc.js'),
    MongoStream = require('../lib/Connections2Mongo.js'),
    N3 = require('n3'),
    jsonldstream = require('jsonld-stream'),
    Connections2JSONLD = require('../lib/Connections2JSONLD.js'),
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

var mapper = new gtfs2lc.Connections({
  store : program.store
});

var baseUris = null;
if (program.baseUris) {
  baseUris = JSON.parse(fs.readFileSync(program.baseUris, 'utf-8'));
}

var resultStream = null;
mapper.resultStream(program.path, function (stream, stopsdb) {
  resultStream = stream;
  if (!program.format || program.format === "json") {
    stream.on('data', function (connection) {
      console.log(JSON.stringify(connection));
    })
  } else if (program.format === 'mongo') {
    stream.pipe(new MongoStream()).on('data', function (connection) {
      console.log(JSON.stringify(connection));
    });
  } else if (program.format === 'csv') {
    //print header
    console.error('The CSV output is not using a Linked Data format – jsonld is the preferred format.');
    console.log('"id","departureStop","departureTime","arrivalStop","arrivalTime","trip","route","headsign"');
    var count = 0;
    
    stream.on('data', function (connection) {
      console.log(count + ',' + connection["departureStop"] + ',' + connection["departureTime"].toISOString() + ',' +  connection["arrivalStop"] + ',' +  connection["arrivalTime"].toISOString() + ',' + connection["trip"]["trip_id"] + ',' + connection.trip.route.route_id + ',"' + connection.headsign + '"');
      count ++;
    });
  } else if (['jsonld','mongold'].indexOf(program.format) > -1) {
    var context = {
      '@context' : {
        lc: 'http://semweb.mmlab.be/ns/linkedconnections#',
        gtfs : 'http://vocab.gtfs.org/terms#',
        xsd: 'http://www.w3.org/2001/XMLSchema#',
        trip : { '@type' : '@id', '@id' : 'gtfs:trip' },
        Connection : 'lc:Connection',
        CancelledConnection: 'lc:CancelledConnection',
        departureTime : { '@type' : 'xsd:dateTime', '@id' : 'lc:departureTime' },
        departureStop : { '@type' : '@id', '@id' : 'lc:departureStop' },
        arrivalStop : { '@type' : '@id', '@id' : 'lc:arrivalStop' },
        arrivalTime : { '@type' : 'xsd:dateTime', '@id' : 'lc:arrivalTime' },
      }
    };
    //convert triples stream to jsonld stream
    stream = stream.pipe(new Connections2JSONLD(baseUris, stopsdb, context));
    //prepare the output
    if (program.format === 'mongold') {
      //convert JSONLD Stream to MongoDB Stream
      stream = stream.pipe(new MongoStream());
    }
    stream = stream.pipe(new jsonldstream.Serializer()).pipe(process.stdout);
  } else if (['ntriples','turtle'].indexOf(program.format) > -1) {
    stream = stream.pipe(new gtfs2lc.Connections2Triples(baseUris, stopsdb));
    if (program.format === 'ntriples') {
      stream = stream.pipe(new N3.StreamWriter({ format : 'N-Triples'}));
    } else if (program.format === 'turtle') {
      stream = stream.pipe(new N3.StreamWriter({ prefixes: { lc: 'http://semweb.mmlab.be/ns/linkedconnections#', gtfs : 'http://vocab.gtfs.org/terms#', xsd: 'http://www.w3.org/2001/XMLSchema#' } }));
    }
    stream.pipe(process.stdout);
  }
  stream.on('error', error => {
    console.error(error);
  });
  stream.on('finish', function () {
    console.error('Stream ended - everything should be fully converted!');
    //clean up the leveldb
    deleteFolderRecursive(program.path + "/.services");
    deleteFolderRecursive(program.path + "/.trips");
  });
});

process.on('SIGINT', function () {
  console.error("\nSIGINT Received – Cleaning up");
  if (resultStream) {
    resultStream.end();
  } else {
    deleteFolderRecursive(program.path + "/.services");
    deleteFolderRecursive(program.path + "/.trips");
  }
  process.exit(0);
});
