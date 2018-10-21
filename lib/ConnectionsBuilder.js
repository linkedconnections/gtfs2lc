/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    LRU = require('lru-cache'),
    moment = require('moment');

var ConnectionsBuilder = function (tripsdb, servicesdb, routesdb) {
  Transform.call(this, {objectMode : true});
  this._tripsdb = tripsdb;
  this._servicesdb = servicesdb;
  this._routesdb = routesdb;
  this._tripsCache = new LRU(100);
};

util.inherits(ConnectionsBuilder, Transform);

ConnectionsBuilder.prototype._transform = function (connectionRule, encoding, done) {
  //Examples of
  // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
  // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }
  // * a service: ["20181001", ...]
  
  //todo: this should give an array of trips with their calendar dates of when they  are available.
  this.processConnectionRule(connectionRule, done);
  
  //TODO: if the trip IDs havent been used for a certain day, also process the connection Rules for that trip, with the same information as this one... This way, we’ll remove false positives!

  
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
      
      if (connectionRule['vias']) {
        connection['vias'] = connectionRule['vias'];
      }
      
      if (connectionRule['drop_off_type']) {
        connection['drop_off_type'] = connectionRule['drop_off_type'];
      }
      
      if (connectionRule['pickup_type']) {
        connection['pickup_type'] = connectionRule['pickup_type'];
      }
      connection.will_split_into = [];
      connection.joined_with = [];
          
      //Process will_split_into and joined_with: the trip id also has to drive on this service day before it will actually split or join...

      //Will contain the trip id and route id for the trip from which it will split
      try {
        if (connectionRule.will_split_into && connectionRule.will_split_into != '')
          connection.will_split_into = await this._retrieveSplitOrJoinTrips(serviceDay, connectionRule.will_split_into);
      } catch (error) {
        console.error(error);
      }
      
      try {
        if (connectionRule.joined_with && connectionRule.joined_with != '') {
          connection.joined_with = await this._retrieveSplitOrJoinTrips(serviceDay, connectionRule.joined_with);
        }
      } catch (error) {
        console.error(error);
      }
      this.push(connection);
    }
    done();
  }).catch((error) => {
    done(error);
  });
};

ConnectionsBuilder.prototype._retrieveSplitOrJoinTrips = async function (serviceDay, tripIds) {
  //In the CSV file, we use a separator |&AND&| to add multiple values to a single column.
  return Promise.all(tripIds.split('|&AND&|').map(async (tripId) => {
    if (tripId != '') {
      try {
        let trip = await this._expandTrip(tripId);
        if (trip.service.indexOf(serviceDay) > -1) {
          return trip;
        } else {
          //This trip is not running on this day. Return nothing.
          return ;
        }
      } catch (error) {
        console.error('WARNING: Error while processing split or joined train: ' + error);
      }
    }
  })).then((values) => {
    //filter out undefined values
    return values.filter((value) => {if (value) return value;});
  });
};

/**
 * Expands a tripID to an entire trip ID object with route object and service object included.
 */
ConnectionsBuilder.prototype._expandTrip = async function (tripId) {
  //fetch from cache first
  let tripCached = this._tripsCache.get(tripId);
  if (tripCached) {
    return tripCached;
  }
  
  try {
    let trip = await this._tripsdb.get(tripId);
    // route is required in GTFS, but let’s still continue finding a service even when a route was not found
    let route = {};
    try {
      route = await this._routesdb.get(trip['route_id']);
    } catch (error) {
      console.error('WARNING: somehow a route could not be found: ' + trip['route_id']);
    }
    trip.route = route;
    try {
      let service = await this._servicesdb.get(trip['service_id']);
      trip.service = service;
      this._tripsCache.set(tripId, trip);
      return trip;
    } catch (error) {
      throw 'Did not find this service id in calendar or calendar dates: ' + trip.trip_id;
    }
  } catch (error) {
    throw 'Did not find this trip id in trips.txt: ' + tripId;
  }
};

module.exports = ConnectionsBuilder;
