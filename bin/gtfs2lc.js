#!/usr/bin/env node

var program = require('commander'),
    gtfs2lc = require('../lib/gtfs2lc.js'),
    N3 = require('n3'),
    jsonldstream = require('jsonld-stream');

console.error("GTFS to linked connections converter use --help to discover more functions");

program
  .version('0.3.0')
  .option('-p, --path <path>', 'Path to sorted GTFS files (default: ./)')
  .option('-f, --format <format>', 'Format of the output. Possibilities: csv, ntriples, turtle, json or jsonld (default: json)')
  .option('-s, --startDate <startDate>', 'startDate in YYYYMMDD format')
  .option('-e, --endDate <endDate>', 'endDate in YYYYMMDD format')
  .parse(process.argv);

if (!program.path) {
  console.error('Give a path using the -p option');
  process.exit();
}

var mapper = new gtfs2lc.Connections({
  startDate : program.startDate,
  endDate : program.endDate
});
mapper.resultStream(program.path, function (stream) {
  if (!program.format || program.format === "json") {
    stream.on('data', function (connection) {
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
  } else if (['ntriples','turtle','jsonld'].indexOf(program.format) > -1) {
    stream = stream.pipe(new gtfs2lc.Connections2Triples()); //TODO: add configurable base uris here.
    if (program.format === 'ntriples') {
      stream = stream.pipe(new N3.StreamWriter({ format : 'N-Triples'}));
    } else if (program.format === 'turtle') {
      stream = stream.pipe(new N3.StreamWriter({ prefixes: { lc: 'http://semweb.mmlab.be/ns/linkedconnections#', gtfs : 'http://vocab.gtfs.org/terms#', xsd: 'http://www.w3.org/2001/XMLSchema#' } }));
    } else if (program.format === 'jsonld') {
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
      stream = stream.pipe(new jsonldstream.TriplesToJSONLDStream(context)).pipe(new jsonldstream.Serializer());
    }
    stream.pipe(process.stdout);
  }
});
