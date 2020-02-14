const { Transform } = require('stream');

class Connections2CSV extends Transform {
    constructor(header) {
        super({ objectMode: true });
        this._headerStreamed = false;
        if(!header) {
            this.headerStreamed = true;
        }
    }

    _transform(connection, encoding, done) {
        if (!this.headerStreamed) {
            this.headerStreamed = true;
            done(null, 'departureStop","departureTime","arrivalStop","arrivalTime","trip","route","headsign"\n');
        } else {
            let csv = connection["departureStop"] + ',' + connection["departureTime"].toISOString() + ',' 
                + connection["arrivalStop"] + ',' + connection["arrivalTime"].toISOString() + ',' + connection["trip"]["trip_id"] + ',' 
                + connection.trip.route.route_id + ',"' + connection.headsign + '"' + '\n';
            done(null, csv);
        }
    }

    get headerStreamed() {
        return this._headerStreamed;
    }

    set headerStreamed(value) {
        this._headerStreamed = value;
    }
}

module.exports = Connections2CSV;