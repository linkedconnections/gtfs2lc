/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    URIStrategy = require('./URIStrategy.js');

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

  this._uris = new URIStrategy(baseUris);
  this._count = 0;
};

util.inherits(Connections2JSONLD, Transform);

Connections2JSONLD.prototype._transform = function (connection, encoding, done) {
  var id = this._uris.getId(connection);
  done(null, {
    "@id" : id,
    "@type" : "Connection",
    "departureStop" : this._uris.getStopId(connection.departureStop),
    "arrivalStop" : this._uris.getStopId(connection.arrivalStop),
    "departureTime" : connection.departureTime.toISOString(),
    "arrivalTime" : connection.arrivalTime.toISOString(),
    "gtfs:trip" : this._uris.getTripId(connection),
    "gtfs:route" : this._uris.getRouteId(connection)
  });
};

module.exports = Connections2JSONLD;
