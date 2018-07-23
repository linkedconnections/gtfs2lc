/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
var Transform = require('stream').Transform,
  util = require('util'),
  moment = require('moment');

var ConnectionsBuilder = function (tripsdb, servicesdb, routesdb, stopsdb, stoptimeoverridesdb) {
  Transform.call(this, {objectMode: true});
  this._tripsdb = tripsdb;
  this._servicesdb = servicesdb;
  this._routesdb = routesdb;
  this._stopsdb = stopsdb;
  this._stoptimeoverridesdb = stoptimeoverridesdb;
};

util.inherits(ConnectionsBuilder, Transform);

ConnectionsBuilder.prototype._transform = function (connectionRule, encoding, done) {
  //Examples of
  // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
  // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }
  var departureDFM = moment.duration(connectionRule['departure_dfm']);
  var arrivalDFM = moment.duration(connectionRule['arrival_dfm']);
  var self = this;

  this._tripsdb.get(connectionRule['trip_id'], function (error, trip) {
    if (!error) {
      self._routesdb.get(trip['route_id'], function (error, route) {
        if (!error) {
          self._servicesdb.get(trip['service_id'], function (error, service) {
            if (!error) {
              self._stopsdb.get(connectionRule['departure_stop'], function (error, departureStop) {
                if (!error) {
                  self._stopsdb.get(connectionRule['arrival_stop'], function (error, arrivalStop) {
                      if (!error) {
                        self._stoptimeoverridesdb.get(trip['trip_id'] + "#" + trip['service_id'] + "#" + (parseInt(connectionRule['stop_sequence'])-1).toString(), function (error, departureOverride) {
                          self._stoptimeoverridesdb.get(trip['trip_id'] + "#" + trip['service_id'] + "#" + (parseInt(connectionRule['stop_sequence'])).toString(), function (error, arrivalOverride) {

                            var departurePlatform;
                            var arrivalPlatform;

                            if (departureOverride !== undefined) {
                              departurePlatform = false;

                              self._stopsdb.get(departureOverride['stop_id'].trim(), function (error, result) {
                                if (error)
                                  departurePlatform = "?";
                                else
                                  departurePlatform = result['platform_code'].trim();
                              });

                              while (departurePlatform === false) ; // TODO: Fix busy wait (!!!)

                            } else {
                              departurePlatform = "?";
                            }

                            if (arrivalOverride !== undefined) {
                              arrivalPlatform = false;

                              self._stopsdb.get(arrivalOverride['stop_id'].trim(), function (error, result) {
                                if (error)
                                  arrivalPlatform = "?";
                                else
                                  arrivalPlatform = result['platform_code'].trim();
                              });

                              while (arrivalPlatform === false) ; // TODO: Fix busy wait (!!!)

                            } else {
                              arrivalPlatform = "?";
                            }

                            for (var i in service) {
                              trip["route"] = route;
                              var serviceDay = service[i];
                              var departureTime = moment(serviceDay, 'YYYYMMDD').add(departureDFM);
                              var arrivalTime = moment(serviceDay, 'YYYYMMDD').add(arrivalDFM);
                              var connection = {
                                departureTime: departureTime,
                                arrivalTime: arrivalTime,
                                trip: trip
                              };

                              if (departureOverride !== undefined)
                                connection['departureStop'] = {
                                  'gtfs:parentStop': connectionRule['departure_stop'],
                                  'gtfs:stop': connectionRule['departure_stop'] + "#" + departurePlatform,
                                  'dct:description': departureStop['stop_name'] + " platform " + departurePlatform,
                                  'dct:identifier': departurePlatform,
                                  'rfds:label': departureStop['stop_name']
                                };
                              else
                                connection['departureStop'] = {
                                  'gtfs:parentStop': connectionRule['departure_stop'],
                                  'gtfs:stop':connectionRule['departure_stop'],
                                  'dct:description': departureStop['stop_name'],
                                  'dct:identifier': departurePlatform,
                                  'rfds:label': departureStop['stop_name']
                                };

                              if (arrivalOverride !== undefined)
                                connection['arrivalStop'] = {
                                  'gtfs:parentStop': connectionRule['arrival_stop'],
                                  'gtfs:stop': connectionRule['arrival_stop'] + '#' + arrivalPlatform,
                                  'dct:description': arrivalStop['stop_name'] + " platform " + arrivalPlatform,
                                  'dct:identifier': arrivalPlatform,
                                  'rfds:label': arrivalStop['stop_name']
                                };
                              else
                                connection['arrivalStop'] = {
                                  'gtfs:parentStop': connectionRule['arrival_stop'],
                                  'gtfs:stop':connectionRule['arrival_stop'],
                                  'dct:description': arrivalStop['stop_name'],
                                  'dct:identifier': departurePlatform,
                                  'rfds:label': arrivalStop['stop_name']
                                };

                              //The direction or headsign of a vehicle depends on several levels
                              if (connectionRule['departure_stop_headsign'])
                                connection['headsign'] = connectionRule['departure_stop_headsign'];
                              else if (trip['trip_headsign'])
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

                              self.push(connection);
                            }

                            done();
                          });
                        });
                      }
                    }
                  );
                }
              });
            }
          });
        }
      });

    }
  });
};

module.exports = ConnectionsBuilder;
