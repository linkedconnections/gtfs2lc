const gtfs2lc = require('../lib/gtfs2lc.js');
const assert = require('assert');
const N3 = require('n3');
const fs = require('fs');

describe('Testing whether result contains certain objects (regression tests)', function() {
  this.timeout(240000);
  var lcstreamToArray = function (options) {
    if (!options)
      options = {};
    return new Promise(async (resolve, reject) => {
      let mapper = new gtfs2lc.Connections('./test/sample-feed/', options);
      let baseUris = JSON.parse(fs.readFileSync('baseUris-example.json', 'utf-8'));

      let connectionSources = await mapper.getConnectionsByZones();
      let linkedConnections = {};
      let count = 0;

      Object.keys(connectionSources).forEach(key => {
        let stream = connectionSources[key];
        if (options.format && options.format === "rdf") {
          stream = stream.pipe(new gtfs2lc.Connections2Triples(baseUris));
        } else if (options.format && options.format === 'jsonld') {
          stream = stream.pipe(new gtfs2lc.Connections2JSONLD(baseUris));
        }

        let conns = [];

        stream.on('data', c => {
          conns.push(c);
        })
        .on('error', err => {
          reject(err);
        })
        .on('end', () => {
          linkedConnections[key] = conns;
          finish();
        });
      });

      let finish = async () => {
        count++;
        if(count >= Object.keys(connectionSources).length) {
          await mapper.close();
          resolve(linkedConnections);
        }
      };
    });
  };

  it('Stream should contain certain things', async () => {
    let connections = await lcstreamToArray({format: 'jsonld'});
    assert.equal(connections['Antwerpen'][1]['arrivalStop'],'https://data.delijn.be/stops/107814');
    assert.equal(connections['Antwerpen'][1]['direction'],'Puurs - Brussel');
  });
});
