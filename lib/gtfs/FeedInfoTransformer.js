/**
 * @author Pieter Colpaert <pieter.colpaert@okfn.org>
 */
var Transform = require('stream').Transform,
    util = require('util');

util.inherits(FeedInfoTransformer, Transform);

function FeedInfoTransformer (options, last) {
  this._options = options;
  Transform.call(this, {objectMode : true});
  this._last = last;
}

FeedInfoTransformer.prototype._flush = function (done) {
  this.emit("done");
  if (this._last) {
    done();
  }
}

FeedInfoTransformer.prototype._transform = function (data, encoding, done) {
  done();
};

module.exports = FeedInfoTransformer;
