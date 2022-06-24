const c2csv = require('../lib/Connections2CSV');
const fs = require('fs');
const util = require('util');
const del = require('del');
const { exec } = require('child_process');
const { Readable } = require('stream');

const readFile = util.promisify(fs.readFile);

beforeAll(async () => {
    await doBasicParsing();
});

afterAll(async () => {
    await del(['test/sample-feed/linkedConnections.json']);
});

test('Convert connections to csv', async () => {
    let csvCxs = await stream2Array(new c2csv());
    expect(csvCxs.length).toBeGreaterThan(0);
    expect(csvCxs[0].split(',').length).toBe(7);
});

function doBasicParsing() {
    return new Promise((resolve, reject) => {
        exec(`./bin/gtfs2lc.js -t -s --fresh test/sample-feed > test/sample-feed/formats.json`,
            async (err, stdout, stderr) => {
                if (err) {
                    reject(stderr);
                } else {
                    resolve();
                }
            });
    });
}

async function* connGenerator() {
    let conns = (await readFile('test/sample-feed/formats.json', 'utf8')).split('\n');
    for (const c of conns) {
        try {
            let jcx = JSON.parse(c);
            jcx['departureTime'] = new Date(jcx['departureTime']);
            jcx['arrivalTime'] = new Date(jcx['arrivalTime']);
            yield jcx;
        } catch (err) {
            console.error(err);
        }
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
