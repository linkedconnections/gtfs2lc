const assert = require('assert');
const URIStrategy = require('../lib/URIStrategy');

describe('URIStrategy', () => {
  describe('getRouteId', () => {
    it('should replace {routes.route_id} by connection.trip.route.route_id', () => {
      let strategy = new URIStrategy();
      strategy = new URIStrategy({
        route: 'http://example.org/routes/{routes.route_id}',
      });

      const connection = {
        trip: {
          route: {
            route_id: 'B1234-56789',
          },
        },
      };

      assert.equal(
        strategy.getRouteId(connection),
        'http://example.org/routes/B1234-56789'
      );
    });

    it('should replace spaces by %20', () => {
      const strategy = new URIStrategy({
        route: 'http://example.org/routes/{routes.route_id}',
      });

      const connection = {
        trip: {
          route: {
            route_id: 'a b c',
          },
        },
      };

      assert.equal(
        strategy.getRouteId(connection),
        'http://example.org/routes/a%20b%20c'
      );
    });

    it('should resolve expression by evaluating matching key in resolve object', () => {
      const strategy = new URIStrategy({
        route: 'http://example.org/routes/{route_short_id}',
        resolve: {
          route_short_id: 'connection.trip.route.route_id.substring(0,5)',
        },
      });

      const connection = {
        trip: {
          route: {
            route_id: 'B1234-56789',
          },
        },
      };

      assert.equal(
        strategy.getRouteId(connection),
        'http://example.org/routes/B1234'
      );
    });

    it('Should resolve stop URI', async () => {
      let stops = new Map();
      stops.set('1', { stop_id: 'stop1' });
      const strategy = new URIStrategy({
        stop: 'http://example.org/stops/{stops.stop_id}'
      }, stops);
      assert.equal(await strategy.getStopId('1'), 'http://example.org/stops/stop1');
      // Should not resolve stop URI
      assert.rejects(
        async () => { await strategy.getStopId('2') },
        Error
      );
    });

    it('Should resolve trip URI', () => {
      const strategy = new URIStrategy({
        trip: 'http://example.org/trips/{trips.trip_id}/{trips.startTime(yyyyMMdd)}',
      });
      const connection = {
        trip: {
          trip_id: 'trip1',
          startTime: new Date('2020-02-15T08:00:00.000Z')
        }
      };
      assert.equal(strategy.getTripId(connection), 'http://example.org/trips/trip1/20200215');
    });
  });

  describe('getId', () => {
    it('should resolve expression using date-fns.format function', () => {
      const strategy = new URIStrategy({
        connection:
          'http://example.org/connections/{trip_startTime}/{departureStop}/{trip_id}',
        resolve: {
          trip_id: 'connection.trip.trip_id',
          trip_startTime: 'format(connection.trip.startTime, "yyyyMMdd\'T\'HHmm");',
          departureStop: 'connection.departureStop',
        },
      });

      const connection = {
        departureStop: '1234',
        trip: {
          trip_id: '5678',
          startTime: new Date('2018-09-21T10:25:12'),
        },
      };

      assert.equal(
        strategy.getId(connection),
        'http://example.org/connections/20180921T1025/1234/5678'
      );
    });
  });
});
