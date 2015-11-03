var util = require('util'),
    EventEmitter = require('events').EventEmitter;

var StreamIterator = function (stream) {
  this._stream = stream;
  this._currentCB = null;
  this._stream.on("end", function () {
    if (this._currentCB) {
      this._currentCB();
    }
  });
};

util.inherits(StreamIterator, EventEmitter);

StreamIterator.prototype.next = function (callback) {
  var self = this;
  var object = this._stream.read();
  if (!object) {
    this._stream.once("readable", function () {
      self.next(callback);
    });
  } else {
    callback(object);
  }
};

module.exports = StreamIterator;
