/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(TransfersTransformer, Transform);

function TransfersTransformer (options, last) {
  this._feedbaseuri = options.baseuri + options.feedname + "/" + options.version ;
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
  
}

TransfersTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

TransfersTransformer.prototype._transform = function (data, encoding, done) {
  if (data["from_stop_id"] && data["to_stop_id"]) {
    var subject = this._feedbaseuri + "/transferrules/" + data["from_stop_id"] + "-" + data["to_stop_id"];
    this.push({ subject: subject, predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type", object: "http://vocab.gtfs.org/terms#TransferRule"});
    this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#originStop", object: this._feedbaseuri + "/stops/" + data["from_stop_id"]});
    this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#destinationStop", object: this._feedbaseuri + "/stops/" + data["to_stop_id"]});
    if (data["transfer_type"]) {
      if (data["transfer_type"] === "0") {
        this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transferType", object: "http://vocab.gtfs.org/terms#Recommended"});
      } else if (data["transfer_type"] === "1") {
        this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transferType", object: "http://vocab.gtfs.org/terms#EnsuredTransfer"});
      } else if (data["transfer_type"] === "2") {
        this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transferType", object: "http://vocab.gtfs.org/terms#MinimumTimeTransfer"});
      } else if (data["transfer_type"] === "3") {
        this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transferType", object: "http://vocab.gtfs.org/terms#NoTransfer"});
      }
    } else {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#transferType", object: "http://vocab.gtfs.org/terms#Recommended"});
    }
    if (data["min_transfer_time"]) {
      this.push({ subject: subject, predicate: "http://vocab.gtfs.org/terms#minimumTransferTime", object : '"' + data["min_transfer_time"] + '"^^http://www.w3.org/2001/XMLSchema#nonNegativeInteger' });
    }
  } else {
    console.error("Transfer does not contain all required field. Data follows:");
    console.error(data);
  }
  done();
};

module.exports = TransfersTransformer;
