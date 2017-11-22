/**
 * Pieter Colpaert © Ghent University - iMinds 
 * Make sure that the stop_times.txt is ordered by trip_id and stop_sequence before piping it to this library
 */
var Transform = require('stream').Transform,
    util = require('util');

var StopTimesToConnections = function () {
  Transform.call(this, {objectMode : true});
  this._previousStopTime = null;
};

util.inherits(StopTimesToConnections, Transform);

/**
 * When ordered, we can just take 2 gtfs:StopTimes and bring them together in 1 "connection rule", which is an intermediate data structure we define here
 */
StopTimesToConnections.prototype._transform = function (stopTime, encoding, done) {
  // If both pick_up_type of previousStopTime and drop_off_type of current stoptime are 1, then discard this stoptime and look further, but now for the stoptime that continues from this "via"
  if (stopTime['drop_off_type'] !== null && stopTime['drop_off_type'] == 1  && stopTime['pickup_type'] !== null && stopTime['pickup_type'] == 1) {
    if (this._previousStopTime && !this._previousStopTime['vias']) {
      this._previousStopTime['vias'] = [stopTime['stop_id']];
    } else if (this._previousStopTime) {
      this._previousStopTime['vias'].push(stopTime['stop_id']);
    }
  } else {
    if (!this._previousStopTime) {
      this._previousStopTime = stopTime;
    } else {
      if (this._previousStopTime['trip_id'] === stopTime['trip_id']) {
        //dfm is "duration from midnight" (see GTFS reference)
        this.push({
          trip_id: this._previousStopTime['trip_id'],
          arrival_dfm: stopTime['arrival_time'],
          departure_dfm: this._previousStopTime['departure_time'],
          departure_stop: this._previousStopTime['stop_id'],
          arrival_stop : stopTime['stop_id'],
          departure_stop_headsign: this._previousStopTime['stop_headsign'],
          arrival_stop_headsign: stopTime['stop_headsign'],
          pickup_type: this._previousStopTime['pickup_type'],
          drop_off_type: stopTime['drop_off_type'],
          vias: this._previousStopTime['vias']
        });
      }
    }
    this._previousStopTime = stopTime;
  }
  done();
};

module.exports = StopTimesToConnections;
