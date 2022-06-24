/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */

const { format } = require('date-fns');
const uri_templates = require('uri-templates');

var URIStrategy = function (baseUris) {
  var defaultBaseUris = {
    stop: 'http://example.org/stops/{stops.stop_id}',
    route: 'http://example.org/routes/{routes.route_id}',
    trip:
      'http://example.org/trips/{trips.trip_id}/{trips.startTime(yyyyMMdd)}',
    connection:
      'http://example.org/connections/{trips.startTime(yyyyMMdd)}/{depStop}/{trips.trip_id}',
    resolve: {
      depStop: 'connection.departureStop.stop_id'
    }
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
  this._resolve = baseUris.resolve || {};
};

/**
 * Returns a persistent identifier for a connection
 */
URIStrategy.prototype.getId = function (connection) {
  return resolveURI(this._connectionTemplate, connection, this._resolve);
};

URIStrategy.prototype.getStopId = function (stop) {
  return resolveURI(this._stopTemplate, stop, this._resolve);
};

URIStrategy.prototype.getTripId = function (connection) {
  return resolveURI(this._tripTemplate, connection, this._resolve);
};

URIStrategy.prototype.getRouteId = function (connection) {
  return resolveURI(this._routeTemplate, connection, this._resolve);
};

function resolveURI(template, object, resolve) {
  let varNames = template.varNames;
  let fillerObj = {};

  for (let i in varNames) {
    fillerObj[varNames[i]] = resolveValue(varNames[i], object, resolve);
  }

  return template.fill(fillerObj);
}

function resolveValue(param, object, resolve) {
  // Entity objects to be resolved as needed
  const trips = object.trip ? object.trip : null;
  const routes = object.route ? object.route : null;
  const stops = object['stop_id'] ? object : null;

  // Try first to resolve using keys in 'resolve' object
  if (resolve[param]) {
    const connection = object;
    return eval(resolve[param]);
  }

  // GTFS source file and attribute name
  const source = param.split('.')[0];
  const attr = param.split('.')[1];
  let value = null;

  switch (source) {
    case 'trips':
      if (attr.indexOf('startTime') >= 0) {
        const dateformat = attr.match(/\((.*?)\)/)[1];
        value = format(trips.startTime, dateformat);
      } else {
        value = trips[attr];
      }
      break;
    case 'routes':
      value = routes[attr];
      break;
    case 'stops':
      value = stops[attr];
      break;
    case 'connection':
      if (attr.indexOf('departureTime') >= 0) {
        const dateformat = attr.match(/\((.*?)\)/)[1];
        value = format(object.departureTime, dateformat);
      } else if (attr.indexOf('arrivalTime') >= 0) {
        const dateformat = attr.match(/\((.*?)\)/)[1];
        value = format(object.arrivalTime, dateformat);
      } else if (attr.indexOf('departureStop') >= 0) {
        value = object.departureStop['stop_id'];
      } else if (attr.indexOf('arrivalStop') >= 0) {
        value = object.arrivalStop['stop_id'];
      } else {
        value = object[attr];
      }
      break;
  }

  return value;
}

module.exports = URIStrategy;
