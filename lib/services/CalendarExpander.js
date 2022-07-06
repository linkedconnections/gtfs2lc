/**
 * Pieter Colpaert and Julián Rojas © Ghent University - imec 
 * Make sure that the stop_times.txt is ordered by trip_id and stop_sequence before piping it to this library
 */
const Transform = require('stream').Transform;
const { format, eachDayOfInterval } = require('date-fns');

class CalendarExpander extends Transform {
    constructor(calendarDates) {
        super({ objectMode: true });
        this._calendarDates = calendarDates;
    }

    _transform(calendar, encoding, done) {
        // Parse and expand the calendar in memory
        // GTFS specification declares a date as yyyyMMdd. No other formats possible. 
        // Parsing with substr should be safe. Mind that timezones don’t matter here.
        const startDate = this.createDate(calendar['start_date']);
        const endDate = this.createDate(calendar['end_date']);
        const days = eachDayOfInterval({ start: startDate, end: endDate });
        const calDates = this.calendarDates.get(calendar['service_id']);
        const expanded = new Set();

        if (calDates) {
            // Add already all added service dates
            calDates.added.forEach(d => expanded.add(format(this.createDate(d), 'yyyyMMdd')));

            for (const d of days) {
                // Check this date is an actual service date and it hasn't been removed
                if (calendar[format(d, 'iiii').toLowerCase()] === '1' 
                    && !calDates.removed.has(d)) {
                    expanded.add(format(d, 'yyyyMMdd'));
                }
            }
            // Delete calendar_dates rule since is no longer needed
            this.calendarDates.delete(calendar['service_id']);
        } else {
            // There are not additional service date rules for this calendar
            for (const d of days) {
                if (calendar[format(d, 'iiii').toLowerCase()] === '1') {
                    expanded.add(format(d, 'yyyyMMdd'));
                }
            }
        }

        this.push({ 'service_id': calendar['service_id'], dates: Array.from(expanded) });
        done();
    }

    _flush(done) {
        // Deal with all the calendar_dates that didn't have a corresponding calendar rule
        for(const [service_id, obj] of this.calendarDates) {
            const dates = []
            obj.added.forEach(d => dates.push(format(this.createDate(d), 'yyyyMMdd')));

            this.push({ service_id, dates });
        }
        done();
    }

    createDate(dateString) {
        return new Date(dateString.substr(0, 4), parseInt(dateString.substr(4, 2)) - 1, dateString.substr(6, 2));
    }

    get calendarDates() {
        return this._calendarDates;
    }
}

module.exports = CalendarExpander;