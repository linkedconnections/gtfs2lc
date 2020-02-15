const assert = require('assert');
const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');

const readFile = util.promisify(fs.readFile);

jest.setTimeout(60000);

describe('Testing whether result contains certain objects (regression tests)', () => {

  var doGtfsSort = () => {
    return new Promise((resolve, reject) => {
      exec(`./bin/gtfs2lc-sort.sh test/sample-feed`, (err, stdout, stderr) => {
        if (err) {
          reject(stderr);
        } else {
          resolve();
        }
      });
    });
  };

  var lcstreamToArray = (options, file) => {
    return new Promise((resolve, reject) => {
      exec(`./bin/gtfs2lc.js -s -f ${options['format']} -S ${options['store']} test/sample-feed > test/sample-feed/${file}`,
        async (err, stdout, stderr) => {
          if (err) {
            reject(stderr);
          } else {
            resolve((await readFile(`./test/sample-feed/${file}`, 'utf8')).split('\n'))
          }
        });
    });
  };

  var connections;
  //This will be the first element when sorted correctly
  it('Stream should contain a first connection with arrivalStop AMV', async () => {
      await doGtfsSort();
      connections = await lcstreamToArray({}, 'result.json');
      assert.equal(JSON.parse(connections[0])['arrivalStop'], 'AMV');
  });

  it('JSON-LD Stream should contain Connections and use KeyvStore for data storage', async () => {
    await doGtfsSort();
    var triples = await lcstreamToArray({
      format: 'jsonld',
      store: 'KeyvStore'
    }, 'result.jsonld');
    assert.equal(JSON.parse(triples[1])['@type'], 'Connection');
  });

  it('RDF Stream should contain Connections in turtle format', async () => {
    await doGtfsSort();
    var triples = await lcstreamToArray({
      format: 'turtle',
      store: 'MemStore'
    }, 'turtle.ttl');
    assert.equal(triples[4].includes('a lc:Connection'), true);
  });
});
