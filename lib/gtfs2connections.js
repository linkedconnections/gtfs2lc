var csv = require('fast-csv'),
    ConnectionRules = require('./stoptimes/st2c.js'),
    ConnectionsBuilder = require('./ConnectionsBuilder.js'),
    Services = require('./services/calendar.js'),
    DateInterval = require('./DateInterval.js');
    through2 = require('through2'),
    level = require('level'),
    moment = require('moment'),
    fs = require('fs');

var Mapper = function (options) {
  this._options = options;
  this._options.interval = new DateInterval(options.startDate, options.endDate);
};

/**
 * Returns a resultStream for connections
 * Step 1: Convert calendar_dates.txt and calendar.txt to service ids mapped to a long list of dates
 * Step 2: Pipe these services towards a leveldb: we want to use them later.
 * Step 3: also index trips.txt in a leveldb on key trip_id
 * Step 4: create a stream of connection rules from stop_times.txt
 * Step 5: pipe this stream to something that expands everything into connections and returns this stream.
 * Caveat: coding this with numerous callbacks and streams, makes this code not chronologically ordered.
 */ 
Mapper.prototype.resultStream = function (path, done) {
  var trips = fs.createReadStream(path + '/trips.txt', {encoding:'utf8', objectMode: true}).pipe(csv({objectMode:true,headers: true}));
  var calendarDates = fs.createReadStream(path + '/calendar_dates.txt', {encoding:'utf8', objectMode: true}).pipe(csv({objectMode:true,headers: true}));
  var services = fs.createReadStream(path + '/calendar.txt', {encoding:'utf8', objectMode: true}).pipe(csv({objectMode:true,headers: true})).pipe(new Services(calendarDates, this._options));
  //Preparations for step 4
  var connectionRules = fs.createReadStream(path + '/stop_times.txt', {encoding:'utf8', objectMode: true}).pipe(csv({objectMode:true,headers: true})).pipe(new ConnectionRules());

  //Step 2 & 3: store in leveldb in 2 hidden directories
  var tripsdb = level(path + '/.trips');
  var servicesdb = level(path + '/.services');
  var count = 0;
  var finished = function () {
    count ++;
    //wait for the 2 streams to finish (services and trips) to write to the stores
    if (count === 2) {
      console.error("Indexing services and trips succesful!");
      //Step 4 and 5: let's create our connections!
      done(connectionRules.pipe(new ConnectionsBuilder(tripsdb, servicesdb, this._options)));
    }
  };
  
  services.pipe(through2.obj(function (service, encoding, doneService) {
    servicesdb.put(service['service_id'], service['dates'], {valueEncoding: 'json'}, doneService);
  })).on('finish', finished);

  trips.pipe(through2.obj(function (trip, encoding, doneTrip) {
    tripsdb.put(trip['trip_id'], trip, {valueEncoding: 'json'}, doneTrip);
  })).on('finish', finished);
  
};

module.exports = Mapper;
