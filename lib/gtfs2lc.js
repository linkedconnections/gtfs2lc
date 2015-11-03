var csv = require('fast-csv');
var unzip = require('unzip');
var q = require('q');
var GTFSStore = require('./GTFSStore.js');
var ArrivalDepartureStore = require('./ArrivalDepartureStore.js');
var GTFSJSON2ArrDep = require('./GTFSJSON2ArrDep.js');
var ArrDep2Connections = require('./ArrDep2Connections.js');

var Mapper = function (options) {
  this._options = options;
};

Mapper.prototype.promiseConnectionsStream = function (txtstreams) {
  var self = this;
  //First, store the GTFS files we need in a level store
  return this.getStoreFromGTFSFiles(txtstreams).then(function (store) {
    //Then, transform this GTFS store into arrivals/departures
    console.error("Transforming GTFS store to arrival/departures");
    return self.getArrDepFromGTFSStore(store).then(function (arrdepStore) {
      //Finally, transform these arrivals/departures to connections
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

Mapper.prototype.getStoreFromGTFSFiles = function (txtstreams) {
  var deferred = q.defer();
  var options = this._options;
  var store = new GTFSStore();
  //Process the different text streams that we need
  var transform;
    console.error("Transforming Routes");
    /**
     * TODO: parse:
     * routes
     * trips
     * stop_times
     * calendar
     * calendar_dates
     * Frequencies
     * transfers
     * stops
     * feed_info
     */
  csv.parse({'columns' : true }))
});

//when finished with saving data to disk, resolve the promise
store.on("finish", function () {
  debugger;
  deferred.resolve(store);
});
  return deferred.promise;
};

module.exports = Mapper;
