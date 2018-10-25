#!/usr/bin/env node

//Read from standard input until endline or until end stream, process chunk.

const JSONStream = require('JSONStream'),
      {AsyncIterator} = require('asynciterator');

var printConnection = function (connection) {
  console.log(JSON.stringify(connection));
}

var previous = null;
var tripsLastConnection = {};

let jsonstream = process.stdin.pipe(JSONStream.parse());
console.time();
jsonstream.on("data", (connection, done) => {
  if (!previous) {
    previous = connection;
  } else {
    if (connection.arrivalTime === previous.arrivalTime && connection.departureTime === previous.departureTime && connection.departureStop === previous.departureStop && connection.arrivalStop === previous.arrivalStop && connection['gtfs:route'] === previous['gtfs:route']) {
      mergedConnection = null;
      //See the documentation: https://support.google.com/transitpartners/answer/7084064?hl=en

      //### JOINING TRAINS
      //If the pickup type is 1 while the other isn’t merge it with the connection where the pickupType was 0
      if (connection["gtfs:pickupType"] === "gtfs:NotAvailable" && previous["gtfs:pickupType"] !== "gtfs:NotAvailable") {
        mergedConnection = previous;
        if (!mergedConnection.joinedWithTrip)
          mergedConnection.joinedWithTrip = []
        mergedConnection.joinedWithTrip.push(connection["gtfs:trip"]);
      } else if (previous["gtfs:pickupType"] === "gtfs:NotAvailable" && connection["gtfs:pickupType"] !== "gtfs:NotAvailable") {
        mergedConnection = connection;
        if (!mergedConnection.joinedWithTrip)
          mergedConnection.joinedWithTrip = [];
        mergedConnection.joinedWithTrip.push(previous["gtfs:trip"]);
      }
      //### SPLITTING TRAINS
      //If the drop-off type is different, then merge it with the one where dropOffType is 0
      else if (connection["gtfs:dropOffType"] === "gtfs:NotAvailable" && previous["gtfs:dropOffType"] !== "gtfs:NotAvailable") {
        mergedConnection = previous;
        if (!mergedConnection.willSplitInto)
          mergedConnection.willSplitInto = [];
        mergedConnection.willSplitInto.push(connection["gtfs:trip"]);
      } else if (previous["gtfs:dropOffType"] === "gtfs:NotAvailable" && connection["gtfs:dropOffType"] !== "gtfs:NotAvailable") {
        mergedConnection = connection;
        if (!mergedConnection.willSplitInto)
          mergedConnection.willSplitInto = [];
        mergedConnection.willSplitInto.push(previous["gtfs:trip"]);
      }

      if (mergedConnection)
        previous = mergedConnection;
      else {
        printConnection(previous);
        previous = connection;
      }
    } else {
      printConnection(previous);
      previous = connection;
    }
    
  }
  /*if (tripsLastConnection[connection['gtfs:trip']]) {
    printConnection(tripsLastConnection[connection['gtfs:trip']]);
  }
  tripsLastConnection[connection['gtfs:trip']] = connection;
 */
}).on('data', () => {

}).on('end', () => {
  //FLUSH: make sure all tripsLastConnections are made available
});
