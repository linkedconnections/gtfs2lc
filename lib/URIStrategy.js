/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var moment = require('moment-timezone');
var uri_templates = require('uri-templates');

var URIStrategy = function (baseUris) {
  var defaultBaseUris = {
    stop: 'http://example.org/stops/{stops.stop_id}',
    route: 'http://example.org/routes/{routes.route_id}',
    trip: 'http://example.org/trips/{trips.trip_id}',
    connection: 'http://example.org/connections/{connection.departureTime(YYYYMMDD)}/{stops.stop_id}/{trips.trip_id}'
  };
  if (!baseUris) {
    baseUris = defaultBaseUris;
  } else {
    if (typeof baseUris.stop !== 'string') {
      baseUris.stop = defaultBaseUris.stop;
    }
    if (typeof baseUris.trip !== 'string') {
      baseUris.trip = defaultBaseUris.trip;
    }
    if (typeof baseUris.route !== 'string') {
      baseUris.route = defaultBaseUris.route;
    }
    if (typeof baseUris.connection !== 'string') {
      baseUris.connection = defaultBaseUris.connection;
    }
  }

  this._stopTemplate = uri_templates(baseUris.stop);
  this._routeTemplate = uri_templates(baseUris.route);
  this._tripTemplate = uri_templates(baseUris.trip);
  this._connectionTemplate = uri_templates(baseUris.connection);

};

/**
 * Returns a persistent identifier for a connection
 */
URIStrategy.prototype.getId = function (connection) {
  return resolveURI(this._connectionTemplate, connection);
};

URIStrategy.prototype.getStopId = function (stop) {
  let param = this._stopTemplate.varNames[0];
  return this._stopTemplate.fill({ [param]: stop[param.split('.')[1]] });
};

URIStrategy.prototype.getTripId = function (connection) {
  return resolveURI(this._tripTemplate, connection);
}

URIStrategy.prototype.getRouteId = function (connection) {
  return resolveURI(this._routeTemplate, connection);
}

function resolveURI(template, connection) {
  let varNames = template.varNames;
  let fillerObj = {};

  for (let i in varNames) {
    fillerObj[varNames[i]] = resolveValue(varNames[i], connection);
  }

  return template.fill(fillerObj);
}

function resolveValue(param, connection) {
  // GTFS source file and attribute name
  let source = param.split('.')[0];
  let attr = param.split('.')[1];

  // Entity objects to be resolved as needed
  let trip = null;
  let route = null;
  let stop = null;

  let value = null;

  switch (source) {
    case 'trips':
      trip = connection.trip;
      if (attr.indexOf('startTime') >= 0) {
        let format = attr.match(/\((.*?)\)/)[1];
        value = connection.startTime.format(format);
      } else {
        value = trip[attr];
      }
      break;
    case 'routes':
      route = connection.trip.route;
      value = route[attr];
      break;
    case 'connection':
      if (attr.indexOf('departureTime') >= 0) {
        let format = attr.match(/\((.*?)\)/)[1];
        value = connection.departureTime.format(format);
      } else if (attr.indexOf('arrivalTime') >= 0) {
        let format = attr.match(/\((.*?)\)/)[1];
        value = connection.arrivalTime.format(format);
      } else if (attr.indexOf('departureStop') >= 0) {
        let param = attr.match(/\((.*?)\)/)[1];
        value = connection.departureStop[param];
      } else if (attr.indexOf('arrivalStop') >= 0) {
        let param = attr.match(/\((.*?)\)/)[1];
        value = connection.arrivalStop[param];
      } else {
        value = connection[attr];
      }
      break;
  }

  return value;
}

module.exports = URIStrategy;
