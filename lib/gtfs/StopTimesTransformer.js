/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(StopTimesTransformer, Transform);

function StopTimesTransformer (options, last) {
  Transform.call(this, {objectMode : true});
  this._last = last;
}

StopTimesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

StopTimesTransformer.prototype._transform = function (data, encoding, done) {
  var object = { "@id" : "stoptimes:" + data["trip_id"] + "/stop/" + data["stop_id"]};
  object["@type"] = "gtfs:StopTime";
  object["gtfs:stop"] = "stops:" + data["stop_id"];
  object["gtfs:trip"] = "trips:" + data["trip_id"];

  if (data["arrival_time"]) { 
    object["gtfs:arrivalTime"] = data["arrival_time"];
  }
  if (data["departure_time"]) {
    object["gtfs:departureTime"] = data["departure_time"];
  }
  if (data["stop_sequence"]) {
    object["gtfs:stopSequence"] = data["stop_sequence"];
  }
  if (data["stop_headsign"]) {
    object["gtfs:headsign"] = data["stop_headsign"];
  }
  if (data["pickup_type"]) {
    if (data["pickup_type"] === "0") {
      object["gtfs:pickupType"] = "gtfs:Regular";
    } else if (data["pickup_type"] === "1") {
      object["gtfs:pickupType"] = "gtfs:NotAvailable";
    } else if (data["pickup_type"] === "2") {
      object["gtfs:pickupType"] = "gtfs:MustPhone";
    } else if (data["pickup_type"] === "3") {
      object["gtfs:pickupType"] = "gtfs:MustCoordinateWithDriver";
    }
  }
  if (data["drop_off_type"]){
    if (data["drop_off_type"] === "0") {
      object["gtfs:dropOffType"] = "gtfs:Regular";
    } else if (data["drop_off_type"] === "1") {
      object["gtfs:dropOffType"] = "gtfs:NotAvailable";
    } else if (data["drop_off_type"] === "2") {
      object["gtfs:dropOffType"] = "gtfs:MustPhone";
    } else if (data["drop_off_type"] === "3") {
      object["gtfs:dropOffType"] = "gtfs:MustCoordinateWithDriver";
    }
  }
  if (data["shape_dist_traveled"]){
    object["gtfs:distanceTraveled"] = data["shape_dist_traveled"];
  }
  done(null, object);
};

module.exports = StopTimesTransformer;
