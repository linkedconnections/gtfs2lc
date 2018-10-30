/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Transforms a CSV export of calendar.txt and calendar_dates.txt to a service object with an expanded list of dates
 */
const Transform = require('stream').Transform,
      util = require('util'),
      StreamIterator = require('../StreamIterator'),
      {format, addDays, eachDay, isSameDay } = require('date-fns');

var CalendarToServices = function (calendarDatesStream, options) {
  Transform.call(this, {objectMode : true});
  this._calendarDatesIterator = new StreamIterator(calendarDatesStream);
  this._options = options;
};

util.inherits(CalendarToServices, Transform);

/**
 * Calls done when all the rules in calendar_dates.txt are processed and a full calendar is found.
 * May do intermediate pushes when a service_id is found in calendar_dates.txt that don't belong to a service_id in calendar.txt
 * ¡This function only works when calendar.txt and calendar_dates.txt are ordered by service_id!
 * @param calendar is the expanded list of calendars
 * @param serviceId is the service id we're currently dealing with
 */
CalendarToServices.prototype._matchCalendarDates = function (calendar, serviceId, done) {
  //If no current calendar date is set, set it and call the function again
  var currentCD = this._calendarDatesIterator.getCurrentObject();
  if (!currentCD) {
    this._calendarDatesIterator.next((calendarDate) => {
      //if we're processing a new calendar date that's 
      if (calendarDate) {
        this._matchCalendarDates(calendar, serviceId, done);
      } else {
        //if no next calendar date could be found, return the calendar: we could not find a match for the current calendar
        done(calendar, serviceId);
      }
    });
  } else if (currentCD['service_id'] == serviceId) {
    //If the current service_id is the same as the the service id of the calendar that's given, we're going to read current calendar date process it.
    var d = currentCD['date'];
    if (currentCD['exception_type'] === '1' && calendar.indexOf(d) === -1) {
      //This date has been added and doesn't already exist: push it to the back
      calendar.push(d);
    } else if (currentCD['exception_type'] === '2') {
      //Has been removed: remove it from the array
      var index = calendar.indexOf(d);
      if (index > -1) {
        calendar.splice(index, 1);
      }
    }
    
    //We have successfully parsed the calendar date, let's find the next one
    this._calendarDatesIterator.next((calendarDate) => {
      //And rerun this function (which will automatically fetch the next calendar date)
      if (calendarDate) {
        this._matchCalendarDates(calendar, serviceId, done);
      } else {
        done(calendar, serviceId);
      }
    });
  } else if (currentCD['service_id'] < serviceId) {
    //If the current service_id is smaller than the calendar service_id, process it: it's a calendar date without a match in calendar.txt, so it should push a calendar update, but done shouldn't be called until we've fixed the next iteration
    this._processCalendarDates([], currentCD['service_id'], (intermediateCalendar, intermediateServiceId) => {
      this.push({'service_id' : intermediateServiceId,
                   dates: intermediateCalendar
                  });
      this._matchCalendarDates(calendar, serviceId, done);
    });
  } else {
    //This is part of a service id we still might discover, so we should leave it to the next iteration. Return the result of our current endeavour and return nothing
    done(calendar, serviceId);
  }
};

/**
 * Processes only calendar additions and returns a calendar. The cursor of the iterator will be at the next calendar date when finished
 */
CalendarToServices.prototype._processCalendarDates = function (calendar, serviceId, done) {
  var currentCD = this._calendarDatesIterator.getCurrentObject();
  if (currentCD['service_id'] === serviceId) {
    //process it and call done when ready
    calendar.push(currentCD['date']);
    this._calendarDatesIterator.next((calendarDate) => {
      if (calendarDate) {
        this._processCalendarDates(calendar, serviceId, done);
      } else {
        done(calendar, serviceId);
      }
    });
  } else {
    done(calendar, serviceId);
  }
};

CalendarToServices.prototype._transform = function (calendar, encoding, done) {
  //Step one: parse and expand the calendar in memory
  //GTFS specification declares a date as YYYYMMDD. No other formats possible. Parsing with substr should be safe. Mind that timezones don’t matter here. They only matter in the ConnectionsBuilder
  var startDate = new Date(calendar['start_date'].substr(0,4), calendar['start_date'].substr(4,2), calendar['start_date'].substr(6,2));
  var endDate = new Date(calendar['end_date'].substr(0,4), calendar['end_date'].substr(4,2), calendar['end_date'].substr(6,2));
  var expanded = [];

  for (let d of eachDay(startDate, endDate)) {
    if (calendar[format(d,'dddd').toLowerCase()] === '1') {
      expanded.push(format(d,'YYYYMMDD'));
    }
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
  //read the rest of the calendarDatesIterator
  var self = this;
  var recursiveCB = function (calendar, serviceId) {
    if (calendar) {
      self.push({
        'service_id' : serviceId,
        dates: calendar
      });
    }
    var currentCD = self._calendarDatesIterator.getCurrentObject();
    if (currentCD) {
      self._processCalendarDates([], currentCD['service_id'], function (calendar, serviceId) {
        recursiveCB(calendar, serviceId);
      });
    } else {
      //No next calendar date found
      done();
    }
  };
  //Initialization: if we're still handling a calendar date, handle this one first
  var currentCD = this._calendarDatesIterator.getCurrentObject();
  if (currentCD) {
    this._processCalendarDates([], currentCD['service_id'], function (calendar, serviceId) {
      recursiveCB(calendar, serviceId);
    });
  } else {
    //If we aren't, check whether we're out of calendar dates or not
    this._calendarDatesIterator.next(function (currentCD) {
      if (currentCD) {
        recursiveCB();
      } else {
        done();
      }
    });
  }
};

module.exports = CalendarToServices;
