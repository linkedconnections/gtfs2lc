var Transform = require('stream').Transform,
    async = require('async'),
    util = require('util'),
    StreamIterator = require('./StreamIterator.js');

util.inherits(ArrDep2Connections, Transform);

function ArrDep2Connections (arrivalsStream, options) {
  Transform.call(this, {objectMode : true});
  this._arrivalsIterator = new StreamIterator(arrivalsStream);
  //This should be changed by a way to get the next ones at a certain stop?
  this._arrivalsQueue = []; //chronologically sorted list of arrivals
  this._arrivalsQueueIndex = 0;
}

ArrDep2Connections.prototype._transform = function (departure, encoding, done) {
  departure = JSON.parse(departure.value);
  departure["st:departureTime"] = new Date(departure["st:departureTime"]);
  var self = this;
  this._arrivalsQueueIndex = 0;
  this._getNextArrival(function (arrival) {
    if (arrival) {
      var processNextArrival = function () {
        self._getNextArrival(function (nextArrival) {
          if (nextArrival) {
            setImmediate(function () {
              self._processArrival(departure, nextArrival, processNextArrival, done);
            });
          } else {
            console.error("no next arrival");
          }
        });
      };
      //we can call nextArrival if no connection have been found, or done when a connection has been found
      self._processArrival(departure, arrival, processNextArrival, done);
    } else {
      console.error("No beginning arrival found...");
    }
  });
}

ArrDep2Connections.prototype._createConnection = function (arrival, departure) {
  var connection = {};
  connection["@type"] = "st:Connection";
  connection["st:arrivalTime"] = arrival["st:arrivalTime"];
  connection["st:arrivalStop"] = arrival["st:arrivalStop"];
  connection["st:departureTime"] = departure["st:departureTime"];
  connection["st:departureStop"] = departure["st:departureStop"];
  connection["gtfs:trip"] = departure["gtfs:trip"];
  connection["gtfs:headsign"] = departure["gtfs:headsign"] || arrival["gtfs:headsign"];
  //TODO: extend with other...
  return connection;
};


ArrDep2Connections.prototype._getNextArrival = function (cb) {
  var arrivalQueueItem = this._arrivalsQueue[this._arrivalsQueueIndex];
  var self = this;
  if (arrivalQueueItem) {
    this._arrivalsQueueIndex++;
    cb(arrivalQueueItem);
  } else {
    this._arrivalsIterator.next(function (arrival) {
      arrival = JSON.parse(arrival.value);
      arrival["st:arrivalTime"] = new Date(arrival["st:arrivalTime"]);

      self._arrivalsQueue.push(arrival);
      //console.log(self._arrivalsQueue);
      cb(arrival);
    });
  }
}

ArrDep2Connections.prototype._processArrival = function (departure, arrival, next, done) {
  //check if arrival has the same trip id, if it does, we've got a winner: first thing always wins
  //debugger;
  //console.log(departure["st:departureTime"]);
  var departureTime = departure["st:departureTime"];
  var arrivalTime = arrival["st:arrivalTime"];
  //console.log(arrivalTime,arrival["st:arrivalTime"], departureTime, departure["st:departureTime"]);
  if (arrivalTime <= departureTime) {
    //discart it (as this is only possible for the first X items, we can do shift and bring the arrivalsQueueIndex back to 0
    //debugger;
    for (var i = 0; i < this._arrivalsQueueIndex; i++) {
      this._arrivalsQueue.shift();
    }
    this._arrivalsQueueIndex = 0;
    next();
  } else if (arrivalTime.toISOString().substr(0,10) !== departureTime.toISOString().substr(0,10)) {// && departure["gtfs:trip"] === arrival["gtfs:trip"]) {
    //it's later in time, but the arrivaltime is not on the same day as the departure time
    //it's possibly the first arrival of the next iteration of the trip: let's get rid of this departure for now: later we should check whether we have a flag set
    //console.error(arrivalTime.toISOString().substr(0,10),departureTime.toISOString().substr(0,10));
    done(null, null);
  } else if (departure["gtfs:trip"] === arrival["gtfs:trip"]) {
    //first one to encounter each other: it's a match!
    done(null, this._createConnection(arrival, departure));
  } else {
    //arrival is part of the next one part of another trip.
    next();
  }
}

module.exports = ArrDep2Connections;
