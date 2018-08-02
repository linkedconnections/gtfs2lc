const csv = require('fast-csv');
const ConnectionRules = require('./stoptimes/st2c.js');
const ConnectionsBuilder = require('./ConnectionsBuilder.js');
const Services = require('./services/calendar.js');
const DateInterval = require('./DateInterval.js');
const Store = require('./stores/Store.js');
const util = require('util');
const fs = require('fs');
const child_process = require('child_process');
const DelijnAPIClient = require('./DelijnAPIClient.js');
const GtfsSplitter = require('./GtfsSplitter.js');
const del = require('del');

const exec = util.promisify(child_process.exec);

class Mapper {

  constructor(path, options) {
    this._path = path;
    this._options = options;
    this._options.interval = new DateInterval(options.startDate, options.endDate);
    this._dac = new DelijnAPIClient();
    this._routesdb = null;
    this._tripsdb = null;
    this._servicesdb = null;
    this._stopsdb = null;

    if (!this._options.store) {
      this._options.store = 'MemStore';
    }
  }

  /**
  * Returns a set of resultStreams for connections according to De Lijn defined zones on their API (http://data.delijn.be) 
  * Step 1: Create an index of stops, routes, trips and services, and pipe them towards a leveldb to be used later.
  * Step 2: Create an index for all the stops according to the zone they belong to.
  * Step 3: Fragment the stop_times.txt file according to the defined zones.
  * Step 4: Read each created file for every zone and pipe them to something that expands everything into connections and returns this stream.
  */

  getConnectionsByZones() {
    return new Promise(async (resolve, reject) => {
      try {
        // Steps 1 and 2
        let zones = ((await this._dac.getZones())['entiteiten']).map(z => [z['entiteitnummer'], z['omschrijving']]);
        let stream_promises = [
          this.createDBFromGtfs('stops', 'stop_id'),
          this.createDBFromGtfs('routes', 'route_id'),
          this.createDBFromGtfs('trips', 'trip_id'),
          this.createServicesDB(),
          this.createDeLijnZoneIndex(zones)
        ];

        let indexes = await Promise.all(stream_promises);

        this._stopsdb = indexes[0];
        this._routesdb = indexes[1];
        this._tripsdb = indexes[2];
        this._servicesdb = indexes[3];
        let stopsIndex = indexes[4];

        // Step 3
        fs.createReadStream(this._path + '/stop_times.txt', { encoding: 'utf8', objectMode: true })
          .pipe(csv({ objectMode: true, headers: true }))
          .pipe(new GtfsSplitter(this._path, this._stopsdb, stopsIndex))
          .on('error', e => {
            reject(e);
          })
          .on('finish', async () => {
            // Step 4
            let connStreams = {};
            await Promise.all(zones.map(async zone => {
              connStreams[zone[1]] = this.resultStream(this._path + '/tmp/' + zone[1] + '.txt', zone[1]);
            }));
            resolve(connStreams);
          });
      } catch (err) {
        reject(err);
      }
    });
  }

  createDBFromGtfs(fileName, indexKey) {
    return new Promise((resolve, reject) => {
      let db = Store(this._path + '/.' + fileName, this._options.store);

      fs.createReadStream(this._path + '/' + fileName + '.txt', { encoding: 'utf8', objectMode: true })
        .pipe(csv({ objectMode: true, headers: true }))
        .on('error', e => {
          reject(e);
        })
        .on('data', data => {
          if (data[indexKey]) {
            db.put(data[indexKey], data);
          }
        })
        .on('end', () => {
          resolve(db);
        });
    });
  }

  async createServicesDB() {
    return new Promise(async (resolve, reject) => {
      let calendarDates = fs.createReadStream(this._path + '/calendar_dates.txt', { encoding: 'utf8', objectMode: true })
        .pipe(csv({ objectMode: true, headers: true }))
        .on('error', e => {
          reject(e);
        });

      // Create empty calendar.txt file in case it does not exist in the GTFS datasource 
      if (!fs.existsSync(this._path + '/calendar.txt')) {
        await exec('touch ' + this._path + '/calendar.txt');
      }

      let servicesdb = Store(this._path + '/.services', this._options.store);
      let services = fs.createReadStream(this._path + '/calendar.txt', { encoding: 'utf8', objectMode: true })
        .pipe(csv({ objectMode: true, headers: true }))
        .pipe(new Services(calendarDates, this._options))
        .on('error', e => {
          reject(e);
        })
        .on('data', service => {
          if (service['service_id']) {
            servicesdb.put(service['service_id'], service['dates']);
          }
        })
        .on('finish', () => {
          resolve(servicesdb);
        });
    });
  }

  async createDeLijnZoneIndex(zones) {
    let stopsIndex = new Map();

    await Promise.all(zones.map(async zone => {
      let haltes = (await this._dac.getStopsByZone(zone[0]))['haltes'];
      for (let h in haltes) {
        stopsIndex.set(haltes[h]['haltenummer'], zone[1]);
      }
    }));

    return stopsIndex;
  }

  resultStream(path, zone) {
    let connections = fs.createReadStream(path, { encoding: 'utf8', objectMode: true })
      .pipe(csv({ objectMode: true, headers: true }))
      .pipe(new ConnectionRules(this._stopsdb))
      .pipe(new ConnectionsBuilder(this._tripsdb, this._servicesdb, this._routesdb, zone))
      .on('error', e => {
        console.error(e);
      });

    return connections;
  }

  close() {
    return del([
      this._path + 'tmp',
      this._path + '.routes',
      this._path + '.trips',
      this._path + '.services',
      this._path + '.stops'
    ], { force: true });
  }
}

module.exports = Mapper;
