/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    URIStrategy = require('./URIStrategy.js');

var Connections2Triples = function (baseUris) {
  Transform.call(this, {objectMode : true});
  this._uris = new URIStrategy(baseUris);
  this._count = 0;
};

util.inherits(Connections2Triples, Transform);

Connections2Triples.prototype._transform = function (connection, encoding, done) {
  var id = this._uris.getId(connection);
  this.push({
    subject : id,
    predicate :'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
    object : 'http://semweb.mmlab.be/ns/linkedconnections#Connection'
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#departureStop',
    object : this._uris.getStopId(connection.departureStop["gtfs:parentStop"])
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#arrivalStop',
    object : this._uris.getStopId(connection.arrivalStop["gtfs:parentStop"])
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#departureTime',
    object : '"' + connection.departureTime.format() + '"^^http://www.w3.org/2001/XMLSchema#dateTime'
  });
  this.push({
    subject : id,
    predicate :'http://semweb.mmlab.be/ns/linkedconnections#arrivalTime',
    object : '"' + connection.arrivalTime.format() + '"^^http://www.w3.org/2001/XMLSchema#dateTime'
  });
  this.push({
    subject : id,
    predicate :'http://vocab.gtfs.org/terms#trip',
    object : this._uris.getTripId(connection)
  });
  this.push({
    subject : id,
    predicate :'http://vocab.gtfs.org/terms#route',
    object : this._uris.getRouteId(connection)
  });
  const types = ['http://vocab.gtfs.org/terms#Regular','http://vocab.gtfs.org/terms#NotAvailable','http://vocab.gtfs.org/terms#MustPhone','http://vocab.gtfs.org/terms#MustCoordinateWithDriver']

  if (connection['drop_off_type'] !== null) {
    this.push({
      subject : id,
      predicate :'http://vocab.gtfs.org/terms#dropOffType',
      object : types[connection['drop_off_type']]
    });
  }

  if (connection['pickup_type'] !== null) {
    this.push({
      subject : id,
      predicate :'http://vocab.gtfs.org/terms#pickupType',
      object : types[connection['pickup_type']]
    });
  }
  
  done();
};

module.exports = Connections2Triples;
