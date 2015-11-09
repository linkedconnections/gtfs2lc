var util = require('util'),
    moment = require('moment'),
    EventEmitter = require('events').EventEmitter;

var StreamIterator = function (stream, interval) {
  this._interval = interval;
  this._stream = stream;
  this._currentObject = null;
  this._currentCB = null;
  var self = this;
  this._streamEnded = false;
  this._stream.on("end", function () {
    self._streamEnded = true;
    self._currentObject = null;
    if (self._currentCB) {
      self._currentCB();
    }
  });
};

util.inherits(StreamIterator, EventEmitter);

StreamIterator.prototype.getCurrentObject = function () {
  return this._currentObject;
};

StreamIterator.prototype.next = function (callback) {
  var self = this;
  this._currentCB = callback;
  var object = this._stream.read();
  if (!object && !this._streamEnded) {
    this._stream.once("readable", function () {
      self.next(callback);
    });
  } else if (object && this._interval.inclusiveBetween(moment(object['date'], 'YYYYMMDD'))) {
    this._currentObject = object;
    callback(object);
  } else if (!object) {
    //stream ended
    this._currentObject = null;
    callback(null);
  } else {
    //We didn't find a solution this time, let's find it next time
    this.next(callback);
  }
};

module.exports = StreamIterator;
