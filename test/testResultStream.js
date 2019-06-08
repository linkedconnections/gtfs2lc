const gtfs2lc = require('../lib/gtfs2lc.js');
const assert = require('assert');
const N3 = require('n3');

describe('Testing whether result contains certain objects (regression tests)', () => {
  
  var lcstreamToArray = function (options) {
    if (!options)
      options = {};
    return new Promise( (resolve, reject) => {
      var mapper = new gtfs2lc.Connections(options);
      mapper.resultStream('./test/sample-feed', (stream, stopsdb) => {
        if (options.format && options.format === "rdf") {
          stream = stream.pipe(new gtfs2lc.Connections2Triples({}, stopsdb));
        } else if(options.format && options.format === 'jsonld') {
          stream = stream.pipe(new gtfs2lc.Connections2JSONLD(null, stopsdb, null));
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

  var connections;
  //This will be the first element when sorted correctly
  it('Stream should contain a first connection with arrivalStop AMV', async () => {
    connections = await lcstreamToArray();
    assert.equal(connections[0]['arrivalStop'],'AMV');
  });

  it('JSON-LD Stream should contain Connections and use LevelStore for data storage', async () => {
    var triples = await lcstreamToArray({
      format : 'jsonld',
      store: 'LevelStore'
    });
    assert.equal(triples[0]['@type'],'Connection');
  });

  it('RDF Stream should contain Connections', async () => {
    var triples = await lcstreamToArray({
      format : 'rdf'
    });
    assert.equal(triples[0].object,'http://semweb.mmlab.be/ns/linkedconnections#Connection');
  });
});
