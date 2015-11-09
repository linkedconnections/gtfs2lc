var moment = require('moment');

var DateInterval = function (startDate, endDate) {
  this._startDate = startDate ? moment(startDate, 'YYYYMMDD') : moment('19700101', 'YYYYMMDD');
  this._endDate = endDate ? moment(endDate, 'YYYYMMDD') : moment('99990101', 'YYYYMMDD');
};


DateInterval.prototype.inclusiveBetween = function (d) {
  return this.exclusiveBetween(d) || this._startDate.isSame(d) || this._endDate.isSame(d);
};

DateInterval.prototype.inclusiveBetweenLeftOnly = function (d) {
  return this.exclusiveBetween(d) || this._startDate.isSame(d);
};

DateInterval.prototype.inclusiveBetweenRightOnly = function (d) {
  return this.exclusiveBetween(d) || this._endDate.isSame(d);
};

DateInterval.prototype.exclusiveBetween = function (d) {
  return d.isAfter(this._startDate) && d.isBefore(this._endDate);
};

DateInterval.prototype.afterStart = function (d) {
  return d.isAfter(this._startDate);
};

DateInterval.prototype.beforeEnd = function (d) {
  return d.isBefore(this._endDate);
};

module.exports = DateInterval;
