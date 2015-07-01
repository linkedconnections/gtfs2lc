/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(CalendarTransformer, Transform);

function CalendarTransformer (options, last) {
  Transform.call(this, {objectMode : true});
  this._last = last;
}

CalendarTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

CalendarTransformer.prototype._transform = function (data, encoding, done) {
  var service = { "@id" : "services:" + data["service_id"]};
  service["@type"] = "gtfs:Service";
  var object = {"@id" : "services:" + data["service_id"]  + "/servicesrules/calendarrule"};
  object["@type"] = ["gtfs:ServiceRule","gtfs:CalendarRule"];

  //what follows is not JSON-LD
  object["weekdays"] = [false,false,false,false,false,false,false];

  //make this an array of booleans where Monday is 0 and Sunday is 6
  if (data["monday"]) {
    object.weekdays[1] = data["monday"] === "1";
  }
  if (data["tuesday"]) {
    object.weekdays[2] = data["tuesday"] === "1";
  }
  if (data["wednesday"]) {
    object.weekdays[3] = data["wednesday"] === "1";
  }
  if (data["thursday"]) {
    object.weekdays[4] = data["thursday"] === "1";
  }
  if (data["friday"]) {
    object.weekdays[5] = data["friday"] === "1";
  }
  if (data["saturday"]) {
    object.weekdays[6] = data["saturday"] === "1";
  }
  if (data["sunday"]) {
    object.weekdays[0] = data["sunday"] === "1";
  }
  if (data["start_date"] && data["end_date"]){
    object.startDate = data["start_date"];
    object.endDate = data["end_date"];
  }
  service["gtfs:serviceRule"] = object;
  done(null, service);
};

module.exports = CalendarTransformer;
