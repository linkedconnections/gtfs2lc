var csv = require('csv');
var unzip = require('unzip');
var q = require('q');

var StopsTransformer = require('./gtfs/StopsTransformer.js');
var AgenciesTransformer = require('./gtfs/AgenciesTransformer.js');
var RoutesTransformer = require('./gtfs/RoutesTransformer.js');
var TripsTransformer = require('./gtfs/TripsTransformer.js');
var StopTimesTransformer = require('./gtfs/StopTimesTransformer.js');
var CalendarTransformer = require('./gtfs/CalendarTransformer.js');
var CalendarDatesTransformer = require('./gtfs/CalendarDatesTransformer.js');
var FeedInfoTransformer = require('./gtfs/FeedInfoTransformer.js');
var FareAttributesTransformer = require('./gtfs/FareAttributesTransformer.js');
var FareRulesTransformer = require('./gtfs/FareRulesTransformer.js');
var ShapesTransformer = require('./gtfs/ShapesTransformer.js');
var FrequenciesTransformer = require('./gtfs/FrequenciesTransformer.js');
var TransfersTransformer = require('./gtfs/TransfersTransformer.js');

var GTFSStore = require('./GTFSStore.js');
var ArrivalDepartureStore = require('./ArrivalDepartureStore.js');
var GTFSJSON2ArrDep = require('./GTFSJSON2ArrDep.js');
var ArrDep2Connections = require('./ArrDep2Connections.js');

/**
 * @param zipstream is an fstream configured with a to be read GTFS+CSV/ZIP
 */
var Mapper = function (options) {
  this._options = options;
};

Mapper.prototype.promiseConnectionsStream = function (zipstream) {
  var self = this;
  return this.getStoreFromGTFSZIPStream(zipstream).then(function (store) {
    console.error("Transforming GTFS store to arrival/departures");
    return self.getArrDepFromGTFSStore(store).then(function (arrdepStore) {
      console.error("Transforming arrival/departures to connections");
      var connectionsStream = new ArrDep2Connections(arrdepStore.arrivals.createReadStream());
      arrdepStore.departures.createReadStream().pipe(connectionsStream);
      //return arrdepStore.arrivals.createReadStream();
      return connectionsStream;
    });
    
  }).fail(function (err) {
    console.error(err);
  });
};

Mapper.prototype.getArrDepFromGTFSStore = function (store) {
  var arrdepStore = new ArrivalDepartureStore();
  //now process what we've loaded into memory/leveldb, let's convert it to arrivals and departures
  var deferred = q.defer();
  var gtfsjson2arrdep = new GTFSJSON2ArrDep(store);
  var dateStream = store.dates.createReadStream();
  dateStream.pipe(gtfsjson2arrdep);
  gtfsjson2arrdep.pipe(arrdepStore);
  //Wait for everything to finish, then resolve the arrival/departure store
  arrdepStore.on("finish", function () {
    deferred.resolve(arrdepStore);
    debugger;
  });
  return deferred.promise;
};

Mapper.prototype.getStoreFromGTFSZIPStream = function (zipstream) {
  var deferred = q.defer();
  var options = this._options;
  var store = new GTFSStore();
  //Process the zipstream
  zipstream.pipe(unzip.Parse())
    .on('entry', function (entry) {
      var fileName = entry.path;
      var type = entry.type; // 'Directory' or 'File'
      var size = entry.size;
      var transform;
      if (fileName === "stops.txt") {
        console.error("Draining Stops");
        entry.autodrain();
      } else if (fileName === "agency.txt") {
        console.error("Draining Agencies");
        entry.autodrain();
        //transform = new AgenciesTransformer(options);
        //entry.pipe(csv.parse({'columns' : true }))
        //  .pipe(transform)
        //  .pipe(store);
      } else if (fileName === "routes.txt") {
        console.error("Transforming Routes");
        transform = new RoutesTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "trips.txt") {
        console.error("Transforming Trips");
        //TODO: this is actually not always the last one :(
        transform = new TripsTransformer(options, true);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "stop_times.txt") {
        console.error("Transforming Stop Times");
        transform = new StopTimesTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "calendar.txt") {
        console.error("Transforming Calendar");
        transform = new CalendarTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "calendar_dates.txt") {
        console.error("Transforming CalendarDates");
        transform = new CalendarDatesTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "fare_attributes.txt") {
        console.error("Draining FareAttributes");
        entry.autodrain();
      } else if (fileName === "fare_rules.txt") {
        console.error("Draining FareRules");
        entry.autodrain();
      } else if (fileName === "shapes.txt") {
        console.error("Draining Shapes and Shape Segments");
        entry.autodrain();
      } else if (fileName === "frequencies.txt") {
        console.error("Transforming Frequencies");
        transform = new FrequenciesTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "transfers.txt") {
        console.error("Transforming Transfers");
        transform = new TransfersTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else if (fileName === "feed_info.txt") {
        console.error("Transforming Feed info");
        transform = new FeedInfoTransformer(options);
        entry.pipe(csv.parse({'columns' : true }))
          .pipe(transform)
          .pipe(store);
      } else {
        console.error("draining " + fileName);
        entry.autodrain();
      }
    });

  //when finished with saving data to disk, resolve the promise
  store.on("finish", function () {
    debugger;
    deferred.resolve(store);
  });
  return deferred.promise;
};

module.exports = Mapper;
