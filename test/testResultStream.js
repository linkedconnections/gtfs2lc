const gtfs2lc = require('../lib/gtfs2lc.js');
const assert = require('assert');
const N3 = require('n3');

describe('Testing whether result contains certain objects (regression tests)', () => {
  
  var lcstreamToArray = function (options) {
    if (!options)
      options = {};
    return new Promise( (resolve, reject) => {
      var mapper = new gtfs2lc.Connections(options);
      mapper.resultStream('./test/sample-feed', (stream) => {
        if (options.format && options.format === "rdf") {
          stream = stream.pipe(new gtfs2lc.Connections2Triples({}));
        } else if(options.format && options.format === 'jsonld') {
          stream = stream.pipe(new gtfs2lc.Connections2JSONLD());
        }
        var connections = [];
        stream.on('data', connection => {
          connections.push(connection);
        });
        stream.on('error', (error) => {
          reject(error);
        });
        stream.on('end', () => {
          resolve(connections);
        });
      });
    });
  };

  var connections;
  //This will be the first element when sorted correctly
  it('Stream should contain a first connection with arrivalStop AMV', async () => {
    connections = await lcstreamToArray();
    assert.equal(connections[0]['arrivalStop'],'AMV');
  });
  
  it ('Joining trips should give no less or more connections than expected', () => {
    //Retrieve the joiningtrip from the connections array for one specific day
    let joiningtrip = connections.filter(connection => {
      return connection.trip.route.route_id === 'joining_route' && connection.departureTime.format('YYYY-MM-DD') === '2007-02-17';
    });

    //The joining train should only show 1 connection for the joined part of the trip, which has a departure a D. Let’s check this
    assert.equal(joiningtrip.filter(connection => connection.departureStop === 'D').length, 1);

    let numberOfJoinedConnections = joiningtrip.filter((connection) => {
      return connection.joined_with.length > 0;
    }).length;
    assert.equal(numberOfJoinedConnections, 2);
  });

  it('But a  non joining trip that was flagged potentially joining should show up separately though', () => {
    //There is a tricky non joining trip in the tests. This one should however show up in the data...
    let nonjoiningtrip = connections.filter(connection => {
      return connection.trip.route.trip_id === 'non_joining_trip_3';
    });
    assert.notEqual(nonjoiningtrip.length,0);
  });

  it('JSON-LD Stream should contain Connections', async () => {
    var triples = await lcstreamToArray({
      format : 'jsonld'
    });
    assert.equal(triples[0]['@type'],'Connection');
  });

  it('RDF Stream should contain Connections', async () => {
    var triples = await lcstreamToArray({
      format : 'rdf'
    });
    assert.equal(triples[0].object,'http://semweb.mmlab.be/ns/linkedconnections#Connection');
  });

});
