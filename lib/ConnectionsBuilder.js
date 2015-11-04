/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    moment = require('moment');

var ConnectionsBuilder = function (tripsdb, servicesdb) {
  Transform.call(this, {objectMode : true});
  this._tripsdb = tripsdb;
  this._servicesdb = servicesdb;
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
    trip = JSON.parse(trip); 
    self._servicesdb.get(trip['service_id'], function (error, service) {
      service = JSON.parse(service);
      for (var i in service) {
        var serviceDay = service[i];
        var departureTime = moment(serviceDay, 'YYYYMMDD').add(departureDFM);
        var arrivalTime = moment(serviceDay, 'YYYYMMDD').add(arrivalDFM);
        self.push({
          departureTime: departureTime,
          arrivalTime: arrivalTime,
          arrivalStop: connectionRule['arrival_stop'],
          departureStop: connectionRule['departure_stop'],
          trip: connectionRule['trip_id']
        });
      }
      done();
    });
  });
};

module.exports = ConnectionsBuilder;
