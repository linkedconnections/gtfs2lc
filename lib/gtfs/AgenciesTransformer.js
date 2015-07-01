/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(AgenciesTransformer, Transform);

function AgenciesTransformer (options, last) {
  Transform.call(this, {objectMode : true});
  this._last = last;
}

AgenciesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done(); // this will close the stream
  }
}

AgenciesTransformer.prototype._transform = function (data, encoding, done) {
  var object = { "@id" : "agencies:" + data["agency_id"]};
  object["@type"] = "gtfs:Agency";

  // foaf:name triple
  if (data["agency_name"]) {
    object["foaf:name"] = data["agency_name"];
  }

  // foaf:page triple
  if (data["agency_url"]) {
    object["foaf:page"] = data["agency_url"];
  }

  // foaf:phone triple
  if (data["agency_phone"]) {
    //this.push({ subject: subject, predicate: "foaf:phone", object :'"' +  data["agency_phone"]+'"' });
  }
  // gtfs:fareUrl triple
  if (data["agency_fare_url"]) {
    //this.push({ subject: subject, predicate: "gtfs:fareUrl", object : data["agency_fare_url"] });
  }

  if (data["agency_timezone"]) {
    object["time:timeZone"] = data["agency_timezone"];
  }

  done(null, object);
};

module.exports = AgenciesTransformer;
