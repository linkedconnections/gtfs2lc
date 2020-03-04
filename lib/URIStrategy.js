/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */

const { format } = require('date-fns');
const uri_templates = require('uri-templates');

var URIStrategy = function (baseUris, stopsdb) {
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

  // Stops index from GTFS (stops.txt) to allow using other params besides 'stop_id' in URI templates
  // e.g. 'stop_code' (used by De Lijn!), 'stop_name', stop_lat', 'stop_lon', etc.
  this._stopsdb = stopsdb;

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
  return resolveURI(this._connectionTemplate, connection, null, this._resolve);
};

URIStrategy.prototype.getStopId = async function (id) {
  let stopid = await this._stopsdb.get(id);
  if (stopid) {
    return resolveURI(this._stopTemplate, null, stopid, this._resolve);
  } else {
    throw new Error('Stop ' + id + ' is not defined in stops.txt');
  }
};

URIStrategy.prototype.getTripId = function (connection) {
  return resolveURI(this._tripTemplate, connection, null, this._resolve);
};

URIStrategy.prototype.getRouteId = function (connection) {
  return resolveURI(this._routeTemplate, connection, null, this._resolve);
};

function resolveURI(template, connection, stop, resolve) {
  let varNames = template.varNames;
  let fillerObj = {};

  for (let i in varNames) {
    fillerObj[varNames[i]] = resolveValue(varNames[i], connection, stop, resolve);
  }

  return template.fill(fillerObj);
}

function resolveValue(param, connection, stop, resolve) {
  // Entity objects to be resolved as needed
  let trips = null;
  let routes = null;

  // Try first to resolve using keys in 'resolve' object
  if (resolve[param]) {
    trips = connection ? connection.trip : null;
    routes = connection ? connection.trip.route : null;
    let stops = stop;
    return eval(resolve[param]);
  }

  // Otherwise, keep behaviour for backward compatibility

  // GTFS source file and attribute name
  let source = param.split('.')[0];
  let attr = param.split('.')[1];
  let value = null;

  switch (source) {
    case 'trips':
      trips = connection.trip;
      if (attr.indexOf('startTime') >= 0) {
        let dateformat = attr.match(/\((.*?)\)/)[1];
        value = format(trips.startTime, dateformat);
      } else {
        value = trips[attr];
      }
      break;
    case 'routes':
      routes = connection.trip.route;
      value = routes[attr];
      break;
    case 'stops':
      value = stop[attr];
      break;
    case 'connection':
      if (attr.indexOf('departureTime') >= 0) {
        let dateformat = attr.match(/\((.*?)\)/)[1];
        value = format(connection.departureTime, dateformat);
      } else if (attr.indexOf('arrivalTime') >= 0) {
        let dateformat = attr.match(/\((.*?)\)/)[1];
        value = format(connection.arrivalTime, dateformat);
      } else {
        value = connection[attr];
      }
      break;
  }

  return value;
}

module.exports = URIStrategy;
