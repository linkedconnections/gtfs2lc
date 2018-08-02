const { Writable } = require('stream');
const fs = require('fs');

class GtfsSplitter extends Writable {

    constructor(path, stopsdb, stopsIndex) {
        super({ objectMode: true });
        this._path = path;
        this._stopsdb = stopsdb;
        this._stopsIndex = stopsIndex;
        this._currentTrip = null;
        this._currentZone = null;
        fs.mkdirSync(this._path + '/tmp');
    }

    async _write(data, encoding, done) {
        if (data['trip_id'] && data['trip_id'] !== null && data['trip_id'] != '') {
            if (this._currentTrip === null || data['trip_id'] != this._currentTrip) {
                this._currentTrip = data['trip_id'];
                this._currentZone = await this.getZone(data['stop_id']);

                if(!fs.existsSync(this._path + '/tmp/' + this._currentZone + '.txt')) {
                    let header = '';
                    let headers = Object.keys(data);
                    for(let h in headers) {
                        header += headers[h] + ',';
                    }

                    header = header.slice(0, -1);
                    fs.appendFileSync(this._path + '/tmp/' + this._currentZone + '.txt', header + '\n', 'utf8');
                }
            }

            let keys = Object.keys(data);
            let line = '';

            for(let k in keys) {
                line += data[keys[k]] + ',';
            }

            line = line.slice(0, -1);
            fs.appendFile(this._path + '/tmp/' + this._currentZone + '.txt', line + '\n', 'utf8', err => {
                if (!err) {
                    done();
                }
            });
        } else {
            done();
        }
    }

    async getZone(stopId) {
        if (stopId) {
            let stopCode = (await this._stopsdb.get(stopId))['stop_code'];
            return this._stopsIndex.get(stopCode);
        }
    }
}

module.exports = GtfsSplitter;