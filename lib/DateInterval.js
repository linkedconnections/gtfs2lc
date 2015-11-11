var moment = require('moment');

var DateInterval = function (startDate, endDate) {
  this.startDate = startDate ? moment(startDate, 'YYYYMMDD') : moment('19700101', 'YYYYMMDD');
  this.endDate = endDate ? moment(endDate, 'YYYYMMDD') : moment('99990101', 'YYYYMMDD');
};


DateInterval.prototype.inclusiveBetween = function (d) {
  return this.exclusiveBetween(d) || this.startDate.isSame(d) || this.endDate.isSame(d);
};

DateInterval.prototype.inclusiveBetweenLeftOnly = function (d) {
  return this.exclusiveBetween(d) || this.startDate.isSame(d);
};

DateInterval.prototype.inclusiveBetweenRightOnly = function (d) {
  return this.exclusiveBetween(d) || this.endDate.isSame(d);
};

DateInterval.prototype.exclusiveBetween = function (d) {
  return d.isAfter(this.startDate) && d.isBefore(this.endDate);
};

DateInterval.prototype.afterStart = function (d) {
  return d.isAfter(this.startDate);
};

DateInterval.prototype.beforeEnd = function (d) {
  return d.isBefore(this.endDate);
};

module.exports = DateInterval;
