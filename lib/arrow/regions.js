const fs = require("node:fs");
const csv = require("fast-csv");

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * One pass over stop_times.txt to learn which trips call at each stop —
 * exactly the input the Hub method needs, and cheap enough to read again
 * here since it's a plain streaming count, not the full connection-rule
 * expansion StopTimes2Cxs performs.
 */
async function buildStopTripSets(sourcePath, stopIndex) {
  const stopTrips = new Map(); // stopIdx -> Set<trip_id>
  const stream = fs
    .createReadStream(`${sourcePath}/stop_times.txt`, { encoding: "utf8" })
    .pipe(csv.parse({ headers: true }));
  for await (const row of stream) {
    const stopIdx = stopIndex.get(row.stop_id);
    if (stopIdx === undefined) continue;
    let trips = stopTrips.get(stopIdx);
    if (!trips) {
      trips = new Set();
      stopTrips.set(stopIdx, trips);
    }
    trips.add(row.trip_id);
  }
  return stopTrips;
}

/**
 * Harm Delva et al.'s Hub method (see arrowconnections.md for the
 * reference): greedily picks the stop covering the most as-yet-uncovered
 * trips, `regionCount` times. Chosen over k-means/METIS because it needs no
 * extra dependency and the paper found it (and its merge-based variant)
 * performed best of the methods it compared.
 */
function selectHubs(stopTrips, regionCount) {
  const doneTrips = new Set();
  const hubs = [];
  for (let round = 0; round < regionCount; round += 1) {
    let bestStop = null;
    let bestScore = 0;
    for (const [stopIdx, trips] of stopTrips) {
      let score = 0;
      for (const trip of trips) if (!doneTrips.has(trip)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        bestStop = stopIdx;
      }
    }
    if (bestStop === null) break; // every trip is already covered by a hub
    hubs.push(bestStop);
    for (const trip of stopTrips.get(bestStop)) doneTrips.add(trip);
  }
  return hubs;
}

/**
 * Assigns every stop to its nearest hub by straight-line distance — the
 * discrete equivalent of taking the Voronoi diagram of the hub points.
 */
function assignRegions(stopLat, stopLon, hubStopIndices) {
  const regionOfStop = new Int32Array(stopLat.length);
  for (let i = 0; i < stopLat.length; i += 1) {
    if (!Number.isFinite(stopLat[i]) || !Number.isFinite(stopLon[i])) {
      regionOfStop[i] = 0; // no coordinates to go on; group with the first region
      continue;
    }
    let best = 0;
    let bestDistanceKm = Infinity;
    for (let region = 0; region < hubStopIndices.length; region += 1) {
      const hubIdx = hubStopIndices[region];
      const distanceKm = haversineKm(
        stopLat[i],
        stopLon[i],
        stopLat[hubIdx],
        stopLon[hubIdx],
      );
      if (distanceKm < bestDistanceKm) {
        bestDistanceKm = distanceKm;
        best = region;
      }
    }
    regionOfStop[i] = best;
  }
  return regionOfStop;
}

/**
 * Computes a fixed, precomputed geospatial partitioning of every stop into
 * `regionCount` regions. `regionCount <= 1` disables partitioning (every
 * stop lands in region 0).
 */
async function buildHubRegions({
  sourcePath,
  stopIndex,
  stopLat,
  stopLon,
  regionCount,
}) {
  if (regionCount <= 1) {
    return {
      regionOfStop: new Int32Array(stopLat.length),
      hubs: [{ stopIdx: null, lat: null, lon: null }],
    };
  }
  const stopTrips = await buildStopTripSets(sourcePath, stopIndex);
  const hubStopIndices = selectHubs(stopTrips, regionCount);
  const regionOfStop = assignRegions(stopLat, stopLon, hubStopIndices);
  const hubs = hubStopIndices.map((stopIdx) => ({
    stopIdx,
    lat: stopLat[stopIdx],
    lon: stopLon[stopIdx],
  }));
  return { regionOfStop, hubs };
}

module.exports = { buildHubRegions };
