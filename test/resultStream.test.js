const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const util = require('util');
const del = require('del');

const readFile = util.promisify(fs.readFile);
const exec = util.promisify(cp.exec);

jest.setTimeout(60000);

afterEach(async () => {
  await del(['test/sample-feed/linkedConnections*']);
});

describe('Testing whether result contains certain objects (regression tests)', () => {

  const lcstreamToArray = async (options, file) => {
    await exec(`./bin/gtfs2lc.js -s -f ${options['format'] || 'json'} -S ${options['store'] || 'MemStore'} --fresh ./test/sample-feed > ./test/sample-feed/${file}`);
    const data = await readFile(`./test/sample-feed/${file}`, 'utf8');
    return data.split('\n');
  };

  //This will be the first element when sorted correctly
  it('Stream should contain a first connection with arrivalStop AMV', async () => {
    const connections = await lcstreamToArray({}, 'result.json');
    expect(JSON.parse(connections[0])['arrivalStop']['stop_id']).toBe('AMV');
  });

  it('JSON-LD Stream should contain Connections and use LevelStore for data storage', async () => {
    const triples = await lcstreamToArray({
      format: 'jsonld',
      store: 'LevelStore'
    }, 'result.jsonld');
    expect(JSON.parse(triples[1])['@type']).toBe('Connection');
  });

  it('RDF Stream should contain Connections in turtle format', async () => {
    const triples = await lcstreamToArray({
      format: 'turtle',
      store: 'MemStore'
    }, 'turtle.ttl');
    expect(triples[4].includes('a lc:Connection')).toBeTruthy();
  });

  it('RDF Stream should be produced from feed without calendar.txt', async () => {
    // Hide calendar.txt for this test
    fs.renameSync('./test/sample-feed/calendar.txt', './test/sample-feed/calendar.txt.bkp');
    const triples = await lcstreamToArray({
      format: 'turtle',
      store: 'MemStore'
    }, 'turtle.ttl');
    fs.renameSync('./test/sample-feed/calendar.txt.bkp', './test/sample-feed/calendar.txt');
    expect(triples[4].includes('a lc:Connection')).toBeTruthy();
  });
});
