#!/usr/bin/env node

var csv = require('fast-csv'),
    fs = require('fs'),
    St2C = require('../lib/stoptimes/st2c.js');

var stopTimes = fs.createReadStream('stop_times.txt', { encoding: 'utf8', objectMode: true }).pipe(csv.parse({ objectMode: true, headers: true })).on('error', function (e) {
  console.error(e);
});
var connectionRules = stopTimes.pipe(new St2C());

connectionRules.on('data', row => {
  printConnectionRule(row);
});
connectionRules.on('end', () => {
  console.error('Converted ' + printedRows + ' stoptimes to connections');
});

var printConnectionHeader = function (row) {
  console.log(Object.keys(row).join(','));
};

var printedRows = 0;
var printConnectionRule = function (row) {
  if (printedRows === 0) {
    printConnectionHeader(row);
  }
  console.log(Object.values(row).join(','));
  printedRows++;
}

