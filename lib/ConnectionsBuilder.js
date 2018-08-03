/**
 * Pieter Colpaert © Ghent University - iMinds
 * Combines connection rules, trips and services to an unsorted stream of connections
 */
const { Transform } = require('stream');
const util = require('util');
const moment = require('moment');

class ConnectionsBuilder extends Transform {
  constructor(tripsdb, servicesdb, routesdb, zone) {
    super({ objectMode: true });
    this._tripsdb = tripsdb;
    this._servicesdb = servicesdb;
    this._routesdb = routesdb;
    this._zone = zone;
  }

  async _transform(connectionRule, encoding, done) {
    //Examples of
    // * a connectionRule: {"trip_id":"STBA","arrival_dfm":"6:20:00","departure_dfm":"6:00:00","departure_stop":"STAGECOACH","arrival_stop":"BEATTY_AIRPORT","departure_stop_headsign":"","arrival_stop_headsign":"","pickup_type":""}
    // * a trip: { route_id: 'AAMV',service_id: 'WE',trip_id: 'AAMV4',trip_headsign: 'to Airport',direction_id: '1', block_id: '', shape_id: '' }

    try {
      let departureDFM = moment.duration(connectionRule['departure_dfm']);
      let arrivalDFM = moment.duration(connectionRule['arrival_dfm']);

      let trip = await this._tripsdb.get(connectionRule['trip_id']);
      let route = await this._routesdb.get(trip['route_id']);
      let service = await this._servicesdb.get(trip['service_id']);

      for (var i in service) {
        trip["route"] = route;
        var serviceDay = service[i];
        var departureTime = moment(serviceDay, 'YYYYMMDD').add(departureDFM);
        var arrivalTime = moment(serviceDay, 'YYYYMMDD').add(arrivalDFM);
        var connection = {
          departureTime: departureTime,
          arrivalTime: arrivalTime,
          arrivalStop: connectionRule['arrival_stop'],
          departureStop: connectionRule['departure_stop'],
          trip: trip,
          operationZone: this._zone
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

        this.push(connection);
      }

      done();
    } catch (err) {
      console.error(err);
    }
  }
}

module.exports = ConnectionsBuilder;
