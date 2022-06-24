/**
 * Pieter Colpaert © Ghent University -- IDLab -- imec
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
const Transform = require('stream').Transform;
const { addHours, addMinutes, addSeconds } = require('date-fns');

class ConnectionsBuilder extends Transform {
    constructor() {
        super({ objectMode: true });
    }

    _transform(connectionRule, encoding, done) {
        this.processConnectionRule(connectionRule, done);
    }

    processConnectionRule(connectionRule, done) {
        try {
            const connRule = connectionRule.value;
            const departureDFM = parseGTFSDuration(connRule['departure_dfm']);
            const arrivalDFM = parseGTFSDuration(connRule['arrival_dfm']);
            const tripStartDFM = parseGTFSDuration(connRule.trip['startTime_dfm'])
            const service = connRule.serviceDates;
            
            for (var i in service) {
                // GTFS defined a date as a strict string: yyyyMMdd, just parse it with substrings
                // TODO: what if the timezone is different than the local timezone? For now, you will have to change you local system’s time...
                const serviceDay = new Date(service[i].substr(0, 4), parseInt(service[i].substr(4, 2)) - 1, service[i].substr(6, 2));
                //add the duration to the date
                const departureTime = addDuration(serviceDay, departureDFM);
                const arrivalTime = addDuration(serviceDay, arrivalDFM);
                const startTime = addDuration(serviceDay, tripStartDFM);
                // Set startTime of the trip
                const trip = Object.assign({}, connRule.trip);
                trip.startTime = startTime;

                // Add complete Stop objects for more specific URI resolving
                const connection = {
                    departureTime,
                    departureStop: connRule['departure_stop'],
                    arrivalTime,
                    arrivalStop: connRule['arrival_stop'],
                    trip,
                    route: connRule.route,
                    headsign: connRule.headsign,
                    pickup_type: connRule['pickup_type'],
					drop_off_type: connRule['drop_off_type']
                };

                this.push(connection);
            }
            done();
        } catch (err) {
            done(err);
        }
    }
}

const parseGTFSDuration = function (durationString) {
    let [hours, minutes, seconds] = durationString.split(':').map((val) => { return parseInt(val); });
    //Be forgiving to durations that do not follow the spec e.g., (12:00 instead of 12:00:00)
    return { hours, minutes, seconds: seconds ? seconds : 0 };
}

const addDuration = function (date, duration) {
    return addSeconds(addMinutes(addHours(date, duration.hours), duration.minutes), duration.seconds);
}

module.exports = ConnectionsBuilder;
