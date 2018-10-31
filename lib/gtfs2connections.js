const csv = require('fast-csv');
const Services = require('./services/calendar.js');
const DateInterval = require('./DateInterval.js');
const Store = require('./stores/Store.js');
const ClusterHandler = require('./ClusterHandler.js');
const util = require('util');
const fs = require('fs');
const child_process = require('child_process');

const GtfsSplitter = require('./GtfsSplitter.js');
const del = require('del');

const exec = util.promisify(child_process.exec);

class Mapper {

  constructor(path, options) {
    this._path = path.endsWith('/') ? path.slice(0, -1) : path;
    this._options = options;
    this.options.interval = new DateInterval(options.startDate, options.endDate);
    this._stopsdb = null;
    this._routesdb = null;
    this._tripsdb = null;
    this._servicesdb = null;

    if (!this.options.store) {
      this.options.store = 'MemStore';
    }
  }

  /**
  * Returns a set of resultStreams for connections according to De Lijn defined zones on their API (http://data.delijn.be) 
  * Step 1: Create an index of stops, routes, trips and services, and pipe them towards a leveldb to be used later.
  * Step 2: Create an index for all the stops according to the zone they belong to.
  * Step 3: Fragment the stop_times.txt file according to the defined zones.
  * Step 4: Read each created file for every zone and pipe them to something that expands everything into connections and returns this stream.
  */

  map() {
    return new Promise(async (resolve, reject) => {
      try {
        // Steps 1 and 2
        let stream_promises = [
          this.createDBFromGtfs('stops', 'stop_id'),
          this.createDBFromGtfs('routes', 'route_id'),
          this.createDBFromGtfs('trips', 'trip_id'),
          this.createServicesDB(),
        ];

        let indexes = await Promise.all(stream_promises);

        this._stopsdb = indexes[0];
        this._routesdb = indexes[1];
        this._tripsdb = indexes[2];
        this._servicesdb = indexes[3];

        // Step 3
        fs.createReadStream(this._path + '/stop_times.txt', { encoding: 'utf8', objectMode: true })
          .pipe(csv({ objectMode: true, headers: true }))
          .pipe(new GtfsSplitter(this._path, this.options.fragmentBy, this.options.fragmentIndex))
          .on('error', e => {
            reject(e);
          })
          .on('finish', async () => {
            // Step 4
            resolve(await this.clusterizeProcess());
          });
      } catch (err) {
        console.error(err);
        reject(err);
      }
    });
  }

  clusterizeProcess() {
    return new Promise((resolve, reject) => {
      let cluster = ClusterHandler.init();

      cluster.on('end', async refs => {
        let files = [];
        let format = refs[0].format ? '.' + refs[0].format : '.json';
        if (refs[0].format === 'turlte') {
          format = '.ttl';
        }
        if (refs[0].format === 'ntriples') {
          format = '.n3';
        }

        await Promise.all(refs.map(async ref => {
          

          files.push(ref.path + ref.name + format);
        }));

        if (this.options.fragmentBy && this.options.fragmentIndex) {
          resolve(files);
        } else {
          let unifiedFile = refs[0].path + 'lc' + format;
          await exec('cat ' + files.join(' ') + ' > ' + unifiedFile);
          resolve([unifiedFile]);
          files.forEach(file => {
            del([file], { force: true });
          });
        }

        this.close();
      });

      let params = {
        path: this._path,
        store: this.options.store,
        format: this.options.format,
        baseUris: this.options.baseUris,
        stopsdb: this._stopsdb,
        routesdb: this._routesdb,
        tripsdb: this._tripsdb,
        servicesdb: this._servicesdb
      };

      ClusterHandler.execute(params);
    });
  }

  createDBFromGtfs(fileName, indexKey) {
    return new Promise((resolve, reject) => {
      let db = Store(this.options.store, this._path + '/.' + fileName);

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

      let servicesdb = Store(this.options.store, this._path + '/.services');
      let services = fs.createReadStream(this._path + '/calendar.txt', { encoding: 'utf8', objectMode: true })
        .pipe(csv({ objectMode: true, headers: true }))
        .pipe(new Services(calendarDates, this.options))
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

  close() {
    return del([
      this._path + '/tmp',
      this._path + '/.routes',
      this._path + '/.trips',
      this._path + '/.services',
      this._path + '/.stops'
    ], { force: true });
  }

  get options() {
    return this._options;
  }
}

module.exports = Mapper;
