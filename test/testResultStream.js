const gtfs2lc = require('../lib/gtfs2lc.js');
const assert = require('assert');
const N3 = require('n3');

describe('Testing whether result contains certain objects (regression tests)', function () {
  this.timeout(15000);
  var lcstreamToArray = function (options) {
    if (!options)
      options = {};
    return new Promise( (resolve, reject) => {
      var mapper = new gtfs2lc.Connections(options);
      mapper.resultStream('./test/sample-feed', (stream) => {
        if (options.format && options.format === "rdf") {
          stream = stream.pipe(new gtfs2lc.Connections2Triples({}));
        } else if(options.format && options.format === 'jsonld') {
          stream = stream.pipe(new gtfs2lc.Connections2JSONLD());
        }
        var connections = [];
        stream.on('data', connection => {
          connections.push(connection);
        });
        stream.on('error', (error) => {
          reject(error);
        });
        stream.on('end', () => {
          resolve(connections);
        });
      });
    });
  };

  it('Stream should contain certain things', async () => {
    var connections = await lcstreamToArray();
    assert.equal(connections[0]['arrivalStop'],'NANAA');
    assert.equal(connections[0]['headsign'],'City');
  });

  it('JSON-LD Stream should contain Connections', async () => {
    var triples = await lcstreamToArray({
      format : 'jsonld'
    });
    console.log(triples[0]);
    assert.equal(triples[0]['@type'],'Connection');
  });

  it('RDF Stream should contain Connections', async () => {
    var triples = await lcstreamToArray({
      format : 'rdf'
    });
    assert.equal(triples[0].object,'http://semweb.mmlab.be/ns/linkedconnections#Connection');
  });
});
