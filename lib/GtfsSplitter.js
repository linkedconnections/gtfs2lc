const { Writable } = require('stream');
const fs = require('fs');
const numCPUs = require('os').cpus().length;

class GtfsSplitter extends Writable {

    constructor(path, fragmentBy, fragmentIndex) {
        super({ objectMode: true });
        this._path = path;
        this._fragmentBy = fragmentBy;
        this._fragmentIndex = fragmentIndex;
        this._currentTrip = null;
        this._currentFragment = -1;
        this._coreFragments = this.getCoreFragments();
        fs.mkdirSync(this._path + '/tmp');
    }

    async _write(data, encoding, done) {
        if (this._fragmentBy && this._fragmentIndex) {
            this.customFragmetation(data, done);
        } else {
            this.defaultFragmentation(data, done);
        }
    }

    customFragmetation(data, done) {
        if (data['trip_id'] && data['trip_id'] !== null && data['trip_id'] != '') {
            if (this._currentTrip === null || data['trip_id'] != this._currentTrip) {
                this._currentTrip = data['trip_id'];
                this._currentFragment = this._fragmentIndex.get(data[this._fragmentBy]);

                if (!fs.existsSync(this._path + '/tmp/' + this._currentFragment + '.txt')) {
                    let headers = Object.keys(data);
                    let header = headers.join(',');
                    fs.appendFileSync(this._path + '/tmp/' + this._currentFragment + '.txt', header + '\n', 'utf8');
                }
            }

            let values = Object.values(data);
            let line = values.join(',');;
            fs.appendFile(this._path + '/tmp/' + this._currentFragment + '.txt', line + '\n', 'utf8', err => {
                if (!err) {
                    done();
                }
            });
        } else {
            done();
        }
    }

    defaultFragmentation(data, done) {
        if (data['trip_id'] && data['trip_id'] !== null && data['trip_id'] != '') {
            if (this._currentTrip === null || data['trip_id'] != this._currentTrip) {
                this._currentTrip = data['trip_id'];

                if(this._currentFragment >= 0 && this._currentFragment < this._coreFragments.length - 1) {
                    this._currentFragment ++;
                } else {
                    this._currentFragment = 0;
                }
                
                if (!fs.existsSync(this._path + '/tmp/' + this._currentFragment + '.txt')) {
                    let headers = Object.keys(data);
                    let header = headers.join(',');
                    fs.appendFileSync(this._path + '/tmp/' + this._currentFragment + '.txt', header + '\n', 'utf8');
                }
            }

            let values = Object.values(data);
            let line = values.join(',');;
            fs.appendFile(this._path + '/tmp/' + this._currentFragment + '.txt', line + '\n', 'utf8', err => {
                if (!err) {
                    done();
                }
            });
        } else {
            done();
        }
    }

    getCoreFragments() {
        let cf = [];
        for(let i = 0; i < numCPUs; i ++) {
            cf.push(i);
        }

        return cf;
    }
}

module.exports = GtfsSplitter;