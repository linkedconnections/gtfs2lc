/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(RoutesTransformer, Transform);

function RoutesTransformer (options, last) {
  Transform.call(this, {objectMode : true});
  this._last = last;
}

RoutesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

RoutesTransformer.prototype._transform = function (data, encoding, done) {
  var object = { "@id": "routes:" + data["route_id"]};
  object["@type"] = "gtfs:Route";
  if (data["agency_id"]) {
    //this.push({ subject: subject, predicate: "gtfs:agency", object: this._feedbaseuri + "/agencies/" + data["agency_id"]});
  }
  if (data["route_short_name"]) {
    object["gtfs:shortName"] = data["route_short_name"];
  }
  if (data["route_long_name"]) {
    object["gtfs:longName"] = data["route_long_name"];
  }
  if (data["route_desc"]) {
    object["dcterms:description"] = data["route_desc"];
  }
  if (data["route_type"]) {
    if (data["route_type"] === "0") {
      object["gtfs:routeType"] = "gtfs:LightRail";
    } else if (data["route_type"] === "1") {
      object["gtfs:routeType"] = "gtfs:SubWay";
    } else if (data["route_type"] === "2") {
      object["gtfs:routeType"] = "gtfs:Rail";
    } else if (data["route_type"] === "3") {
      object["gtfs:routeType"] = "gtfs:Bus";
    } else if (data["route_type"] === "4") {
      object["gtfs:routeType"] = "gtfs:Ferry";
    } else if (data["route_type"] === "5") {
      object["gtfs:routeType"] = "gtfs:CableCar";
    } else if (data["route_type"] === "6") {
      object["gtfs:routeType"] = "gtfs:Gondola";
    } else if (data["route_type"] === "7") {
      object["gtfs:routeType"] = "gtfs:Funicular";
    }
  }
  if (data["route_url"] ) {
    //this.push({ subject: subject, predicate: "http://xmlns.com/foaf/0.1/page", object :  data["route_url"] });
  }
  if (data["route_color"] ) {
    //this.push({ subject: subject, predicate: "gtfs:color", object :  '"' + data["route_color"]+'"^^http://www.w3.org/2001/XMLSchema#string' });
  }
  if (data["route_textColor"] ) {
    //this.push({ subject: subject, predicate: "gtfs:textColor", object: '"' + data["route_textColor"] + '"^^http://www.w3.org/2001/XMLSchema#string' });
  }

  done(null, object);
};

module.exports = RoutesTransformer;
