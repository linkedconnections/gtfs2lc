const { readCsv, optionalNumber, enumValue, uint } = require("./io");
const { buildHubRegions } = require("./regions");

async function entries(store) {
  const result = [];
  if (store instanceof Map) result.push(...store);
  else for await (const row of store.iterator()) result.push(row);
  return result.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
function index(rows, field) {
  return new Map(rows.map((row, i) => [row[field], i]));
}
function requireIndex(map, key, kind) {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Unknown ${kind}: ${key}`);
  return value;
}

async function buildDictionaries(stores, sourcePath, strategy, options) {
  const agencies = [];
  for await (const row of readCsv(sourcePath, "agency.txt")) agencies.push(row);
  if (!agencies.length) throw new Error("agency.txt is required");
  const zones = new Set(agencies.map((a) => a.agency_timezone));
  if (zones.size !== 1 || !agencies[0].agency_timezone)
    throw new Error("This exporter requires one agency timezone per release");
  const timeZone = agencies[0].agency_timezone;
  new Intl.DateTimeFormat("en-GB", { timeZone });
  const agencyById = new Map(agencies.map((a) => [a.agency_id || "", a]));
  const stopsRaw = (await entries(stores.stopsDB)).map(([, value]) => value);
  const routesRaw = (await entries(stores.routesDB)).map(([, value]) => value);
  const tripsRaw = (await entries(stores.tripsDB)).map(([, value]) => value);
  if (!stopsRaw.length || !routesRaw.length || !tripsRaw.length)
    throw new Error("GTFS dictionaries must be nonempty");
  for (const rows of [stopsRaw, routesRaw, tripsRaw]) {
    if (rows.length > 0x7fffffff)
      throw new Error("Dictionary exceeds Int32 indices");
  }
  for (const [name, key, rows] of [
    ["stops", "stop_id", stopsRaw],
    ["routes", "route_id", routesRaw],
    ["trips", "trip_id", tripsRaw],
  ]) {
    let count = 0;
    for await (const row of readCsv(sourcePath, `${name}.txt`)) {
      if (!row[key]) throw new Error(`Missing ${key}`);
      count++;
    }
    if (count !== rows.length) throw new Error(`Duplicate ${key}`);
  }
  const transferTime = uint(
    options.defaultTransferTime,
    "default transfer time",
    120,
  );
  const stopIndex = index(stopsRaw, "stop_id");
  const routeIndex = index(routesRaw, "route_id");
  const tripIndex = index(tripsRaw, "trip_id");
  const mint = (kind, context, key) => strategy.mint(kind, context, key);
  const stops = stopsRaw.map((stop) => ({
    stopId: stop.stop_id,
    name: stop.stop_name || null,
    lat: optionalNumber(stop.stop_lat, "latitude", -90, 90),
    lon: optionalNumber(stop.stop_lon, "longitude", -180, 180),
    parentIdx: stop.parent_station
      ? requireIndex(stopIndex, stop.parent_station, "parent station")
      : -1,
    regionIdx: 0,
    iri: mint("stop", { stops: { ...stop, key: stop.stop_id } }, [
      stop.stop_id,
    ]),
    stationIri: null,
    minTransferTime: transferTime,
    platformCode: stop.platform_code || null,
    wheelchairBoarding: enumValue(
      stop.wheelchair_boarding,
      "wheelchair_boarding",
      2,
    ),
  }));
  for (let i = 0; i < stops.length; i++) {
    const seen = new Set();
    let parent = i;
    while (stops[parent].parentIdx !== -1) {
      if (seen.has(parent)) throw new Error("Cyclic stop hierarchy");
      seen.add(parent);
      parent = stops[parent].parentIdx;
    }
    const station = stopsRaw[parent];
    const verified = /^(?:S|00)?(\d{7})$/.exec(station.stop_id);
    if (
      strategy.snapshot.sourceId === "be.sncb" &&
      station.location_type === "1" &&
      verified
    ) {
      stops[i].stationIri = mint(
        "station",
        { stops: { ...station, key: verified[1], uic: verified[1] } },
        [verified[1]],
      );
    } else stops[i].stationIri = stops[parent].iri;
    if (stops[i].parentIdx !== -1)
      stops[i].parentIri = stops[stops[i].parentIdx].iri;
  }
  const { regionOfStop, hubs } = await buildHubRegions({
    sourcePath,
    stopIndex,
    stopLat: stops.map((s) => s.lat),
    stopLon: stops.map((s) => s.lon),
    regionCount: options.regions ?? 1,
  });
  stops.forEach((stop, i) => {
    stop.regionIdx = regionOfStop[i];
  });
  const routes = routesRaw.map((route) => {
    const routeType = uint(route.route_type, "route_type");
    if (routeType > 0x7fffffff) throw new Error("route_type exceeds Int32");
    const agency =
      agencyById.get(route.agency_id || "") ??
      (agencies.length === 1 ? agencies[0] : null);
    if (!agency) throw new Error(`Unknown agency for route: ${route.route_id}`);
    const agencyId = agency.agency_id || "default";
    return {
      routeId: route.route_id,
      shortName: route.route_short_name || null,
      longName: route.route_long_name || null,
      iri: mint("route", { routes: { ...route, key: route.route_id } }, [
        route.route_id,
      ]),
      agencyId,
      agencyIri: mint("agency", { agency: { ...agency, key: agencyId } }, [
        agencyId,
      ]),
      routeType,
    };
  });
  const trips = tripsRaw.map((trip) => {
    const routeIdx = requireIndex(routeIndex, trip.route_id, "route");
    return {
      tripId: trip.trip_id,
      routeIdx,
      routeIri: routes[routeIdx].iri,
      iri: mint(
        "trip",
        { trips: { ...trip, key: trip.trip_id }, routes: routesRaw[routeIdx] },
        [trip.trip_id],
      ),
      headsign: trip.trip_headsign || null,
      shortName: trip.trip_short_name || null,
      shapeIdx: -1,
      geometryIdx: -1,
      directionId: enumValue(trip.direction_id, "direction_id", 1),
      blockId: trip.block_id || null,
      wheelchairAccessible: enumValue(
        trip.wheelchair_accessible,
        "wheelchair_accessible",
        2,
      ),
      bikesAllowed: enumValue(trip.bikes_allowed, "bikes_allowed", 2),
    };
  });
  return {
    stops,
    routes,
    trips,
    stopsRaw,
    routesRaw,
    tripsRaw,
    stopIndex,
    routeIndex,
    tripIndex,
    timeZone,
    agencies,
    hubs,
  };
}
module.exports = { buildDictionaries, requireIndex };
