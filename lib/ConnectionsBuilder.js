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
  //{"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
  //TODO
  connectionRule["trip_id"];
};

module.exports = ConnectionsBuilder;
