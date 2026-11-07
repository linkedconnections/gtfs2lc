const { readCsv, uint, enumValue, optionalNumber } = require("./io");
const { requireIndex } = require("./dictionaries");
const { serviceEpoch, duration } = require("./time");
const { serviceDate } = require("./iri-strategy");

async function* callsForFeed(
  sourcePath,
  stores,
  dictionaries,
  strategy,
  options,
  spool,
) {
  const {
    stops,
    trips,
    routes,
    stopIndex,
    tripIndex,
    tripsRaw,
    routesRaw,
    timeZone,
  } = dictionaries;
  const start = options.startDate ? serviceDate(options.startDate) : "00000000";
  const end = options.endDate ? serviceDate(options.endDate) : "99999999";
  if (start > end) throw new Error("start-date must not follow end-date");
  const seen = new Set();
  let tripId;
  let pattern = [];
  async function* expand() {
    if (!pattern.length) return;
    const tripIdx = requireIndex(tripIndex, tripId, "stop-time trip");
    const trip = trips[tripIdx];
    const raw = tripsRaw[tripIdx];
    const days = await stores.servicesDB.get(raw.service_id);
    if (!days) throw new Error(`Unknown service: ${raw.service_id}`);
    pattern.sort((a, b) => a.stopSequence - b.stopSequence);
    for (let i = 0; i < pattern.length; i++) {
      if (i && pattern[i].stopSequence === pattern[i - 1].stopSequence)
        throw new Error("Duplicate stop_sequence");
      if (pattern[i].arrival === null && pattern[i].departure === null)
        throw new Error(
          "Untimed stop requires interpolation, which this exporter does not implement",
        );
      if (i && pattern[i].arrival === null)
        throw new Error("Non-origin call requires arrival_time");
      if (i < pattern.length - 1 && pattern[i].departure === null)
        throw new Error("Non-terminal call requires departure_time");
      if (
        pattern[i].arrival !== null &&
        pattern[i].departure !== null &&
        pattern[i].departure < pattern[i].arrival
      )
        throw new Error("Departure before arrival at a call");
    }
    for (const day of [...days].sort()) {
      serviceDate(day);
      if (day < start || day > end) continue;
      const base = serviceEpoch(day, timeZone);
      const date = Number(day);
      const tripContext = {
        ...raw,
        key: tripId,
        startTime: new Date(
          (base + (pattern[0].departure ?? pattern[0].arrival)) * 1000,
        ),
      };
      const context = {
        trips: tripContext,
        routes: {
          ...routesRaw[trip.routeIdx],
          key: routes[trip.routeIdx].routeId,
        },
        connection: { serviceDate: day },
      };
      const runIri = strategy.mint("run", context, [tripId, day]);
      let previous;
      let previousStop;
      for (const stop of pattern) {
        const connection = {
          serviceDate: day,
          stopSequence: stop.stopSequence,
        };
        const stopContext = {
          ...context,
          stops: { ...stop.raw, key: stops[stop.stopIdx].stopId },
          connection,
        };
        const call = {
          tripIdx,
          serviceDate: date,
          stopSequence: stop.stopSequence,
          stopIdx: stop.stopIdx,
          arrivalTime:
            stop.arrival === null ? null : BigInt(base + stop.arrival),
          departureTime:
            stop.departure === null ? null : BigInt(base + stop.departure),
          pickupType: stop.pickupType,
          dropOffType: stop.dropOffType,
          headsign: stop.raw.stop_headsign || null,
          shapeDistance: stop.distance,
          iri: strategy.mint("call", stopContext, [
            tripId,
            day,
            stop.stopSequence,
          ]),
          tripIri: trip.iri,
          runIri,
          stopIri: stops[stop.stopIdx].iri,
        };
        if (previous) {
          const dep = Number(previous.departureTime);
          const arr = Number(call.arrivalTime);
          if (arr < dep) throw new Error("Connection arrives before departure");
          const from = previousStop;
          const connectionContext = {
            ...context,
            connection: {
              serviceDate: day,
              stopSequence: previous.stopSequence,
              departureTime: new Date(dep * 1000),
              arrivalTime: new Date(arr * 1000),
              departureStop: from.raw,
              arrivalStop: stop.raw,
            },
          };
          await spool.add({
            departureTime: dep,
            arrivalTime: arr,
            departureStopIdx: previous.stopIdx,
            arrivalStopIdx: call.stopIdx,
            tripIdx,
            pickupType: previous.pickupType,
            dropOffType: call.dropOffType,
            serviceDate: date,
            stopSequence: previous.stopSequence,
            arrivalStopSequence: call.stopSequence,
            iri: strategy.mint("connection", connectionContext, [
              tripId,
              day,
              previous.stopSequence,
            ]),
            tripIri: trip.iri,
            runIri,
            departureStopIri: previous.stopIri,
            arrivalStopIri: call.stopIri,
            departureCallIri: previous.iri,
            arrivalCallIri: call.iri,
          });
        }
        yield call;
        previous = call;
        previousStop = stop;
      }
    }
  }
  for await (const raw of readCsv(sourcePath, "stop_times.txt")) {
    if (!raw.trip_id) throw new Error("Missing stop-time trip_id");
    if (tripId !== raw.trip_id) {
      yield* expand();
      if (seen.has(raw.trip_id))
        throw new Error("stop_times must be sorted by trip");
      seen.add(raw.trip_id);
      tripId = raw.trip_id;
      pattern = [];
    }
    const stopIdx = requireIndex(stopIndex, raw.stop_id, "stop-time stop");
    pattern.push({
      raw,
      stopIdx,
      stopSequence: uint(raw.stop_sequence, "stop_sequence"),
      arrival: duration(raw.arrival_time),
      departure: duration(raw.departure_time),
      pickupType: enumValue(raw.pickup_type, "pickup_type", 3, 0),
      dropOffType: enumValue(raw.drop_off_type, "drop_off_type", 3, 0),
      distance: optionalNumber(raw.shape_dist_traveled, "shape distance", 0),
    });
  }
  yield* expand();
}
module.exports = { callsForFeed };
