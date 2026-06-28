const { Transform } = require("stream");

class Connections2CSV extends Transform {
  constructor(header) {
    super({ objectMode: true });
    this._headerStreamed = false;
    if (!header) {
      this.headerStreamed = true;
    }
  }

  _transform(connection, encoding, done) {
    if (!this.headerStreamed) {
      this.headerStreamed = true;
      this.push(
        '"departureStop","departureTime","arrivalStop","arrivalTime","trip","route","headsign"\n',
      );
    }
    const values = [
      connection.departureStop.stop_id,
      connection.departureTime.toISOString(),
      connection.arrivalStop.stop_id,
      connection.arrivalTime.toISOString(),
      connection.trip.trip_id,
      connection.route.route_id,
      connection.headsign || "",
    ];
    done(null, `${values.map(csvCell).join(",")}\n`);
  }

  get headerStreamed() {
    return this._headerStreamed;
  }

  set headerStreamed(value) {
    this._headerStreamed = value;
  }
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

module.exports = Connections2CSV;
