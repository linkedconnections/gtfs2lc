/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(StopsTransformer, Transform);

function StopsTransformer (options, last) {
  this._feedbaseuri = options.baseuri + options.feedname + "/" + options.version ;
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
}

StopsTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

/**
 *  Creates a gtfs:Station or gtfs:Stop with additional properties. Also creates a gtfs:Zone
 */
StopsTransformer.prototype._transform = function (data, encoding, done) {
  var subject = this._feedbaseuri + "/stops/" + data["stop_id"];
  // gtfs:locationType triple
  if (data["location_type"] && data["location_type"] === "1") {
    this.push({ subject: subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://vocab.gtfs.org/terms#Station"});
  } else {
    this.push({ subject: subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://vocab.gtfs.org/terms#Stop"});
    //Stations can't have a parent_station, only Stops can have a parent station.
    if (data["parent_station"]) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#parentStation", object :'"' +  data["parent_station"]+'"' });
    }
    if (data["zone_id"]) {
      this.push({ subject: this._feedbaseuri + "/zones/" + data["zone_id"], predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object : "http://vocab.gtfs.org/terms#Zone" });
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#zone", object : this._feedbaseuri + "/zones/" + data["zone_id"] });
    }
  }
  // gtfs:code triple
  if (data["stop_code"]) {
    this.push({ subject: subject, predicate: "http://purl.org/dc/terms/identifier", object :'"' +  data["stop_code"]+'"' });
  }
  // foaf:name triple
  if (data["stop_name"]) {
    this.push({ subject: subject, predicate: "http://xmlns.com/foaf/0.1/name", object :'"' +  data["stop_name"]+'"' });
  }
  if (data["stop_desc"]) {
    this.push({ subject: subject, predicate: "http://purl.org/dc/terms/description", object :'"' +  data["stop_desc"]+'"' });
  }
  // geo:lat triple
  if (data["stop_lat"]) {
    this.push({ subject: subject, predicate: "http://www.w3.org/2003/01/geo/wgs84_pos#lat", object :'"' + data["stop_lat"] + '"' });
  }
  // geo:long triple
  if (data["stop_lon"]) {
    this.push({ subject: subject, predicate: "http://www.w3.org/2003/01/geo/wgs84_pos#long", object :'"' + data["stop_lon"] + '"' });
  }
  if (data["stop_url"]) {
    this.push({ subject: subject, predicate: "http://xmlns.com/foaf/0.1/page", object : data["stop_url"] });
  }
  if (data["wheelchair_boarding"]) {
    if (data["wheelchair_boarding"] === "0") {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#wheelchairAccessible", object: "http://vocab.gtfs.org/terms#CheckParentStation"});
    } else if (data["wheelchair_boarding"] === "1") {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#wheelchairAccessible", object : "http://vocab.gtfs.org/terms#WheelchairAccessible" });
    } else if (data["wheelchair_boarding"] === "2") {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#wheelchairAccessible", object : "http://vocab.gtfs.org/terms#NotWheelchairAccessible" });
    }
  }
  done();
};

module.exports = StopsTransformer;
