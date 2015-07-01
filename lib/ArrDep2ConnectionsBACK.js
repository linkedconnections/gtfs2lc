var Transform = require('stream').Transform,
    async = require('async'),
    util = require('util'),
    StreamIterator = require('./StreamIterator.js');

util.inherits(ArrDep2Connections, Transform);

function ArrDep2Connections (arrivalsStream, options) {
  Transform.call(this, {objectMode : true});
  this._arrivalsIterator = new StreamIterator(arrivalsStream);
  this._arrivalsQueue = []; //chronologically sorted list of arrivals
}

ArrDep2Connections.prototype._transform = function (departure, encoding, done) {
  departure = JSON.parse(departure.value);
  // We need to link this departure to an arrival.
  // if we encounter an arrival that could not be matched, it will end up in a queue
  // This queue will be overrun each time. 
  /**
    - When the arrival Time is earlier than the departure time, the arrival will be thrown away
    - When the arrival Time is later, but the trip id is not the same, the arrival time is kept in the queue
    - When the arrival Time is later, and the trip id is the same, link it to each other and this.push it
    - When the arrival Time could not be found in the queue, continue pulling a new arrival time from the arrivalsStream and do the same operation
  */
  var checkArrival = function (arrival) {
    //TODO: if the departure is somewhere on a next day, then don't add it unless the flag has been set which indicates it's part of a previous trip!!
    //TODO: if a departure hasn't been found, it may be a departure that goes nowhere and may be discarted. The departure is indicated nonetheless for e.g., when a train departs again towards the depot.
    if (new Date(departure["st:departureTime"]) >= new Date(arrival["st:arrivalTime"]))  {
      //discart this one and don't do anything else
      return "discart";
/*    } else if( (new Date(arrival["st:arrivalTime"])).toISOString().substr(0,10) != (new Date(departure["st:departureTime"])).toISOString().substr(0,10)) {
      //Crosses at least a day1234-67-90
      done();
      return "save";*/
    } else {
      if (arrival["gtfs:trip"] === departure["gtfs:trip"]) {
        //add the connection to the stream and we're done here!
        var connection = createConnection(arrival, departure);
        //console.log(connection);
        done(null, connection);
        return "skipdeparture"; // skip this departure
      } else {
        //Let's save it for another departure
        return "save";
      }
    }
  };

  var createConnection = function (arrival, departure) {
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

  var self = this;
  var wereDone = false;
  for (var i in this._arrivalsQueue) {
    debugger;
    var arrival = this._arrivalsQueue[i];
    if (arrival) {
      //3 options: or we keep the arrival, or we discart it, or we are completely done
      var actionNeeded = checkArrival(arrival);
      if (actionNeeded === "discart") {
        var index = this._arrivalsQueue.indexOf(arrival);
        this._arrivalsQueue.splice(index, 1);
      } else if (actionNeeded === "done") {
        wereDone = true;
        break;
      } else if (actionNeeded === "save") {
        //it's already stored, don't do anything
      }
    }
  }
  var nextArrival = function () {
    self._arrivalsIterator.next(function (arrival) {
      debugger;
      var arrival = arrival.value;
      arrival = JSON.parse(arrival);
      var actionNeeded = checkArrival(arrival);
      if (actionNeeded === "save") {
        self._arrivalsQueue.push(arrival);
        nextArrival();
      } else if (actionNeeded === "discart") {
        //just don't save it
        nextArrival();
      } else if (actionNeeded === "done") {
        //done!
      }
    });
  };
  if (!wereDone)
    nextArrival();
}

module.exports = ArrDep2Connections;