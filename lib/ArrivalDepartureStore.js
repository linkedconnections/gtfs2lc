var Writable = require('stream').Writable,
    util = require('util'),
    Transform = require('stream').Transform,
    leveldown = require('level'),
    level = require('level');

/**
 * This stores arrival and departures
 * It indexes them on a time basis: this way, we can match all arrivals and departures in 1 go.
 */
var Store = function () {
  Writable.call(this, {objectMode : true});
  //The json variable names can all be linked to the http://vocab.gtfs.org/terms vocabulary
  this.arrivals = level("arrivals");
  this.departures = level("departures");
};

util.inherits(Store, Writable);

/**
 * Indexes the data on basis of time
 */
Store.prototype._write = function (data, encoding, done) {
  var finalize = function (err) {
    if (err) {
      console.error(err);
    }
    if (data["st:arrivalTime"]) {
      //console.error("writing", data["st:arrivalTime"]);
    } else {
      //console.error("writing", data["st:departureTime"]);
    }
    done();
  }
  //console.error(data["st:arrivalTime"] || data["st:departureTime"] );
  var self = this;
  if (data["@type"] === ":Arrival") {
    self.arrivals.put(data["st:arrivalTime"].toISOString() + data["gtfs:trip"], JSON.stringify(data), finalize);
  }
  if (data["@type"] === ":Departure") {
    self.departures.put(data["st:departureTime"].toISOString() + data["gtfs:trip"], JSON.stringify(data),finalize);
  }
};

module.exports = Store;
