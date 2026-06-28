const { Transform } = require("node:stream");
const { DataFactory } = require("rdf-data-factory");
const URIStrategy = require("./URIStrategy.js");

const factory = new DataFactory();
const namedNode = factory.namedNode.bind(factory);
const literal = factory.literal.bind(factory);
const quad = factory.quad.bind(factory);

const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const LC = "http://semweb.mmlab.be/ns/linkedconnections#";
const GTFS = "http://vocab.gtfs.org/terms#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const boardingTypes = [
  `${GTFS}Regular`,
  `${GTFS}NotAvailable`,
  `${GTFS}MustPhone`,
  `${GTFS}MustCoordinateWithDriver`,
];

class Connections2Triples extends Transform {
  constructor(baseUris, initialMessageCounter = 0) {
    super({ objectMode: true });
    this.uris = new URIStrategy(baseUris);
    this.messageCounter = initialMessageCounter;
  }

  _transform(connection, _encoding, callback) {
    try {
      const id = namedNode(this.uris.getId(connection));
      const quads = [
        quad(id, RDF_TYPE, namedNode(`${LC}Connection`)),
        quad(
          id,
          namedNode(`${LC}departureStop`),
          namedNode(this.uris.getStopId(connection.departureStop)),
        ),
        quad(
          id,
          namedNode(`${LC}arrivalStop`),
          namedNode(this.uris.getStopId(connection.arrivalStop)),
        ),
        quad(
          id,
          namedNode(`${LC}departureTime`),
          literal(
            connection.departureTime.toISOString(),
            namedNode(`${XSD}dateTime`),
          ),
        ),
        quad(
          id,
          namedNode(`${LC}arrivalTime`),
          literal(
            connection.arrivalTime.toISOString(),
            namedNode(`${XSD}dateTime`),
          ),
        ),
        quad(
          id,
          namedNode(`${GTFS}trip`),
          namedNode(this.uris.getTripId(connection)),
        ),
        quad(
          id,
          namedNode(`${GTFS}route`),
          namedNode(this.uris.getRouteId(connection)),
        ),
      ];

      const headsign = connection.headsign || connection.trip.trip_headsign;
      if (headsign) {
        quads.push(
          quad(
            id,
            namedNode(`${GTFS}headsign`),
            literal(headsign, namedNode(`${XSD}string`)),
          ),
        );
      }
      if (connection.drop_off_type) {
        quads.push(
          quad(
            id,
            namedNode(`${GTFS}dropOffType`),
            namedNode(boardingTypes[connection.drop_off_type]),
          ),
        );
      }
      if (connection.pickup_type) {
        quads.push(
          quad(
            id,
            namedNode(`${GTFS}pickupType`),
            namedNode(boardingTypes[connection.pickup_type]),
          ),
        );
      }

      for (const connectionQuad of quads) {
        this.push({
          quad: connectionQuad,
          messageCounter: this.messageCounter,
        });
      }
      this.messageCounter += 1;
      callback();
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = Connections2Triples;
