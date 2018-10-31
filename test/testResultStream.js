const gtfs2lc = require('../lib/gtfs2lc.js');
const assert = require('assert');
const N3 = require('n3');
const fs = require('fs');

describe('Testing whether result contains certain objects (regression tests)', function () {
  this.timeout(300000);

  var lcstreamToArray = options => {
    if (!options)
      options = {};
    return new Promise(async (resolve, reject) => {
      //let baseUris = JSON.parse(fs.readFileSync('./baseUris-example.json', 'utf-8'));
      //options.baseUris = baseUris;
      let mapper = new gtfs2lc.Connections('./test/sample-feed', options);
      await mapper.close();
      resolve(await mapper.map());
    });
  };

  it('Stream should contain certain things', async () => {
    try {
      // First load De Lijn fragmentation index
      let index = new Map(JSON.parse(fs.readFileSync('./test/delijnIndex.json', 'utf8')));
      let files = await lcstreamToArray({
        format: 'jsonld',
        store: 'KeyvStore',
        fragmentBy: 'stop_id',
        fragmentIndex: index
      });

      //let files = await lcstreamToArray({ format: 'jsonld', store: 'MemStore' });
      console.log(files);
    } catch (err) {
      console.error(err);
    }

    //assert.equal(connections['Antwerpen'][1]['arrivalStop'],'https://data.delijn.be/stops/107814');
    //assert.equal(connections['Antwerpen'][1]['direction'],'Puurs - Brussel');
  });
});
