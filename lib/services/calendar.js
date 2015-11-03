/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Transforms a CSV export of calendar.txt and calendar_dates.txt to a service object with an expanded list of dates
 */
var Transform = require('stream').Transform,
    util = require('util'),
    StreamIterator = require('../StreamIterator'),
    moment = require('moment');

var CalendarToServices = function (calendarDatesStream) {
  Transform.call(this, {objectMode : true});
  this._calendarDatesIterator = new StreamIterator(calendarDatesStream);
  this._currentCalendarDate;
};

util.inherits(CalendarToServices, Transform);

/**
 * ¡This function only works when calendar.txt and calendar_dates.txt are ordered by service_id!
 * @param calendar is the expanded list of calendars
 * @param serviceId is the service id we're currently dealing with
 */
CalendarToServices.prototype._matchCalendarDates = function (calendar, serviceId, done) {
  var self = this;
  //If no current calendar date is set, set it and call the function again
  if (!this._currentCalendarDate) {
    this._calendarDatesIterator.next(function (calendarDate) {
      if (calendarDate) {
        self._currentCalendarDate = calendarDate;
        self._matchCalendarDates(calendar, serviceId, done);
      } else {
        //if no next calendar date could be found, return the calendar
        done(calendar);
      }
    });
  } else if (this._currentCalendarDate['service_id'] <= serviceId) {
    //If the current service_id is the same as the the service id of the calendar we've just processed, we're going to read current calendar date process it.
    //If the current service_id is smaller than the calendar service_id, just process it anyway: it's a calendar date without a match in calendar.txt
    var d = this._currentCalendarDate['date'];
    if (this._currentCalendarDate['exception_type'] === '1' && calendar.indexOf(d) === -1) {
      //This date has been added and doesn't already exist: push it to the back
      calendar.push(d);
    } else if (this._currentCalendarDate['exception_type'] === '2') {
      //Has been removed: remove it from the array
      var index = calendar.indexOf(d);
      if (index > -1) {
        calendar.splice(index, 1);
      }
    }
    //We have successfully parsed the calendar date, set it to null
    this._currentCalendarDate = null;
    //And rerun this function (which will automatically fetch the next calendar date)
    this._matchCalendarDates(calendar, serviceId, done);
  } else {
    //This is part of a service id we still might discover, so we should leave it to the next iteration. Return the result
    done(calendar);
  }
};

CalendarToServices.prototype._transform = function (calendar, encoding, done) {
  //Step one: parse and expand the calendar in memory
  var d = moment(calendar['start_date'],'YYYYMMDD');
  var expanded = [];
  while (d.format('YYYYMMDD') !== calendar['end_date']) {
    if (calendar[d.format('dddd').toLowerCase()] === '1') {
      expanded.push(d.format('YYYYMMDD'));
    }
    d = d.add(1,'days');
  }
  //Step two: match potential exceptions
  this._matchCalendarDates(expanded, calendar['service_id'], function (expandedWithExceptions) {
    done(null, {
      'service_id' : calendar['service_id'],
      dates: expandedWithExceptions
    });
  });
};

CalendarToServices.prototype._flush = function (done) {
  //TODO: for some reason, it's not flushing...
  //read the rest of the calendarDatesIterator
  var self = this;
  var recursiveCB = function (calendar) {
    if (calendar) {
      this.push(calendar);
    }
    self._calendarDatesIterator.next(function (cd) {
      if (cd) {
        self._currentCalendarDate = cd;
        self._matchCalendarDates([], self._currentCalendarDate['service_id'], recursiveCB);
      } else {
        console.log('FLUSHED');
        done();
      }
    });
  };
  this._matchCalendarDates([], this._currentCalendarDate['service_id'], recursiveCB);
};

module.exports = CalendarToServices;
