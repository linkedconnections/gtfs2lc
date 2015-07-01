var Writable = require('stream').Writable,
    util = require('util'),
    level = require('level'),
    q = require('q');
/**
 * This stores a GTFS schedule info in memory and indexes it on a time basis: we assume the store is going to be addressed chronologically
 */
var Store = function () {
  Writable.call(this, {objectMode : true});
  //The json variable names can all be linked to the http://vocab.gtfs.org vocabulary
  this.feed_info = {};
  this.frequencies = {};
  //stop_times otherwise becomes impossible to load in memory
  this.stop_times = level("stop_times");
  this.trips = {};
  this.routes = {};
  this.transfer_rules = {};
  this.dates = level("dates");
  this.negativeDates = {}; //→ keeps dates that shouldn't taken into account in memory. After the processing, we're going to delete these service ids from this.dates
  this.firstDate = ""; //The first date stored
  this.lastDate = ""; //the last date stored
};

util.inherits(Store, Writable);

Store.prototype._write = function (data, encoding, done) {
  //in a first read we can create the right in-memory indices needed
  if (data["@type"] === "gtfs:Feed") {
    this.feed_info = data;
    done();
  } else if (data["@type"] === "gtfs:Route") {
    this.routes[data["@id"]] = data;
    done();
  } else if (data["@type"] === "gtfs:Trip") {
    //index trips by service id
    var serviceid = data["gtfs:service"];
    if (this.trips[serviceid]) {
      this.trips[serviceid].push(data);
    } else {
      this.trips[serviceid] = [data];
    }
    done();
  } else if (data["@type"] === "gtfs:StopTime") {
    //index by trip id
    var self = this;
    this.stop_times.get(data["gtfs:trip"], function (err, value) {
      if (err) {
        self.stop_times.put(data["gtfs:trip"], JSON.stringify(data), {sync:true},function (err) {
          if (err) {
            done(err);
          } else {
            done();
          }
        });
      } else if (value) {
        self.stop_times.put(data["gtfs:trip"], JSON.stringify(data) + "," + value,{sync:true}, function (err) {
          if (err) {
            done(err);
          } else {
            done();
          }
        });
      }
    });
  } else if (data["@type"] === "gtfs:Service") {
    //this service will only contain a partial description of the service rules
    var serviceRule = data["gtfs:serviceRule"];
    if (serviceRule["@type"].indexOf("gtfs:CalendarDateRule") > -1) {
      //process it by storing the mentioned date in the dates db
      if (serviceRule["gtfs:dateAddition"]) {
        //add it to dates
        var self = this;

        this.dates.get(serviceRule["dcterms:date"], function (err, value) {
          if (err) {
            self.dates.put(serviceRule["dcterms:date"], JSON.stringify(data["@id"]),{sync:true}, function (err) {
              if (err) {
                console.error(err, value);
              }
              done();
            });
          } else {
            self.dates.put(serviceRule["dcterms:date"], JSON.stringify(data["@id"]) + "," + value,{sync:true}, function (err) {
              if (err) {
                console.error(err);
              }
              done();
            });
          }
        });
      } else {
        //add it to the negative dates for explicitly deleting it from the schedule on that day
        if (this.negativeDates[serviceRule["dcterms:date"]]) {
          this.negativeDates[serviceRule["dcterms:date"]].push(data["@id"]);
        } else {
          this.negativeDates[serviceRule["dcterms:date"]] = [data["@id"]];
        }
        done();
      }
    } else if (serviceRule["@type"].indexOf("gtfs:CalendarRule") > -1) {
      //process the entire domain from start date to end date and add it to the this.dates variable
      var startDateString = serviceRule.startDate;
      var startDate = new Date(startDateString.substr(0,4), startDateString.substr(4,2)-1, startDateString.substr(6,2));
      var endDateString = serviceRule.endDate;
      var endDate = new Date(endDateString.substr(0,4), endDateString.substr(4,2)-1, endDateString.substr(6,2));
      //console.log(startDate,endDate);
      var dateItem = startDate;
      var promises = [];
      while (dateItem <= endDate) {
        var dateIndex = dateItem.toISOString().replace(/-/g,"").substr(0,8);
        if (serviceRule.weekdays[dateItem.getDay()]) {
          promises.push(this._storeDate(dateIndex, data["@id"]));
        }
        dateItem.setDate(dateItem.getDate()+1);
      }
      q.all(promises).then(function () {
        done();
      });
    }
  } else if (data["@type"] === "gtfs:Frequency") {
    this.frequencies[data["@id"]] = data;
    done();
  } else if (data["@type"] === "gtfs:TransferRule") {
    this.transfer_rules[data["@id"]] = data;
    done();
  } else {
    done("Unknown type encountered: " + data["@type"]);
  }
};

Store.prototype._storeDate = function (index, serviceid) {
  var self = this;
  var deferred = q.defer();
  serviceid = JSON.stringify(serviceid);
  this.dates.get(index, function (err, value) {
    if (!err) {
      serviceid = serviceid + ',' + value;
    }
    self.dates.put(index, serviceid, {sync:true},function (err) {
      if (err) {
        q.reject(err);
      } else {
        q.resolve();
      }
    });
  });
}

module.exports = Store;