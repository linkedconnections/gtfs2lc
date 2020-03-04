/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
  util = require('util'),
  URIStrategy = require('./URIStrategy.js'),
  N3 = require('n3'),
  { DataFactory } = N3,
  { namedNode, literal, quad } = DataFactory;;

var Connections2Triples = function (baseUris, stopsdb) {
  Transform.call(this, { objectMode: true });
  this._uris = new URIStrategy(baseUris, stopsdb);
  this._count = 0;
};

util.inherits(Connections2Triples, Transform);

Connections2Triples.prototype._transform = async function (connection, encoding, done) {
  var id = this._uris.getId(connection);
  this.push(
    quad(
      namedNode(id),
      namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'),
      namedNode('http://semweb.mmlab.be/ns/linkedconnections#Connection')
    ));
  this.push(
    quad(
      namedNode(id),
      namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureStop'),
      namedNode(await this._uris.getStopId(connection.departureStop.stop_id))
    ));
  this.push(
    quad(
      namedNode(id),
      namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalStop'),
      namedNode(await this._uris.getStopId(connection.arrivalStop.stop_id))
    ));
  this.push(
    quad(
      namedNode(id),
      namedNode('http://semweb.mmlab.be/ns/linkedconnections#departureTime'),
      literal(connection.departureTime.toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))
    ));
  this.push(
    quad(
      namedNode(id),
      namedNode('http://semweb.mmlab.be/ns/linkedconnections#arrivalTime'),
      literal(connection.arrivalTime.toISOString(), namedNode('http://www.w3.org/2001/XMLSchema#dateTime'))
    ));
  this.push(
    quad(
      namedNode(id),
      namedNode('http://vocab.gtfs.org/terms#trip'),
      namedNode(this._uris.getTripId(connection))
    ));
  this.push(
    quad(
      namedNode(id),
      namedNode('http://vocab.gtfs.org/terms#route'),
      namedNode(this._uris.getRouteId(connection))
    ));

  var headsign = connection.headsign || connection.trip.trip_headsign;

  if (headsign) {
    this.push(
      quad(
        namedNode(id),
        namedNode('http://vocab.gtfs.org/terms#headsign'),
        literal(headsign, namedNode('http://www.w3.org/2001/XMLSchema#string'))
      ));
  }

  const types = ['http://vocab.gtfs.org/terms#Regular', 'http://vocab.gtfs.org/terms#NotAvailable', 'http://vocab.gtfs.org/terms#MustPhone', 'http://vocab.gtfs.org/terms#MustCoordinateWithDriver']

  if (connection['drop_off_type'] && connection['drop_off_type'] !== null) {
    this.push(
      quad(
        namedNode(id),
        namedNode('http://vocab.gtfs.org/terms#dropOffType'),
        namedNode(types[connection['drop_off_type']])
      ));
  }

  if (connection['pickup_type'] && connection['pickup_type'] !== null) {
    this.push(
      quad(
        namedNode(id),
        namedNode('http://vocab.gtfs.org/terms#pickupType'),
        namedNode(types[connection['pickup_type']])
      ));
  }

  done();
};

module.exports = Connections2Triples;
