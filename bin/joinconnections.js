#!/usr/bin/env node

const csv = require('fast-csv'),
      fs = require('fs');
const separator = '|&AND&|';

var connectionRules = fs.createReadStream('connections.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).on('error', function (e) {
  console.error(e);
});

var previous = null;

connectionRules.on('data', connectionRule => {  
  if (previous) {
    //Check if the common factors are indeed the same
    if (connectionRule.arrival_time === previous.arrival_time && connectionRule.departure_time === previous.departure_time && connectionRule.departure_stop === previous.departure_stop && connectionRule.arrival_stop === previous.arrival_stop) {
      console.error('WARNING: Joining 2 trips from the GTFS that I believe are joining into one: ' + previous.trip_id + " and " + connectionRule.trip_id);
      mergedConnectionRule = null;
      //See the documentation: https://support.google.com/transitpartners/answer/7084064?hl=en
      //If the pickup type is 1 while the other isn’t merge it with the connectionRule where the pickupType was 0
      if (connectionRule.pickup_type === "1" && previous.pickup_type !== "1") {
        mergedConnectionRule = previous;
        mergedConnectionRule.trip_id += separator + connectionRule.trip_id;
      } else if (previous.pickup_type === "1" && connectionRule.pickup_type !== "1") {
        mergedConnectionRule = connectionRule;
        mergedConnectionRule.trip_id += separator + previous.trip_id;
      }
      //If the drop-off type is different, then merge it with the one where dropOffType is 0
      if (connectionRule.drop_off_type === "1" && previous.drop_off_type !== "1") {
        mergedConnectionRule = previous;
        mergedConnectionRule.trip_id += separator + connectionRule.trip_id;
      } else if (previous.drop_off_type === "1" && connectionRule.drop_off_type !== "1") {
        mergedConnectionRule = connectionRule;
        mergedConnectionRule.trip_id += separator + previous.trip_id;
      }
      previous = mergedConnectionRule;
    } else {
      printConnectionRule(previous);
      previous = connectionRule;
    }
  } else {
    previous = connectionRule;
  }
});

connectionRules.on('end', () => {
  if (previous)
    printConnectionRule(previous);
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

