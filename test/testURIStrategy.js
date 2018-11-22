const assert = require('assert');
const URIStrategy = require('../lib/URIStrategy');

describe('URIStrategy', () => {
  describe('getRouteId', () => {
    it('should replace {routes.route_id} by connection.trip.route.route_id', () => {
      const strategy = new URIStrategy({
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
  });

  describe('getId', () => {
    it('should resolve expression using date-fns.format function', () => {
      const strategy = new URIStrategy({
        connection:
          'http://example.org/connections/{trip_startTime}/{departureStop}/{trip_id}',
        resolve: {
          trip_id: 'connection.trip.trip_id',
          trip_startTime: "format(connection.trip.startTime, 'YYYYMMDDTHHmm');",
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
