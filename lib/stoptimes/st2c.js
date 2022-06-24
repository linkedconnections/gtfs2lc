/**
 * Pieter Colpaert and Julián Rojas © Ghent University - imec 
 * Make sure that the stop_times.txt is ordered by trip_id and stop_sequence before piping it to this library
 */
 const Transform = require('stream').Transform;

 class StopTimesToConnections extends Transform {
	 constructor(stopsDB, tripsDB, routesDB, servicesDB, historyDB) {
		 super({ objectMode: true });
		 this._stopsDB = stopsDB;
		 this._tripsDB = tripsDB;
		 this._routesDB = routesDB;
		 this._servicesDB = servicesDB;
		 this._historyDB = historyDB;
		 this._previousStopTime = null;
		 this._currentTripStartTime = null;
	 }
 
	 /**
	 * When ordered, we can just take 2 gtfs:StopTimes and bring them together in 1 "connection rule", 
	 * which is an intermediate data structure we define here
	 */
	 async _transform(stopTime, encoding, done) {
		 if (this.previousStopTime && this.previousStopTime['trip_id'] === stopTime['trip_id']) {
			 if (stopTime['arrival_time'] === '' && stopTime['departure_time'] === '') {
				 // Both arrival and departure time for this stop are empty, so Connection rule cannot be created.
				 // This is valid GTFS but requires interpolation to set estimated stop times.
				 return done(new Error(`ERROR: Empty arrival and departure times found for trip ${stopTime['trip_id']} on stop ${stopTime['stop_id']}. Interpolation is required in a previous step to handle these cases.`));
			 }
 
			 // Get related trip, route and service dates
			 const {
				 departureStop,
				 arrivalStop,
				 trip,
				 route,
				 serviceDates
			 } = await this.getRelatedData(this.previousStopTime['stop_id'], stopTime['stop_id']);
 
			 // Add trip start time as a resource for URI building.
			 trip.startTime_dfm = this.currentTripStartTime;
			 // Add stop headsigns (if any)
			 let headsign = null;
			 if (arrivalStop['stop_headsign'] && arrivalStop['stop_headsign'] !== '') {
				 headsign = arrivalStop['stop_headsign'];
			 } else if (trip['trip_headsign'] && trip['trip_headsign'] !== '') {
				 headsign = trip['trip_headsign'];
			 } else if (route['route_long_name'] && route['route_long_name'] !== '') {
				 headsign = route['route_long_name'];
			 }
			 let previous_headsign = null;
			 if (departureStop['stop_headsign']) {
				 previous_headsign = departureStop['stop_headsign'];
			 }
 
			 // Use stop_code as stop ID if available. Fallback to stop_id
			 const depStopId = departureStop['stop_code'] && departureStop['stop_code'] !== '' ?
				 departureStop['stop_code'] : departureStop['stop_id'];
			 const arrStopId = arrivalStop['stop_code'] && arrivalStop['stop_code'] !== '' ?
				 arrivalStop['stop_code'] : arrivalStop['stop_id'];
			 
			 // Get a unique identifier for this connection rule
			 const uniqueId = [
				 route['route_long_name'].replace(/\s/g, ''),
				 trip['trip_short_name'],
				 depStopId,
				 arrStopId,
				 this.currentTripStartTime,
				 this.previousStopTime['departure_time'],
				 stopTime['arrival_time'],
				 this.previousStopTime['pickup_type'],
				 stopTime['drop_off_type']
			 ].join('/');
          
			 // Check if this connection rule exists in historyDB and if there are any updates
			 const newServices = await this.differentialUpdate(uniqueId, serviceDates);
			 if (newServices) {
				 // Create a connection rule
				 // dfm is "duration from midnight" (see GTFS reference)
				 const connection = {
					 route,
					 trip,
					 departure_dfm: this.previousStopTime['departure_time'],
					 arrival_dfm: stopTime['arrival_time'],
					 departure_stop: departureStop,
					 arrival_stop: arrivalStop,
					 pickup_type: this.previousStopTime['pickup_type'] || '',
					 drop_off_type: stopTime['drop_off_type'] || '',
					 headsign,
					 previous_headsign,
					 stop_sequence: this.previousStopTime['stop_sequence']
				 };
				 // There are updates! push this Connection rule
				 connection.serviceDates = newServices;
				 this.push(connection);
			 }
 
		 } else {
			 this.currentTripStartTime = stopTime['departure_time'];
		 }
		 this.previousStopTime = stopTime;
		 done();
	 }
 
	 async getRelatedData(departure, arrival) {
		 const departureStop = await this.stopsDB.get(departure);
		 const arrivalStop = await this.stopsDB.get(arrival);
		 const trip = await this.tripsDB.get(this.previousStopTime['trip_id']);
		 const route = await this.routesDB.get(trip['route_id']);
		 const serviceDates = await this.servicesDB.get(trip['service_id']);
		 return {
			 departureStop,
			 arrivalStop,
			 trip,
			 route,
			 serviceDates
		 };
	 }
 
	 async differentialUpdate(id, serviceDates) {
		 try {
			 const old = await this.historyDB.get(id);
			 // This Connection rule has been processed in the past.
			 // Check if there are new service dates
			 const oldServiceDates = Object.keys(old);
			 const newServices = serviceDates.filter(s => !oldServiceDates.includes(s));
			 if (newServices.length > 0) {
				 // Update history with new found service dates
				 const update = Object.assign({}, old);
				 newServices.forEach(nsd => {
					 update[nsd] = {
						 type: 'Connection',
						 departureDelay: 0,
						 arrivalDelay: 0
					 }
				 });
				 
				 await this.historyDB.put(id, update);
				 return newServices;
			 } else {
				 // Nothing to update
				 return null;
			 }
		 } catch (err) {
			 if (err.code === 'LEVEL_NOT_FOUND') {
				 // Is a completely new Connection rule, create history structure
				 // for this connection rule and add parameters that could only be
				 // updated in GTFS-realtime data updates.
				 const history = {};
				 serviceDates.forEach(sd => {
					 history[sd] = {
						 type: 'Connection',
						 departureDelay: 0,
						 arrivalDelay: 0
					 };
				 });
				 await this.historyDB.put(id, history);
				 return serviceDates;
			 } else {
				 // Something went wrong
				 throw err;
			 }
		 }
	 }
 
	 get stopsDB() {
		 return this._stopsDB;
	 }
 
	 get tripsDB() {
		 return this._tripsDB;
	 }
 
	 get routesDB() {
		 return this._routesDB;
	 }
 
	 get servicesDB() {
		 return this._servicesDB;
	 }
 
	 get historyDB() {
		 return this._historyDB;
	 }
 
	 get previousStopTime() {
		 return this._previousStopTime;
	 }
 
	 set previousStopTime(st) {
		 this._previousStopTime = st;
	 }
 
	 get currentTripStartTime() {
		 return this._currentTripStartTime;
	 }
 
	 set currentTripStartTime(st) {
		 this._currentTripStartTime = st;
	 }
 }
 
 module.exports = StopTimesToConnections;
 