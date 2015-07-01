/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(FareAttributesTransformer, Transform);

function FareAttributesTransformer (options, last) {
  this._feedbaseuri = options.baseuri + options.feedname + "/" + options.version ;
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
}

FareAttributesTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

FareAttributesTransformer.prototype._transform = function (data, encoding, done) {
  var subject = this._feedbaseuri + "/fareclasses/" + data["fare_id"];
  this.push({ subject: subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://vocab.gtfs.org/terms#FareClass"});

  if (data["price"]) {
    this.push({ subject: subject, predicate: "http://schema.org/price", object : '"' + data["price"] + '"' });
  }

  if (data["currency_time"]) {
    this.push({ subject: subject, predicate: "http://schema.org/priceCurrency", object : '"' + data["currency_type"] + '"' });
  }

  if (data["payment_method"]) {
    if (data["payment_method"] === 1) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#paymentMethod", object : "http://vocab.gtfs.org/terms#BeforeBoarding" });
    } else {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#paymentMethod", object : "http://vocab.gtfs.org/terms#OnBoard" });
    }
  }

  if (data["transfers"]) {
    if (data["payment_method"] === "0") {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transfers", object : "http://vocab.gtfs.org/terms#NoTransfersAllowed"});
    } else if (data["payment_method"] === "1") {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transfers", object : "http://vocab.gtfs.org/terms#OneTransfersAllowed"});
    } else if (data["payment_method"] === "2") {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transfers", object : "http://vocab.gtfs.org/terms#TwoTransfersAllowed"});
    }
  } else {
    this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transfers", object : "http://vocab.gtfs.org/terms#UnlimitedTransfersAllowed"});
  }

  if (data["transfer_duration"]) {
    this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transferExpiryTime", object : '"' + data["transfer_duration"] + '"^^http://www.w3.org/2001/XMLSchema#nonNegativeInteger'});
  }
  done();
};

module.exports = FareAttributesTransformer;
