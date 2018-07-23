var csv = require('fast-csv'),
  ConnectionRules = require('./stoptimes/st2c.js'),
  ConnectionsBuilder = require('./ConnectionsBuilder.js'),
  Services = require('./services/calendar.js'),
  DateInterval = require('./DateInterval.js'),
  Store = require('./stores/Store.js'),
  through2 = require('through2'),
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
  var routes = fs.createReadStream(path + '/routes.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).on('error', function (e) {
    console.error(e);
  });

  var trips = fs.createReadStream(path + '/trips.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).on('error', function (e) {
    console.error(e);
  });

  var calendarDates = fs.createReadStream(path + '/calendar_dates.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).on('error', function (e) {
    console.error(e);
  });

  var services = fs.createReadStream(path + '/calendar.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).pipe(new Services(calendarDates, this._options)).on('error', function (e) {
    console.error(e);
  });

// stopTimeOverrides contains platform information
  var stopTimesOverrides = fs.createReadStream(path + '/stop_time_overrides.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).on('error', function (e) {
    console.error(e);
  });

// stops links stop ids to platform and station readable names
  var stops = fs.createReadStream(path + '/stops.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).on('error', function (e) {
    console.error(e);
  });

//Preparations for step 4
  var connectionRules = fs.createReadStream(path + '/stop_times.txt', {encoding: 'utf8', objectMode: true}).pipe(csv({objectMode: true, headers: true})).pipe(new ConnectionRules()).on('error', function (e) {
    console.error(e);
  });

//Step 2 & 3: store in leveldb in 3 hidden directories, or in memory, depending on the options
  var routesdb = Store(path + '/.routes', this._options.store);
  var tripsdb = Store(path + '/.trips', this._options.store);
  var servicesdb = Store(path + '/.services', this._options.store);
  var stopsdb = Store(path + '/.stops', this._options.store);
  var stoptimeoverridesdb = Store(path + '/.stoptimeoverrides', this._options.store);
  var count = 0;
  var self = this;

  var finished = function () {
    count++;
    //wait for the 5 streams to finish (services and trips) to write to the stores
    if (count === 5) {
      console.error("Indexing services and trips succesful!");
      //Step 4 and 5: let's create our connections!
      done(connectionRules.pipe(new ConnectionsBuilder(tripsdb, servicesdb, routesdb, stopsdb, stoptimeoverridesdb, self._options)));
    }
  };

  services.pipe(through2.obj(function (service, encoding, doneService) {
    if (service['service_id']) {
      servicesdb.put(service['service_id'], service['dates'], doneService);
    }
  })).on('error', function (e) {
    console.error(e);
  }).on('finish', finished);

  trips.pipe(through2.obj(function (trip, encoding, doneTrip) {
    if (trip['trip_id']) {
      tripsdb.put(trip['trip_id'], trip, doneTrip);
    }
  })).on('error', function (e) {
    console.error(e);
  }).on('finish', finished);


  routes.pipe(through2.obj(function (route, encoding, doneRoute) {
    if (route['route_id']) {
      routesdb.put(route['route_id'], route, doneRoute);
    }
  })).on('error', function (e) {
    console.error(e);
  }).on('finish', finished);

  stops.pipe(through2.obj(function (stop, encoding, doneStop) {
    if (stop['stop_id']) {
      stopsdb.put(stop['stop_id'].trim(), stop, doneStop);
    }
  })).on('error', function (e) {
    console.error(e);
  }).on('finish', finished);

  stopTimesOverrides.pipe(through2.obj(function (stoptimeoverride, encoding, doneOverride) {
    if (stoptimeoverride['trip_id'] && stoptimeoverride['stop_sequence']) {
      stoptimeoverridesdb.put(stoptimeoverride['trip_id'] + "#" + stoptimeoverride['service_id'] + "#" + stoptimeoverride['stop_sequence'], stoptimeoverride, doneOverride);
    }
  })).on('error', function (e) {
    console.error(e);
  }).on('finish', finished);

};

module.exports = Mapper;
