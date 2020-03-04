/**
 * Pieter Colpaert © Ghent University -- IDLab -- imec
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
const Transform = require('stream').Transform;
const { addHours, addMinutes, addSeconds } = require('date-fns'),
  util = require('util');

const parseGTFSDuration = function (durationString) {
  let [hours, minutes, seconds] = durationString.split(':').map((val) => { return parseInt(val); });
  //Be forgiving to durations that do not follow the spec e.g., (12:00 instead of 12:00:00)
  return { hours, minutes, seconds: seconds ? seconds : 0 };
}

const addDuration = function (date, duration) {
  return addSeconds(addMinutes(addHours(date, duration.hours), duration.minutes), duration.seconds);
}

var ConnectionsBuilder = function (tripsdb, servicesdb, routesdb, stopsdb) {
  Transform.call(this, { objectMode: true });
  this._tripsdb = tripsdb;
  this._servicesdb = servicesdb;
  this._routesdb = routesdb;
  this._stopsdb = stopsdb;
  this._currentTrip = null;
  this._firstDepartureDFM = null;
};

util.inherits(ConnectionsBuilder, Transform);

ConnectionsBuilder.prototype._transform = function (connectionRule, encoding, done) {
  //Examples of
  // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
  // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }
  // * a service: ["20181001", ...]
  this.processConnectionRule(connectionRule, done);
};

ConnectionsBuilder.prototype.processConnectionRule = function (connectionRule, done) {
  var departureDFM = parseGTFSDuration(connectionRule['departure_dfm']);
  var arrivalDFM = parseGTFSDuration(connectionRule['arrival_dfm']);
  this._expandTrip(connectionRule).then(async (trip) => {
    let service = trip.serviceDates;
    for (var i in service) {
      // GTFS defined a date as a strict string: yyyyMMdd, just parse it with substrings
      // TODO: what if the timezone is different than the local timezone? For now, you will have to change you local system’s time...
      let serviceDay = new Date(service[i].substr(0, 4), parseInt(service[i].substr(4, 2)) - 1, service[i].substr(6, 2));
      //add the duration to the date
      let departureTime = addDuration(serviceDay, departureDFM);
      let arrivalTime = addDuration(serviceDay, arrivalDFM);
      let startTime = addDuration(serviceDay, this._firstDepartureDFM);
      // Set startTime of the trip
      let tripOfThisConnection = Object.assign({}, trip);
      tripOfThisConnection['startTime'] = startTime;

      // Add complete Stop objects for more specific URI resolving
      let connection = {
        departureTime: departureTime,
        departureStop: await this._stopsdb.get(connectionRule['departure_stop']),
        arrivalTime: arrivalTime,
        arrivalStop: await this._stopsdb.get(connectionRule['arrival_stop']),
        trip: tripOfThisConnection
      };

      //The direction or headsign of a vehicle depends on several levels
      if (connectionRule['departure_stop_headsign'])
        connection['headsign'] = connectionRule['departure_stop_headsign'];
      else if (trip['trip_headsign'])
        connection['headsign'] = tripOfThisConnection['trip_headsign'];
      else if (trip.route['route_long_name'])
        connection['headsign'] = tripOfThisConnection.route['route_long_name'];

      if (connectionRule['arrival_stop_headsign'])
        connection['previous_headsign'] = connectionRule['arrival_stop_headsign'];

      if (connectionRule['drop_off_type']) {
        connection['drop_off_type'] = connectionRule['drop_off_type'];
      }

      if (connectionRule['pickup_type']) {
        connection['pickup_type'] = connectionRule['pickup_type'];
      }

      this.push(connection);
    }
    done();
  }).catch((error) => {
    done(error);
  });
};

/**
 * Expands a tripID to an entire trip ID object with route object and service object included.
 */
ConnectionsBuilder.prototype._expandTrip = async function (connectionRule) {
  let tripId = connectionRule['trip_id'];
  let trip = null;

  if (this._currentTrip && this._currentTrip === tripId) {
    trip = this._currentTrip;
  } else {
    try {
      trip = await this._tripsdb.get(tripId);
    } catch(err) {
      throw err;
    }
    
    // This is the first departure of this trip
    this._firstDepartureDFM = parseGTFSDuration(connectionRule['departure_dfm']);
  }

  if (!trip) {
    throw new Error('Did not find this trip id in trips.txt: ' + tripId);
  }

  // route is required in GTFS, but let’s still continue finding a service even when a route was not found
  let route = {};
  try {
    route = await this._routesdb.get(trip['route_id']);
    // Hotfix for route long names: usually contain --. However, we are 2018 at the time of writing and can use UTF-8!
    route.route_long_name = route.route_long_name.replace('--', '–');
  } catch (error) {
    throw new Error('Did not find this route id in routes.txt: ' + trip['route_id']);
  }
  trip.route = route;
  try {
    trip.serviceDates = await this._servicesdb.get(trip['service_id']);
    return trip;
  } catch (error) {
    throw new Error('Did not find this service id in calendar or calendar dates: ' + trip.service_id);
  }
};

module.exports = ConnectionsBuilder;
