/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
  util = require('util'),
  URIStrategy = require('./URIStrategy.js');

var Connections2JSONLD = function (baseUris, context) {
  Transform.call(this, { objectMode: true });
  this.context = context || {
    "@context": {
      "lc": "http://semweb.mmlab.be/ns/linkedconnections#",
      "Connection": "http://semweb.mmlab.be/ns/linkedconnections#Connection",
      "gtfs": "http://vocab.gtfs.org/terms#",
      "departureStop": {
        "@type": "@id",
        "@id": "http://semweb.mmlab.be/ns/linkedconnections#departureStop"
      },
      "arrivalStop": {
        "@type": "@id",
        "@id": "http://semweb.mmlab.be/ns/linkedconnections#arrivalStop"
      },
      "departureTime": "http://semweb.mmlab.be/ns/linkedconnections#departureTime",
      "arrivalTime": "http://semweb.mmlab.be/ns/linkedconnections#arrivalTime"
    }
  };

  this._uris = new URIStrategy(baseUris);
  this._count = 0;
};

util.inherits(Connections2JSONLD, Transform);

Connections2JSONLD.prototype._transform = function (connection, encoding, done) {
  var id = this._uris.getId(connection);
  const types = ['gtfs:Regular', 'gtfs:NotAvailable', 'gtfs:MustPhone', 'gtfs:MustCoordinateWithDriver'];

  var lc = {
    "@id": id,
    "@type": "Connection",
    "departureStop": {
      'gtfs:parentStop': this._uris.getStopId(connection.departureStop['gtfs:parentStop']),
      'gtfs:stop': this._uris.getStopId(connection.departureStop['gtfs:stop']),
      'dct:description': connection.departureStop['dct:description'],
      'dct:identifier': connection.departureStop['dct:identifier'],
      'rfds:label': connection.departureStop['rfds:label']
    },
    "arrivalStop": {
      'gtfs:parentStop': this._uris.getStopId(connection.arrivalStop['gtfs:parentStop']),
      'gtfs:stop': this._uris.getStopId(connection.arrivalStop['gtfs:stop']),
      'dct:description': connection.arrivalStop['dct:description'],
      'dct:identifier': connection.arrivalStop['dct:identifier'],
      'rfds:label': connection.arrivalStop['rfds:label']
    },
    "departureTime": connection.departureTime.toISOString(),
    "arrivalTime": connection.arrivalTime.toISOString(),
    "gtfs:trip": this._uris.getTripId(connection),
    "gtfs:route": this._uris.getRouteId(connection)
  };

  if(connection.trip.trip_headsign) {
    lc["direction"] = connection.trip.trip_headsign;
  }

  var pickupType = types[0];
  if (connection['pickup_type'] && connection['pickup_type'] !== null) {
    pickupType = types[connection['pickup_type']];
    lc["gtfs:pickupType"] = pickupType;
  }

  var dropOffType = types[0];
  if (connection['drop_off_type'] && connection['drop_off_type'] !== null) {
    dropOffType = types[connection['drop_off_type']];
    lc["gtfs:dropOffType"] = pickupType;
  }

  done(null, lc);
};

module.exports = Connections2JSONLD;
