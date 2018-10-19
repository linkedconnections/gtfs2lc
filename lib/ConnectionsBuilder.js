/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
    util = require('util'),
    moment = require('moment');

var ConnectionsBuilder = function (tripsdb, servicesdb, routesdb) {
  Transform.call(this, {objectMode : true});
  this._tripsdb = tripsdb;
  this._servicesdb = servicesdb;
  this._routesdb = routesdb;
};

util.inherits(ConnectionsBuilder, Transform);

ConnectionsBuilder.prototype._transform = function (connectionRule, encoding, done) {
  //Examples of
  // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
  // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }
  this.processConnectionRule(connectionRule, done);
};

ConnectionsBuilder.prototype.processConnectionRule = function (connectionRule, done) {
  var departureDFM = moment.duration(connectionRule['departure_dfm']);
  var arrivalDFM = moment.duration(connectionRule['arrival_dfm']);
  this._tripsdb.get(connectionRule['trip_id'], async (error, trip) => {
    if (!error) {
      this._routesdb.get(trip['route_id'], (error, route) => {
        if (!error) {          
          this._servicesdb.get(trip['service_id'], async (error, service) => {
            if (!error) {
              for (var i in service) {
                trip["route"] = route;
                let serviceDay = service[i];
                let departureTime = moment(serviceDay, 'YYYYMMDD').add(departureDFM);
                let arrivalTime = moment(serviceDay, 'YYYYMMDD').add(arrivalDFM);
                let connection = {
                  departureTime: departureTime,
                  arrivalTime: arrivalTime,
                  arrivalStop: connectionRule['arrival_stop'],
                  departureStop: connectionRule['departure_stop'],
                  trip: trip
                };
                
                //The direction or headsign of a vehicle depends on several levels
                if (connectionRule['departure_stop_headsign']) 
                  connection['headsign'] = connectionRule['departure_stop_headsign'];
                else  if (trip['trip_headsign'])
                  connection['headsign'] = trip['trip_headsign'];
                else if (route['route_long_name'])
                  connection['headsign'] = route['route_long_name'];
                
                if (connectionRule['arrival_stop_headsign'])
                  connection['previous_headsign'] = connectionRule['arrival_stop_headsign'];

                if (connectionRule['vias']) {
                  connection['vias'] = connectionRule['vias'];
                }

                if (connectionRule['drop_off_type']) {
                  connection['drop_off_type'] = connectionRule['drop_off_type'];
                }
                
                if (connectionRule['pickup_type']) {
                  connection['pickup_type'] = connectionRule['pickup_type'];
                }
                connection.will_split_into = [];
                connection.joined_with = [];
                
                //Process will_split_into and joined_with: the trip id also has to drive on this service day before it will actually split or join...

                //Will contain the trip id and route id for the trip from which it will split
                if (connectionRule.will_split_into && connectionRule.will_split_into != '')
                  connection.will_split_into = await this._retrieveSplitOrJoinTrips(serviceDay, connectionRule.will_split_into);

                if (connectionRule.joined_with && connectionRule.joined_with != '') {
                  connection.joined_with = await this._retrieveSplitOrJoinTrips(serviceDay, connectionRule.joined_with);
                }
                this.push(connection);
              }
              done();
            } else {
              done();
              console.error('Did not find this service id in calendar or calendar dates: ', trip);
            }
          });
        } else {
          console.error('Did not find this route id in routes.txt: ', trip);
          done();
        }
      });
    } else {
      console.error('Did not find this trip id in trips.txt: ', connectionRule);
      done();
    }
  });
};

ConnectionsBuilder.prototype._retrieveSplitOrJoinTrips = async function (serviceDay, tripIds) {
  //In the CSV file, we use a separator |&AND&| to add multiple values to a single column.
  return Promise.all(tripIds.split('|&AND&|').map(async (tripId) => {
    if (tripId && tripId != '') {
      let trip = new Promise((resolve, reject) => {
        this._tripsdb.get(tripId, (error, trip) => {
          if (!error) {
            this._routesdb.get(trip['route_id'], (error, route) => {
              if (!error) {
                this._servicesdb.get(trip['service_id'], (error, service) => {
                  if (!error) {
                    if (service.indexOf(serviceDay) > -1) {
                      trip["route"] = route;
                      resolve(trip);
                    } else {
                      //This trip is not running on this day. Return nothing.
                      resolve(null);
                    }
                  } else {
                    reject('Did not find this service id in calendar or calendar dates: ' + trip.trip_id, trip);
                  }
                });
              } else {
                reject('Did not find this route id in routes.txt: ' + trip.trip_id, trip);
              }
            });
          } else {
            reject('Did not find this trip id in trips.txt: ' + tripId);
          }
        });
      });
      if (trip)
        return trip;
    }
  }));
};

module.exports = ConnectionsBuilder;
