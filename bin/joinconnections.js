#!/usr/bin/env node

const csv = require('fast-csv'),
      fs = require('fs');
const separator = '|&AND&|';

var connectionRules = fs.createReadStream('connections.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).on('error', function (e) {
  console.error(e);
});

var previous = null;

connectionRules.on('data', connectionRule => {
  connectionRule.will_split_into = "";
  connectionRule.joined_with = "";
  if (previous) {
    //Check if arrivaltime, departuretime, departurestop and arrival stop are the same. Then there’s a possibility this is a joined train.
    if (connectionRule.arrival_time === previous.arrival_time && connectionRule.departure_time === previous.departure_time && connectionRule.departure_stop === previous.departure_stop && connectionRule.arrival_stop === previous.arrival_stop) {
      mergedConnectionRule = null;
      //See the documentation: https://support.google.com/transitpartners/answer/7084064?hl=en

      //### JOINING TRAINS
      //If the pickup type is 1 while the other isn’t merge it with the connectionRule where the pickupType was 0
      if (connectionRule.pickup_type === "1" && previous.pickup_type !== "1") {
        mergedConnectionRule = previous;
        if (mergedConnectionRule.joined_with !== '')
          mergedConnectionRule.joined_with += separator
        mergedConnectionRule.joined_with += connectionRule.trip_id;
      } else if (previous.pickup_type === "1" && connectionRule.pickup_type !== "1") {
        mergedConnectionRule = connectionRule;
        if (mergedConnectionRule.joined_with !== '')
          mergedConnectionRule.joined_with += separator
        mergedConnectionRule.joined_with += previous.trip_id;
      }
      //### SPLITTING TRAINS
      //If the drop-off type is different, then merge it with the one where dropOffType is 0
      else if (connectionRule.drop_off_type === "1" && previous.drop_off_type !== "1") {
        mergedConnectionRule = previous;
        if (mergedConnectionRule.will_split_into !== '')
          mergedConnectionRule.will_split_into += separator
        mergedConnectionRule.will_split_into += connectionRule.trip_id;
      } else if (previous.drop_off_type === "1" && connectionRule.drop_off_type !== "1") {
        mergedConnectionRule = connectionRule;
        if (mergedConnectionRule.will_split_into !== '')
          mergedConnectionRule.will_split_into += separator
        mergedConnectionRule.will_split_into += previous.trip_id;
      }

      if (mergedConnectionRule)
        previous = mergedConnectionRule;
      else {
        //oops, it wasn’t a common connection after all
        printConnectionRule(previous);
        previous = connectionRule;
      }
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

