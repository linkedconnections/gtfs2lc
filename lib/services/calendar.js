/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Transforms a CSV export of calendar.txt and calendar_dates.txt to service objects
 */
var Transform = require('stream').Transform,
    util = require('util'),
    StreamIterator = require('../StreamIterator'),
    moment = require('moment');

util.inherits(CalendarToServices, Transform);

var CalendarToServices = function (calendarDatesStream) {
  Transform.call(this, {objectMode : true});
  this._calendarDatesIterator = new StreamIterator(calendarDatesStream);
  this._currentCalendarDate;
});

/**
 * ¡This function only works when calendar.txt and calendar_dates.txt are ordered by service_id!
 */
CalendarToServices.prototype._matchCalendarDates = function (calendar, done) {
  var self = this;
  //If no current calendar date is set, set it and call the function again
  if (!this._currentCalendarDate) {
    this._calendarDatesIterator.next(function (calendarDate) {
      if (calendarDate) {
        self._currentCalendarDate = calendarDate;
        self._matchCalendarDates(calendar, done);
      } else {
        //if no next calendar date could be found, return nothing
        done();
      }
    });
  } else if (this._currentCalendarDate['service_id'] === calendar['service_id']) {
    //If the current service_id is the same as the next one, 
    this._calendarDatesIterator.next(function (calendarDate) {
      self._currentCalendarDate = calendarDate;
      
    });
  } else {
    //This is about another calendar apparently, probably about the next one, or one that doesn't have a calendar.txt entry.
    // If it's one that doesn't have a calendar.txt entry, parse it and enter store it and call the function again.

    // If it's one that still is possible we encou
    //As our begin statement is that 
  }
};

CalendarToServices.prototype._transform = function (calendar, encoding, done) {
  //Step one: parse and expand the calendar in memory
  var d = moment(calendar['start_date'],'YYYYMMDD');
  var expanded = [];
  while (d.format('YYYYMMDD') !== calendar['end_date']) {
    
    d = d.add(1,'days');
  }
  //Step two: match potential exceptions
  
  done(null, calendar);
};

CalendarToServices.prototype._flush : function (done) {
  //read the rest of the calendarDatesIterator and store them into memory
  
});

module.exports = CalendarToServices;
