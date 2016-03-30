/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    moment = require('moment');

var Connections2JSONLD = function (baseUris, context) {
  Transform.call(this, {objectMode : true});
  this.context = context || {
    "@context" : {
      "lc" : "http://semweb.mmlab.be/ns/linkedconnections#",
      "Connection" : "http://semweb.mmlab.be/ns/linkedconnections#Connection",
      "gtfs" : "http://vocab.gtfs.org/terms#",
      "departureStop" : {
        "@type" : "@id",
        "@id" : "http://semweb.mmlab.be/ns/linkedconnections#departureStop"
      },
      "arrivalStop" : {
        "@type" : "@id",
        "@id" : "http://semweb.mmlab.be/ns/linkedconnections#arrivalStop"
      },
      "departureTime" : "http://semweb.mmlab.be/ns/linkedconnections#departureTime",
      "arrivalTime" : "http://semweb.mmlab.be/ns/linkedconnections#arrivalTime"
    } 
  };
  
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

util.inherits(Connections2JSONLD, Transform);

Connections2JSONLD.prototype._transform = function (connection, encoding, done) {
  var id = this._baseUris.connections + encodeURIComponent(connection.departureTime + connection.departureStop + connection.trip);
  done(null, {
    "@id" : id,
    "@type" : "Connection",
    "departureStop" : this._baseUris.stops + encodeURIComponent(connection.departureStop),
    "arrivalStop" : this._baseUris.stops + encodeURIComponent(connection.arrivalStop),
    "departureTime" : connection.departureTime.toISOString(),
    "arrivalTime" : connection.arrivalTime.toISOString(),
    "gtfs:trip" : this._baseUris.trips + encodeURIComponent(connection.trip),
    "gtfs:route" : this._baseUris.routes + encodeURIComponent(connection.route)
  });
};

module.exports = Connections2JSONLD;
