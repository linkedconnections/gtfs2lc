#!/usr/bin/env node

//Read from standard input until endline or until end stream, process chunk.
const JSONStream = require('JSONStream');

var printConnection = function (connection) {
  console.log(JSON.stringify(connection));
}

var previous = null;
var tripsLastConnection = {};

let jsonstream = process.stdin.pipe(JSONStream.parse());

jsonstream.on("data", (connection) => {
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
        processConnection(previous);
        previous = connection;
      }
    } else {
      processConnection(previous);
      previous = connection;
    }
  }
}).on('end', () => {
});

var joinedTrips = {};

var processConnection = function (connection) {
  if (connection.joinedWithTrip) {
    for (let joinedTrip of connection.joinedWithTrip) {
      joinedTrips[joinedTrip] = connection['gtfs:trip'];
    }
  }
  if (tripsLastConnection[connection['gtfs:trip']]) {
    connection.nextConnection = [ tripsLastConnection[connection['gtfs:trip']]["@id"] ];
    //TODO: in order to support multiple splitting, check that if the element exist, that it is lower
    if (connection.willSplitInto && !tripsLastConnection[connection['gtfs:trip']].willSplitInto ) { // || connection.willSplitInto.length < tripsLastConnection[connection['gtfs:trip']].willSplitInto.length)) {
      //This is our queue: apparently this connection will split its vehicles in 2, as the next connection from this very trip is not indicated to split any more
      for (let splitTrip of connection.willSplitInto) {
        if (tripsLastConnection[splitTrip]) {
          connection.nextConnection.push(tripsLastConnection[splitTrip]["@id"]);
        } //else {
          //Half of this train stops at this place and does not continue
        //}
      }
    }
  } else if (joinedTrips[connection['gtfs:trip']]) {
    //This indicates the last connection of a to be joined trip
    connection.nextConnection = [ tripsLastConnection[joinedTrips[connection['gtfs:trip']]]['@id'] ];
  }
  //only store the essentials in memory
  tripsLastConnection[connection['gtfs:trip']] = { "@id": connection['@id'], "willSplitInto": connection['willSplitInto'] };
  //remove willSplitInto and joinedWithTrip
  if (connection.willSplitInto)
    delete connection.willSplitInto;
  if (connection.joinedWithTrip)
    delete connection.joinedWithTrip;
  printConnection(connection);
};
