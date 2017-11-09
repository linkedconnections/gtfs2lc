/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 * 
 * This is one that works for the Belgian Railway company
 */
var moment = require('moment-timezone');

var URIStrategy = function (baseUris) {
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
  
};

/**
 * Returns a persistent identifier for a connection
 */
URIStrategy.prototype.getId = function (connection) {
  return this._baseUris.connections + connection.departureStop + "/" + encodeURIComponent(connection.departureTime.format("YYYYMMDD")) + "/"  + connection.trip.route.route_short_name + connection.trip.trip_short_name;
};

URIStrategy.prototype.getStopId = function (id) {
  return this._baseUris.stops + encodeURIComponent(id);
};

URIStrategy.prototype.getTripId = function (connection) {
  return this._baseUris.trips + connection.trip.route.route_short_name + connection.trip.trip_short_name + "/" + encodeURIComponent(connection.departureTime.format("YYYYMMDD"));
}

URIStrategy.prototype.getRouteId = function (connection) {
  return this._baseUris.routes + connection.trip.route.route_short_name + connection.trip.trip_short_name;
}

module.exports = URIStrategy;
