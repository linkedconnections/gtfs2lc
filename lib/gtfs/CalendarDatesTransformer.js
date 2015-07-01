/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(CalendarDatesTransformer, Transform);

function CalendarDatesTransformer (options, last) {
  Transform.call(this, {objectMode : true});
  this._last = last;
}

CalendarDatesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

CalendarDatesTransformer.prototype._transform = function (data, encoding, done) {
  var service = { "@id" : "services:" + data["service_id"]};
  service["@type"] = "gtfs:Service";
  var object = { "@id" : "servicerules:" + data["date"]};
  object["@type"] = ["gtfs:ServiceRule", "gtfs:CalendarDateRule"];

  if (data["exception_type"]) {
    //1 is added for the certain date
    //2 is removed for the certain date
    object["gtfs:dateAddition"] = data["exception_type"] === "1";
  }

  if (data["date"]){
    object["dcterms:date"] = data["date"];
  }

  service["gtfs:serviceRule"] = object;
  done(null, service);
};

module.exports = CalendarDatesTransformer;
