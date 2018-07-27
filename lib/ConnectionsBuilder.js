/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
const { Transform } = require('stream');
const util = require('util');
const moment = require('moment');

class ConnectionsBuilder extends Transform {
  constructor(tripsdb, servicesdb, routesdb, stopsdb, stoptimeoverridesdb) {
    super({ objectMode: true });
    this._tripsdb = tripsdb;
    this._servicesdb = servicesdb;
    this._routesdb = routesdb;
    this._stopsdb = stopsdb;
    this._stoptimeoverridesdb = stoptimeoverridesdb;
  }

  async _transform(connectionRule, encoding, done) {
    //Examples of
    // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
    // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }
    var departureDFM = moment.duration(connectionRule['departure_dfm']);
    var arrivalDFM = moment.duration(connectionRule['arrival_dfm']);

    try {
      let trip = await this._tripsdb.get(connectionRule['trip_id']);
      let route = await this._routesdb.get(trip['route_id']);
      let service = await this._servicesdb.get(trip['service_id']);
      let departureStop = await this._stopsdb.get(connectionRule['departure_stop']);
      let arrivalStop = await this._stopsdb.get(connectionRule['arrival_stop']);
      let departureOverride;
      let arrivalOverride;
      let departurePlatform;
      let arrivalPlatform;

      try {
        departureOverride = await this._stoptimeoverridesdb.get(trip['trip_id'] + "#" + trip['service_id'] + "#" + (parseInt(connectionRule['stop_sequence']) - 1).toString());
      } catch(err) {
        departureOverride = undefined;
      }
      
      try {
        arrivalOverride = await this._stoptimeoverridesdb.get(trip['trip_id'] + "#" + trip['service_id'] + "#" + (parseInt(connectionRule['stop_sequence'])).toString());
      } catch(err) {
        arrivalOverride = undefined;
      }      

      if (departureOverride !== undefined) {
        try {
          let dp = await this._stopsdb.get(departureOverride['stop_id'].trim());
          departurePlatform = dp['platform_code'].trim();
        } catch (err) {
          departurePlatform = "?";
        }
      } else {
        departurePlatform = "?";
      }

      if (arrivalOverride !== undefined) {
        try {
          let ap = await this._stopsdb.get(arrivalOverride['stop_id'].trim());
          arrivalPlatform = ap['platform_code'].trim();
        } catch (err) {
          arrivalPlatform = "?";
        }
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

        if (departureOverride !== undefined) {
          connection['departureStop'] = {
            'gtfs:parentStop': connectionRule['departure_stop'],
            'gtfs:stop': connectionRule['departure_stop'] + "#" + departurePlatform,
            'dct:description': departureStop['stop_name'] + " platform " + departurePlatform,
            'dct:identifier': departurePlatform,
            'rfds:label': departureStop['stop_name']
          };
        } else {
          connection['departureStop'] = {
            'gtfs:parentStop': connectionRule['departure_stop'],
            'gtfs:stop': connectionRule['departure_stop'],
            'dct:description': departureStop['stop_name'],
            'dct:identifier': departurePlatform,
            'rfds:label': departureStop['stop_name']
          };
        }

        if (arrivalOverride !== undefined) {
          connection['arrivalStop'] = {
            'gtfs:parentStop': connectionRule['arrival_stop'],
            'gtfs:stop': connectionRule['arrival_stop'] + '#' + arrivalPlatform,
            'dct:description': arrivalStop['stop_name'] + " platform " + arrivalPlatform,
            'dct:identifier': arrivalPlatform,
            'rfds:label': arrivalStop['stop_name']
          };
        } else {
          connection['arrivalStop'] = {
            'gtfs:parentStop': connectionRule['arrival_stop'],
            'gtfs:stop': connectionRule['arrival_stop'],
            'dct:description': arrivalStop['stop_name'],
            'dct:identifier': departurePlatform,
            'rfds:label': arrivalStop['stop_name']
          };
        }

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

        this.push(connection);
      }

      done();

    } catch (err) {
      console.error(err);
    }
  }
}

module.exports = ConnectionsBuilder;
