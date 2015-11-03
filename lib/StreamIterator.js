var util = require('util'),
    EventEmitter = require('events').EventEmitter;

var StreamIterator = function (stream) {
  this._stream = stream;
  this._currentCB = null;
  var self = this;
  this._stream.on("end", function () {
    if (self._currentCB) {
      self._currentCB();
    }
  });
};

util.inherits(StreamIterator, EventEmitter);

StreamIterator.prototype.next = function (callback) {
  var self = this;
  this._currentCB = callback;
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
