/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
const { Transform } = require('stream');
const util = require('util');
const URIStrategy = require('./URIStrategy.js');

class Connections2JSONLD extends Transform {
  constructor(baseUris, context, streamContext) {
    super({ objectMode: true });
    this._uris = new URIStrategy(baseUris);
    this._streamContext = streamContext || false;
    this._contextSent = false;
    this._context = context || {
      "@context": {
        "xsd": "http://www.w3.org/2001/XMLSchema#",
        "lc": "http://semweb.mmlab.be/ns/linkedconnections#",
        "gtfs": "http://vocab.gtfs.org/terms#",
        "Connection": "lc:Connection",
        "departureStop": {
          "@type": "@id",
          "@id": "lc:departureStop"
        },
        "arrivalStop": {
          "@type": "@id",
          "@id": "lc:arrivalStop"
        },
        "departureTime": {
          "@id": "lc:departureTime",
          "@type": "xsd:dateTime"
        },
        "arrivalTime": {
          "@id": "lc:arrivalTime",
          "@type": "xsd:dateTime"
        },
        "departureDelay": {
          "@id": "lc:departureDelay",
          "@type": "xsd:integer"
        },
        "arrivalDelay": {
          "@id": "lc:arrivalDelay",
          "@type": "xsd:integer"
        },
        "direction": {
          "@id": "gtfs:headsign",
          "@type": "xsd:string"
        },
        "gtfs:trip": {
          "@type": "@id"
        },
        "gtfs:route": {
          "@type": "@id"
        }
      }
    };
  }

  _transform(connection, encoding, done) {
    if (this._streamContext && !this._contextSent) {
      this.push(this._context);
      this._contextSent = true;
    }

    let id = this._uris.getId(connection);
    const types = ['gtfs:Regular', 'gtfs:NotAvailable', 'gtfs:MustPhone', 'gtfs:MustCoordinateWithDriver'];

    let lc = {
      "@id": id,
      "@type": "Connection",
      "departureStop": this._uris.getStopId(connection.departureStop),
      "arrivalStop": this._uris.getStopId(connection.arrivalStop),
      "departureTime": connection.departureTime.toISOString(),
      "arrivalTime": connection.arrivalTime.toISOString(),
      "gtfs:trip": this._uris.getTripId(connection),
      "gtfs:route": this._uris.getRouteId(connection)
    };

    if (connection.trip.trip_headsign) {
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
  }
}

module.exports = Connections2JSONLD;
