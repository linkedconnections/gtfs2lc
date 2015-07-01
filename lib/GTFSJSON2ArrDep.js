/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    async = require('async'),
    util = require('util');

util.inherits(GTFSJSON2ArrDep, Transform);

function GTFSJSON2ArrDep (store, options) {
  Transform.call(this, {objectMode : true});
  this._store = store;
}

GTFSJSON2ArrDep.prototype._transform = function (data, encoding, done) {
  var store = this._store;
  var date = data.key;
  var self = this;
  var serviceids = JSON.parse("[" + data.value + "]");
  var arrdeps = [];
  async.eachSeries(serviceids, function (serviceid, doneService) {
    //check whether this is not an exception stored in negativeDates of the store
    var trips = store.trips[serviceid];
    debugger;
    if (!( store.negativeDates[date] && store.negativeDates[date].indexOf(serviceid) > -1)) {
      async.eachSeries(trips, function (trip, doneTrip) {
        //also make sure you wait for this one to finish
        store.stop_times.get(trip["@id"], function (err, value) {
          if (err) {
            console.error("could not find trip id", trip["@id"]);
          } else {
            var stop_times = JSON.parse("[" + value + "]");
            async.eachSeries(stop_times, function (stop_time, doneStopTime) {
              if (stop_time["gtfs:departureTime"]) {
                var departure = {
                  "gtfs:trip" : trip["@id"],
                  "gtfs:route" : trip["gtfs:route"],
                  "gtfs:headsign" : stop_time["gtfs:headsign"] || trip["gtfs:headsign"]
                };

                //possibly, the departuretime doesn't contain a starting 0
                if (stop_time["gtfs:departureTime"].length === 7) {
                  stop_time["gtfs:departureTime"] = "0" + stop_time["gtfs:departureTime"];
                }

                //Stop times possibly contain hours over 23 o clock, to indicate that they're part of the previous day trip
                var hours = parseInt(stop_time["gtfs:departureTime"].substr(0,2));
                var minutes = stop_time["gtfs:departureTime"].substr(3,2);
                var daysToAdd = 0;
                if (hours > 23) {
                  //Make sure you indicate that it's part of the previous day
                  departure[":previousDateTrip"] = true;
                  hours %= 24; //mod 24
                  daysToAdd = Math.floor(hours/24);
                }
                //make it a string again
                if (hours < 10) {
                  hours = "0" + hours;
                } else {
                  hours += "";
                }
                //javascript not supporting ISO8601 spec properly
                //TODO: add timezone
                var dateString = date.replace(/(\d\d\d\d)(\d\d)(\d\d)/,"$1-$2-$3") + "T" + hours + ":" + minutes;
                if (!Date.parse(dateString) ) {
                  doneStopTime("could not parse:" + dateString);
                }
                var dateTime = new Date(dateString);
                dateTime.setDate(dateTime.getDate() + daysToAdd);
                // object["@id"] = serviceid + stop_time["@id"];
                departure["@type"] = ":Departure";
                departure["st:departureTime"] = dateTime;
                departure["st:departureStop"] = stop_time["gtfs:stop"];
                arrdeps.push(departure);
              }
              
              if (stop_time["gtfs:arrivalTime"]) {
                var arrival = {
                  "gtfs:trip" : trip["@id"],
                  "gtfs:route" : trip["gtfs:route"],
                  "gtfs:headsign" : stop_time["gtfs:headsign"] || trip["gtfs:headsign"]
                };

                //possibly, the arrivaltime doesn't contain a starting 0
                if (stop_time["gtfs:arrivalTime"].length === 7) {
                  stop_time["gtfs:arrivalTime"] = "0" + stop_time["gtfs:arrivalTime"];
                }

                //Stop times possibly contain hours over 23 o clock, to indicate that they're part of the previous day trip
                var hours = parseInt(stop_time["gtfs:arrivalTime"].substr(0,2));
                var minutes = stop_time["gtfs:arrivalTime"].substr(3,2);
                var daysToAdd = 0;
                if (hours > 23) {
                  //Make sure you indicate that it's part of the previous day
                  arrival[":previousDateTrip"] = true;
                  hours %= 24; //mod 24
                  daysToAdd = Math.floor(hours/24);
                }
                //make it a string again
                if (hours < 10) {
                  hours = "0" + hours;
                } else {
                  hours += "";
                }
                //javascript not supporting ISO8601 spec properly
                //TODO: add timezone
                var dateString = date.replace(/(\d\d\d\d)(\d\d)(\d\d)/,"$1-$2-$3") + "T" + hours + ":" + minutes;
                if (!Date.parse(dateString) ) {
                  doneStopTime("could not parse:" + dateString);
                }
                var dateTime = new Date(dateString);
                dateTime.setDate(dateTime.getDate() + daysToAdd);
                // object["@id"] = serviceid + stop_time["@id"];
                arrival["@type"] = ":Arrival";
                arrival["st:arrivalTime"] = dateTime;
                arrival["st:arrivalStop"] = stop_time["gtfs:stop"];
                arrdeps.push(arrival);
              }
              doneStopTime();
            }, function () { //errorStopTimes) {
              doneTrip();
            });
          }
        });
      }, function (errorTrips) {
        doneService();
      });
    } else {
      doneService();
    }
  }, function (servicesError) {
    for (var i = 0; i < arrdeps.length; i++) {
      self.push(arrdeps[i]);
    }
    debugger;
    done();
  });
};

module.exports = GTFSJSON2ArrDep;
