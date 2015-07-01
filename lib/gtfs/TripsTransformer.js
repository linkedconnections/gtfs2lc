/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(TripsTransformer, Transform);

function TripsTransformer (options, last) {
  Transform.call(this, {objectMode : true});
  this._last = last;
}

TripsTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

TripsTransformer.prototype._transform = function (data, encoding, done) {
  var object = {"@id" : "trips:" + data["trip_id"] };
  object["@type"] = "gtfs:Trip";
  if (data["route_id"]) {
    object["gtfs:route"] = "routes:" + data["route_id"];
  }
  if (data["service_id"]) {
    object["gtfs:service"] = "services:" + data["service_id"];
  }
  if (data["trip_headsign"]) {
    object["gtfs:headsign"] = data["trip_headsign"];
  }
  if (data["trip_short_name"]) {
    object["gtfs:shortName"] = data["trip_short_name"];
  }
  if (data["direction_id"]) {
    object["gtfs:direction"] = data["direction_id"];
  }
  if (data["block_id"]) {
    object["gtfs:block"] = data["block_id"];
  }
  if (data["shape_id"]) {
    //this.push({ subject: this._feedbaseuri + "/shapes/" + data["shape_id"], predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "gtfs:Shape"});
    //this.push({ subject: subject, predicate: "gtfs:shape", object: this._feedbaseuri + "/shapes/" + data["shape_id"]});
  }
  if (data["wheelchair_accessible"]) {
    if (data["wheelchair_accessible"] === "0") {
      object["gtfs:wheelchairAccessible"] = "gtfs:CheckParentStation";
    } else if (data["wheelchair_accessible"] === "1") {
      object["gtfs:wheelchairAccessible"] = "gtfs:WheelchairAccessible";
    } else if (data["wheelchair_accessible"] === "2") {
      object["gtfs:wheelchairAccessible"] = "gtfs:NotWheelchairAccessible";
    }
  }
  if (data["bikes_allowed"]) {
//    this.push({ subject: subject, predicate: "gtfs:bikesAllowed", object: (data["bikes_allowed"] == 1 ? "\"true\"": "\"false\"") + '^^http://www.w3.org/2001/XMLSchema#boolean' });
  }
  done(null, object);
};

module.exports = TripsTransformer;
