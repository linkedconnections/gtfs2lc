/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    moment = require('moment');

var ConnectionsBuilder = function (tripsdb, servicesdb, routesdb) {
  Transform.call(this, {objectMode : true});
  this._tripsdb = tripsdb;
  this._servicesdb = servicesdb;
  this._routesdb = routesdb;
};

util.inherits(ConnectionsBuilder, Transform);

ConnectionsBuilder.prototype._transform = function (connectionRule, encoding, done) {
  //Examples of
  // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
  // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }
  var departureDFM = moment.duration(connectionRule['departure_dfm']);
  var arrivalDFM = moment.duration(connectionRule['arrival_dfm']);
  var self = this;
  this._tripsdb.get(connectionRule['trip_id'], function (error, trip) {
    if (!error) {
      self._routesdb.get(trip['route_id'], function (error, route) {
        if (!error) {
          self._servicesdb.get(trip['service_id'], function (error, service) {
            if (!error) {
              for (var i in service) {
                trip["route"] = route;
                var serviceDay = service[i];
                var departureTime = moment(serviceDay, 'YYYYMMDD').add(departureDFM);
                var arrivalTime = moment(serviceDay, 'YYYYMMDD').add(arrivalDFM);
                var connection = {
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
                else if (route['route_long_name'])
                  connection['headsign'] = route['route_long_name'];
                
                if (connectionRule['arrival_stop_headsign'])
                  connection['previous_headsign'] = connectionRule['arrival_stop_headsign'];
                self.push(connection);
              }
            }
            done();
          });

        }
      });
      
    }
  });
};

module.exports = ConnectionsBuilder;
