import { scanForward, timeAt } from "./planner-data.mjs";
import { WALK_SPEED } from "./planner-network.mjs";

// One-to-many earliest arrival, forward CSA: classic Dibbelt et al. scan —
// a connection is usable once its departure stop is reachable by its
// departure time, or its trip is already boarded — kept to a single
// criterion (arrival time) since an isochrone has no destination to trade
// transfers against.
export function computeIsochrone(
  batches,
  network,
  origin,
  from,
  to,
  maxWalkMeters,
) {
  const arrival = new Float64Array(network.stopCount).fill(Infinity);
  const tripReachable = new Set();

  // Walking is resolved eagerly, not just at the end (unlike the profile
  // scan): later connections need to see an already-improved neighbor's
  // arrival time, since jobs aren't grouped per stop here.
  function relaxWalking(stop) {
    const stack = [stop];
    while (stack.length) {
      const current = stack.pop();
      const neighbors = network.neighbors(current);
      for (let n = 0; n < neighbors.stops.length; n += 1) {
        const other = neighbors.stops[n];
        const candidate = arrival[current] + neighbors.meters[n] / WALK_SPEED;
        if (candidate < arrival[other]) {
          arrival[other] = candidate;
          stack.push(other);
        }
      }
    }
  }

  const access = network.pointNeighbors(origin.lat, origin.lon, maxWalkMeters);
  for (let n = 0; n < access.stops.length; n += 1) {
    const stop = access.stops[n];
    const candidate = from + access.meters[n] / WALK_SPEED;
    if (candidate < arrival[stop]) arrival[stop] = candidate;
  }
  for (let n = 0; n < access.stops.length; n += 1)
    relaxWalking(access.stops[n]);

  const scanned = access.stops.length
    ? scanForward(batches, from, to, (batch, row, dep) => {
        const arr = timeAt(batch, "arr", row);
        if (arr > to) return false;
        const { source } = batch;
        const dS = source.stopOffset + batch.dS[row];
        const aS = source.stopOffset + batch.aS[row];
        const dRoot = network.root[dS];
        const aRoot = network.root[aS];
        const trip = source.tripOffset + batch.trip[row];
        const canBoard = batch.pickup?.[row] !== 1 && arrival[dRoot] <= dep;
        if (!canBoard && !tripReachable.has(trip)) return false;
        let changed = false;
        if (canBoard && !tripReachable.has(trip)) {
          tripReachable.add(trip);
          changed = true;
        }
        if (batch.dropOff?.[row] === 1) return changed;
        if (arr < arrival[aRoot]) {
          arrival[aRoot] = arr;
          relaxWalking(aRoot);
          changed = true;
        }
        return changed;
      })
    : 0;

  const reachable = [];
  for (let stop = 0; stop < network.stopCount; stop += 1) {
    if (network.root[stop] !== stop || !Number.isFinite(arrival[stop]))
      continue;
    const { sourceId, stopIdx } = network.localStop(stop);
    reachable.push({
      sourceId,
      stopIdx,
      arrival: arrival[stop],
      durationSeconds: arrival[stop] - from,
    });
  }
  reachable.sort((a, b) => a.durationSeconds - b.durationSeconds);

  return {
    found: reachable.length > 0,
    noAccess: access.stops.length === 0,
    origin,
    from,
    to,
    reachable,
    scanned,
  };
}
