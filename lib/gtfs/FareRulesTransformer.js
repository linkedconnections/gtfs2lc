/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(FareRulesTransformer, Transform);

function FareRulesTransformer (options, last) {
  this._feedbaseuri = options.baseuri + options.feedname + "/" + options.version ;
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
}

FareRulesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

FareRulesTransformer.prototype._transform = function (data, encoding, done) {
  if (!data["fare_id"]) {
    console.error("Parser error: could not find a fare_id. Data follows:");
    console.error(data);
  } else {
    var subject = this._feedbaseuri + "/fareclasses/" + data["fare_id"] + "/farerules/" + (data["route_id"]?data["route_id"]:"") + (data["origin_id"]?data["origin_id"]:"") + (data["destination_id"]?data["destination_id"]:"") + (data["contains_id"]?data["contains_id"]:"");
    this.push({ subject: subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://vocab.gtfs.org/terms#FareRule"});
    this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#fareClass", object: this._feedbaseuri + "/fareclasses/" + data["fare_id"]});
    if (data["route_id"]) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#route", object: this._feedbaseuri + "/routes/" + data["route_id"]});
    }
    if (data["origin_id"]) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#originZone", object: this._feedbaseuri + "/zones/" + data["origin_id"]});
    }
    if (data["destination_id"]) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#destinationZone", object: this._feedbaseuri + "/zones/" + data["destination_id"]});
    }
    if (data["contains_id"]) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#zone", object: this._feedbaseuri + "/zones/" + data["contains_id"]});
    }
  }
  done();
};

module.exports = FareRulesTransformer;
