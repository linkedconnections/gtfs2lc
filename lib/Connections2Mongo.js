/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Transforms Connections to Mongo Extended JSON objects
 * https://docs.mongodb.org/manual/reference/mongodb-extended-json/
 */
var Transform = require('stream').Transform,
    util = require('util');

var Connections2Mongo = function () {
  Transform.call(this, {objectMode : true});
};

util.inherits(Connections2Mongo, Transform);

Connections2Mongo.prototype._transform = function (connection, encoding, done) {
  //Transform to iso8601 and extended JSON of mongo
  if (connection['@context']) {
    //if there's a context involved, just send it through
    done(null, connection['@context']);
  } else {
    if (typeof connection['departureTime'] !== 'string') {
      connection['departureTime'] = connection['departureTime'].toISOString();
      connection['arrivalTime'] = connection['arrivalTime'].toISOString();
    }
    connection['departureTime'] = {'$date' : connection['departureTime'] };
    connection['arrivalTime'] = {'$date' : connection['arrivalTime'] };
    // If @id is set, change it to _id: JSON-LD specific
    if (connection['@id']) {
      connection['_id'] = connection['@id'];
      delete connection['@id'];
    }
    done(null, connection);
  }
};

module.exports = Connections2Mongo;
