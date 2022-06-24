/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
  util = require('util'),
  URIStrategy = require('./URIStrategy.js');

var Connections2JSONLD = function (baseUris, context) {
  Transform.call(this, { objectMode: true });
  this._contextStreamed = false;
  this._context = context;

  // Skip context if none provided
  if(!this._context) {
    this._contextStreamed = true;
  }

  this._uris = new URIStrategy(baseUris);
  this._count = 0;
};

util.inherits(Connections2JSONLD, Transform);

Connections2JSONLD.prototype._transform = function (connection, encoding, done) {
  try {
    if (!this._contextStreamed) {
      this._contextStreamed = true;
      done(null, this._context);
    } else {
      var id = this._uris.getId(connection);
      const types = ['gtfs:Regular', 'gtfs:NotAvailable', 'gtfs:MustPhone', 'gtfs:MustCoordinateWithDriver'];

      var lc = {
        "@id": id,
        "@type": "Connection",
        "departureStop": this._uris.getStopId(connection.departureStop),
        "arrivalStop": this._uris.getStopId(connection.arrivalStop),
        "departureTime": connection.departureTime,
        "arrivalTime": connection.arrivalTime,
        "gtfs:trip": this._uris.getTripId(connection),
        "gtfs:route": this._uris.getRouteId(connection)
      };

      // the headsign is already the result here of earlier checking whether there’s a trip headsign 
      // or a route headsign if connection headsign was not set. It can be used reliably
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
    }
  } catch (err) {
    done(null, {});
  }
};

module.exports = Connections2JSONLD;
