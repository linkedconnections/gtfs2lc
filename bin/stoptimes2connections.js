#!/usr/bin/env node

const csv = require('fast-csv');
const fs = require('fs');
const readline = require('readline');
const St2C = require('../lib/stoptimes/st2c.js');
const numCPUs = require('os').cpus().length;

// Fragment trips.txt accordingly to the number fo available CPU processors
var trips = fs.createReadStream('trips.txt', { encoding: 'utf8' })
  .pipe(csv.parse({ objectMode: true, headers: true, quote: '"' }))
  .on('error', function (e) {
    console.error(e);
  });
var tripsPool = createWriteStreams('trips');
var tripIndex = -1;

trips.on('data', trip => {
  if (tripIndex === -1) {
    for (let i in tripsPool) {
      tripsPool[i].write(Object.keys(trip));
    }
    tripIndex++;
  }

  tripsPool[tripIndex].write(Object.values(trip));
  tripIndex = tripIndex < numCPUs - 1 ? tripIndex + 1 : 0;
});

trips.on('end', () => {
  for (let i in tripsPool) {
    tripsPool[i].end();
  }
});

// Also fragment stop_times.txt 
var stopTimes = fs.createReadStream('stop_times.txt', { encoding: 'utf8', objectMode: true })
  .pipe(csv.parse({ objectMode: true, headers: true, quote: '"' }))
  .on('error', function (e) {
    console.error(e);
  });

var connectionsPool = createWriteStreams('connections');
var connIndex = -1;
var currentTrip = null;
var printedRows = 0;

var connectionRules = stopTimes.pipe(new St2C());

connectionRules.on('data', row => {
  if (connIndex === -1) {
    for (let i in connectionsPool) {
      connectionsPool[i].write(Object.keys(row));
    }
  }

  if (row['trip_id'] !== currentTrip) {
    currentTrip = row['trip_id'];
    connIndex = connIndex < numCPUs - 1 ? connIndex + 1 : 0;
  }

  connectionsPool[connIndex].write(Object.values(row))
  printedRows++;
});

connectionRules.on('end', () => {
  for (let i in connectionsPool) {
    connectionsPool[i].end();
  }
  console.error('Converted ' + printedRows + ' stop_times to connections');
});

function createWriteStreams(name) {
  let writers = [];
  for (let i = 0; i < numCPUs; i++) {
    const stream = csv.format();
    stream.pipe(fs.createWriteStream(name + '_' + i + '.txt', { encoding: 'utf8' }));
    writers.push(stream);
  }

  return writers;
}
