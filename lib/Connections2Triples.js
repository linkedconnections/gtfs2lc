/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    moment = require('moment');

var Connections2Triples = function (baseUris) {
  Transform.call(this, {objectMode : true});
  var defaultBaseUris = {
    stops : 'http://example.org/stops/',
    connections : 'http://example.org/connections/',
    trips : 'http://example.org/trips/',
    routes : 'http://example.org/routes/'
  };
  if (!baseUris) {
    baseUris = defaultBaseUris;
  } else {
    if (typeof baseUris.stops !== 'string') {
      baseUris.stops = defaultBaseUris.stops;
    }
    if (typeof baseUris.trips !== 'string') {
      baseUris.trips = defaultBaseUris.trips;
    }
    if (typeof baseUris.routes !== 'string') {
      baseUris.routes = defaultBaseUris.routes;
    }
    if (typeof baseUris.connections !== 'string') {
      baseUris.connections = defaultBaseUris.connections;
    }
  }
  this._baseUris = baseUris;
  this._count = 0;
};

util.inherits(Connections2Triples, Transform);

Connections2Triples.prototype._transform = function (connection, encoding, done) {
  var id = this._baseUris.connections + encodeURIComponent(connection.departureTime + connection.departureStop + connection.trip);
  this.push({
    subject : id,
    predicate :'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    object : 'http://semweb.mmlab.be/ns/linkedconnections#Connection'
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#departureStop',
    object : this._baseUris.stops + encodeURIComponent(connection.departureStop)
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#arrivalStop',
    object : this._baseUris.stops + encodeURIComponent(connection.arrivalStop)
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#departureTime',
    object : '"' + connection.departureTime.toISOString() + '"^^http://www.w3.org/2001/XMLSchema#dateTime'
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#arrivalTime',
    object : '"' + connection.arrivalTime.toISOString() + '"^^http://www.w3.org/2001/XMLSchema#dateTime'
  });
  this.push({
    subject : id,
    predicate :'http://vocab.gtfs.org/terms#trip',
    object : this._baseUris.trips + encodeURIComponent(connection.trip)
  });
  this.push({
    subject : id,
    predicate :'http://vocab.gtfs.org/terms#route',
    object : this._baseUris.routes + encodeURIComponent(connection.route)
  });
  done();
};

module.exports = Connections2Triples;
