/**
 * Pieter Colpaert © Ghent University -- IDLab -- imec
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    moment = require('moment');

var ConnectionsBuilder = function (tripsIterator, servicesdb, routesdb) {
  Transform.call(this, {objectMode : true});
  this._tripsIterator = tripsIterator;
  this._servicesdb = servicesdb;
  this._routesdb = routesdb;
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
  var departureDFM = moment.duration(connectionRule['departure_dfm']);
  var arrivalDFM = moment.duration(connectionRule['arrival_dfm']);
  this._expandTrip(connectionRule['trip_id']).then(async (trip) => {
    let service = trip.service;
    for (var i in service) {
      let serviceDay = service[i];
      let departureTime = moment(serviceDay, 'YYYYMMDD').add(departureDFM);
      let arrivalTime = moment(serviceDay, 'YYYYMMDD').add(arrivalDFM);
      let connection = {
        departureTime: departureTime,
        arrivalTime: arrivalTime,
        arrivalStop: connectionRule['arrival_stop'],
        departureStop: connectionRule['departure_stop'],
        trip: trip
      };
      
      //The direction or headsign of a vehicle depends on several levels
      if (connectionRule['departure_stop_headsign']) 
        connection['headsign'] = connectionRule['departure_stop_headsign'];
      else  if (trip['trip_headsign'])
        connection['headsign'] = trip['trip_headsign'];
      else if (trip.route['route_long_name'])
        connection['headsign'] = trip.route['route_long_name'];
      
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
ConnectionsBuilder.prototype._expandTrip = async function (tripId) {
  let trip = null;
  if (this._tripsIterator.getCurrentObject() && tripId === this._tripsIterator.getCurrentObject().trip_id) {
    trip = this._tripsIterator.getCurrentObject();
  } else {
    trip = await this._tripsIterator.next();
    if (trip && tripId !== trip.trip_id) {
      throw 'Did not find this trip id in trips.txt: ' + tripId;
    }
  }
  
  // route is required in GTFS, but let’s still continue finding a service even when a route was not found
  let route = {};
  try {
    route = await this._routesdb.get(trip['route_id']);
  } catch (error) {
    console.error('WARNING: somehow a route could not be found: ' + trip.route_id);
  }
  trip.route = route;
  try {
    trip.service = await this._servicesdb.get(trip['service_id']);
    return trip;
  } catch (error) {
    throw 'Did not find this service id in calendar or calendar dates: ' + trip.service_id;
  }
};

module.exports = ConnectionsBuilder;
