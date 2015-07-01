var util = require('util'),
    EventEmitter = require('events').EventEmitter;

var StreamIterator = function (stream) {
  this._stream = stream;
};

util.inherits(StreamIterator, EventEmitter);

StreamIterator.prototype.next = function (callback) {
  var self = this;
  var object = this._stream.read();
  if (!object) {
    this._stream.once("readable", function () {;
      self.next(callback);
    });
  } else {
    callback(object);
  }
};

module.exports = StreamIterator;