const csv = require('fast-csv'),
      ConnectionsBuilder = require('./ConnectionsBuilder.js'),
      Services = require('./services/calendar.js'),
      DateInterval = require('./DateInterval.js'),
      Store = require('./stores/Store.js'),
      {AsyncIterator} = require('asynciterator'),
      moment = require('moment'),
      fs = require('fs');

var Mapper = function (options) {
  this._options = options;
  this._options.interval = new DateInterval(options.startDate, options.endDate);
  if (!this._options.store) {
    this._options.store = 'MemStore';
  }
};

/**
* Returns a resultStream for connections
* Step 1: Convert calendar_dates.txt and calendar.txt to service ids mapped to a long list of dates
* Step 2: Pipe these services towards a leveldb: we want to use them later.
* Step 3: also index routes.txt and trips.txt in a leveldb on key trip_id
* Step 4: create a stream of connection rules from stop_times.txt
* Step 5: pipe this stream to something that expands everything into connections and returns this stream.
* Caveat: coding this with numerous callbacks and streams, makes this code not chronologically ordered.
*/
Mapper.prototype.resultStream = function (path, done) {
  var routes = fs.createReadStream(path + '/routes.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).on('error', function (e) {
    console.error(e);
  });

  var trips = fs.createReadStream(path + '/trips.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).on('error', function (e) {
    console.error(e);
  });
  var calendarDates = fs.createReadStream(path + '/calendar_dates.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).on('error', function (e) {
    console.error(e);
  });
  var services = fs.createReadStream(path + '/calendar.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).pipe(new Services(calendarDates, this._options)).on('error', function (e) {
    console.error(e);
  });
  //Preparations for step 4
  //Step 2 & 3: store in leveldb in 3 hidden directories, or in memory, depending on the options
  var routesdb = Store(path + '/.routes', this._options.store);
  var tripsdb = Store(path + '/.trips', this._options.store);
  var servicesdb = Store(path + '/.services', this._options.store);
  var count = 0;
  var options = this._options;
  var finished = function () {
    count++;
    //wait for the 3 streams to finish (services, trips and routes) to write to the stores
    if (count === 3) {
      console.error("Indexing services and trips succesful!");
      //Step 4 and 5: let's create our connections!
      var connectionRules = fs.createReadStream(path + '/connections.txt', { encoding: 'utf8', objectMode: true }).pipe(csv({ objectMode: true, headers: true })).on('error', function (e) {
        console.error('Hint: Did you run gtfs2lc-sort?');
        console.error(e);
      });
      let connectionsBuilder = new ConnectionsBuilder(tripsdb, servicesdb, routesdb, options);
      let connectionsStream = connectionRules.pipe(connectionsBuilder);
      done(connectionsStream);
    }
  };

  var servicesIterator = AsyncIterator.wrap(services);
  var tripsIterator = AsyncIterator.wrap(trips);
  var routesIterator = AsyncIterator.wrap(routes);
  
  servicesIterator.transform((service, doneService) =>{
    if (service['service_id']) {
      servicesdb.put(service['service_id'], service['dates'], doneService);
    } else {
      doneService();
    }
  }).on('data', () => {
  }).on('error', function (e) {
    console.error(e);
  }).on('end', finished);

  tripsIterator.transform((trip, doneTrip) => {
    if (trip['trip_id']) {
      tripsdb.put(trip['trip_id'], trip, doneTrip);
    } else {
      doneTrip();
    }
  }).on('data', () => {
  }).on('error', function (e) {
    console.error(e);
  }).on('end', finished);

  routesIterator.transform((route, doneRoute) => {
    if (route['route_id']) {
      routesdb.put(route['route_id'], route, doneRoute);
    } else {
      doneRoute();
    }
  }).on('data', () => {
  }).on('error', function (e) {
    console.error(e);
  }).on('end', finished);
};

module.exports = Mapper;
