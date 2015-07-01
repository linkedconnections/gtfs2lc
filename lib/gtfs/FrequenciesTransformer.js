/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(FrequenciesTransformer, Transform);

function FrequenciesTransformer (options, last) {
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
}

FrequenciesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

FrequenciesTransformer.prototype._transform = function (data, encoding, done) {
  if (data["trip_id"] && data["start_time"] && data["end_time"] && data["headway_secs"]) {
    var object = { "@id" : "frequencies:" + "/trips/" + data["trip_id"] + "/frequencies/" + data["start_time"] + data["end_time"],
                   "@type": "gtfs:Frequency"};
    object["gtfs:startTime"] = data["start_time"];
    object["gtfs:endTime"] = data["end_time"];
    object["gtfs:headwaySeconds"] = data["headway_secs"];
    if (data["exact_times"]) {
      object["gtfs:headwaySeconds"] = data["exact_times"] === "1"?"true":"false";
    } else {
      object["gtfs:headwaySeconds"] = "false";
    }
  } else {
    console.error("Frequency doesn't contain all required fields");
  }
  done(null, object);
};

module.exports = FrequenciesTransformer;
