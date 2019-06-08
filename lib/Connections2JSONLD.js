/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
  util = require('util'),
  URIStrategy = require('./URIStrategy.js');

var Connections2JSONLD = function (baseUris, stopsdb, context) {
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
      "arrivalTime": "http://semweb.mmlab.be/ns/linkedconnections#arrivalTime",
      "direction": "gtfs:headsign"
    }
  };

  this._uris = new URIStrategy(baseUris, stopsdb);
  this._count = 0;
};

util.inherits(Connections2JSONLD, Transform);

Connections2JSONLD.prototype._transform = function (connection, encoding, done) {
  try {
    var id = this._uris.getId(connection);
    const types = ['gtfs:Regular', 'gtfs:NotAvailable', 'gtfs:MustPhone', 'gtfs:MustCoordinateWithDriver'];

    var lc = {
      "@id": id,
      "@type": "Connection",
      "departureStop": this._uris.getStopId(connection.departureStop),
      "arrivalStop": this._uris.getStopId(connection.arrivalStop),
      "departureTime": connection.departureTime.toISOString(),
      "arrivalTime": connection.arrivalTime.toISOString(),
      "gtfs:trip": this._uris.getTripId(connection),
      "gtfs:route": this._uris.getRouteId(connection)
    };

    //the headsign is already the result here of earlier checking whether there’s a trip headsign or a route headsign if connection headsign was not set. It can be used reliably
    if (connection.headsign) {
      lc["direction"] = connection.headsign;
    }

    var pickupType = types[0];
    if (connection['pickup_type'] && connection['pickup_type'] !== null) {
      pickupType = types[connection['pickup_type']];
      lc["gtfs:pickupType"] = pickupType;
    }

    var dropOffType = types[0];
    if (connection['drop_off_type'] && connection['drop_off_type'] !== null) {
      dropOffType = types[connection['drop_off_type']];
      lc["gtfs:dropOffType"] = dropOffType;
    }

    done(null, lc);
  } catch (err) {
    console.error(err);
    done(null, {});
  }
};

module.exports = Connections2JSONLD;
