/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(ShapesTransformer, Transform);

function ShapesTransformer (options, last) {
  this._feedbaseuri = options.baseuri + options.feedname + "/" + options.version ;
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
}

ShapesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

ShapesTransformer.prototype._transform = function (data, encoding, done) {
  var subject = this._feedbaseuri + "/shapes/" + data["shape_id"];
  this.push({subject: subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://vocab.gtfs.org/terms#Shape"});
  if (data["shape_pt_lat"] && data["shape_pt_lon"] && data["shape_pt_sequence"]) {
    var point = subject + "/shapepoints/" + data["shape_pt_sequence"];
    this.push({subject: subject, predicate: "http://vocab.gtfs.org/terms#shapePoint", object: point});
    this.push({subject: point, predicate: "http://www.w3.org/2003/01/geo/wgs84_pos#lat", object : '"' + data["shape_pt_lat"] + '"'});
    this.push({subject: point, predicate: "http://www.w3.org/2003/01/geo/wgs84_pos#long", object : '"' + data["shape_pt_lon"] + '"'});
    this.push({subject: point, predicate: "http://vocab.gtfs.org/terms#pointSequence", object : '"' + data["shape_pt_sequence"] + '"^^http://www.w3.org/2001/XMLSchema#nonNegativeInteger' });

    if (data["shape_dist_traveled"]) {
      this.push({subject: point, predicate: "http://vocab.gtfs.org/terms#distanceTraveled", object : '"' + data["shape_dist_traveled"] + '"^^http://www.w3.org/2001/XMLSchema#nonNegativeInteger' });
    }

  } else {
    console.error("Required column not set in shape_points. Data dump follows:");
    console.error(data);
  }

  done();
};

module.exports = ShapesTransformer;
