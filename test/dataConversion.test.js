const c2csv = require('../lib/Connections2CSV');
const fs = require('fs');
const util = require('util');
const del = require('del');
const cp = require('child_process');
const { Readable } = require('stream');

const readFile = util.promisify(fs.readFile);
const exec = util.promisify(cp.exec);

beforeAll(async () => {
    await exec(`./bin/gtfs2lc.js -s --fresh test/sample-feed > test/sample-feed/formats.json`);
});

afterAll(async () => {
    await del(['test/sample-feed/linkedConnections.json']);
});

test('Convert connections to csv', async () => {
    let csvCxs = await stream2Array(new c2csv());
    expect(csvCxs.length).toBeGreaterThan(0);
    expect(csvCxs[0].split(',').length).toBe(7);
});

async function* connGenerator() {
    const conns = (await readFile('test/sample-feed/formats.json', 'utf8')).split('\n');
    for (const c of conns) {
        if (c === '') continue;
        let jcx = JSON.parse(c);
        jcx['departureTime'] = new Date(jcx['departureTime']);
        jcx['arrivalTime'] = new Date(jcx['arrivalTime']);
        yield jcx;
    }
}

function stream2Array(stream) {
    return new Promise((resolve, reject) => {
        let array = [];
        Readable.from(connGenerator()).pipe(stream)
            .on('data', data => {
                array.push(data);
            })
            .on('end', () => {
                resolve(array);
            });
    });
}
