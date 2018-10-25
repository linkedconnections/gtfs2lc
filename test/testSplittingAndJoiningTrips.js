const assert = require('assert');
const fs = require('fs');
const JSONStream = require('JSONStream');
const {AsyncIterator} = require('asynciterator');

describe('The file connections.nldjsonld should contain things', () => {

  var streamToArray = function (stream) {
    let connections = [];
    return new Promise( (resolve, reject) => {
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
  };

  var streamPromise = streamToArray(fs.createReadStream('test/sample-feed/connections.nldjsonld', { encoding: 'utf8', objectMode: true }).pipe(JSONStream.parse()));
  var connections = [];
  it ('Joining trips should give no less or more connections than expected', async () => {
    connections = await streamPromise;
    //Retrieve the joiningtrip from the connections array for one specific day
    let joiningtrip = connections.filter(connection => {
      return connection['gtfs:route'] === 'http://example.org/routes/joining_route' && connection.departureTime.substr(0,10) === '2007-02-17';
    });

    //The joining train should only show 1 connection for the joined part of the trip, which has a departure a D. Let’s check this
    assert.equal(joiningtrip.filter(connection => connection.departureStop === 'http://example.org/stops/D').length, 1);

    /*let numberOfJoinedConnections = joiningtrip.filter((connection) => {
      return connection.joined_with.length > 0;
    }).length;
    assert.equal(numberOfJoinedConnections, 2);*/
  });

  it('A non joining trip that was flagged potentially joining should show up separately', () => {
    //There is a tricky non joining trip in the tests. This one should however show up in the data...
    let nonjoiningtrip = connections.filter(connection => {
      return connection['@id'] === 'http://example.org/connections/20070216/C/non_joining_splitting_trip_3';
    });
    assert.notEqual(nonjoiningtrip.length,0);
  });
  
  it('A splitting trip that was flagged potentially joining should show up as a splitting trip', () => {
    //There is a tricky non joining trip in the tests. This one should however show up in the data... And it should also show up as a splitting train.
    let splittingtrip = connections.filter(connection => {
      return connection['gtfs:trip'] === 'http://example.org/trips/non_joining_splitting_trip_3/20070216';
    });
    assert.notEqual(splittingtrip.length,0);
  });

});
