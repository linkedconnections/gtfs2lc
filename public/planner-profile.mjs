import { scanBackward, timeAt } from "./planner-data.mjs";
import { WALK_SPEED } from "./planner-network.mjs";

// Query-local structure of arrays. Only retained labels allocate a slot.
export class ProfileStore {
  constructor(stopCount) {
    this.profiles = new Array(stopCount);
    this.length = 0;
    this.lookups = 0;
    this.lookupHits = 0;
    this.capacity = 0;
    this.grow();
  }
  grow() {
    this.capacity = this.capacity ? this.capacity * 2 : 4096;
    for (const name of [
      "dep",
      "arrival",
      "alightTime",
      "meters",
      "boardStop",
      "alightStop",
      "trip",
      "next",
      "rides",
      "kind",
    ]) {
      const Type = ["dep", "arrival", "alightTime", "meters"].includes(name)
        ? Float64Array
        : Int32Array;
      const next = new Type(this.capacity);
      if (this[name]) next.set(this[name]);
      this[name] = next;
    }
  }
  add(
    dep,
    arrival,
    boardStop,
    alightStop,
    alightTime,
    trip,
    next,
    rides,
    kind = 0,
    meters = 0,
  ) {
    if (this.length === this.capacity) this.grow();
    const id = this.length++;
    this.dep[id] = dep;
    this.arrival[id] = arrival;
    this.boardStop[id] = boardStop;
    this.alightStop[id] = alightStop;
    this.alightTime[id] = alightTime;
    this.trip[id] = trip;
    this.next[id] = next;
    this.rides[id] = rides;
    this.kind[id] = kind;
    this.meters[id] = meters;
    return id;
  }
  bound(list, field, value, upper = false) {
    let lo = 0;
    let hi = list.length;
    const values = this[field];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (values[list[mid]] < value || (upper && values[list[mid]] === value))
        lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  lookup(list, time) {
    this.lookups += 1;
    if (!list.length) return -1;
    if (list.cached && time > list.lower && time <= list.upper) {
      this.lookupHits += 1;
      return list.cachedId;
    }
    const index = this.bound(list, "dep", time);
    list.lower = index ? this.dep[list[index - 1]] : -Infinity;
    list.upper = index < list.length ? this.dep[list[index]] : Infinity;
    list.cachedId = index < list.length ? list[index] : -1;
    list.cached = true;
    return list.cachedId;
  }
  dominated(stop, dep, arrival, rides) {
    const groups = this.profiles[stop];
    if (!groups) return false;
    for (const [count, list] of groups) {
      if (count > rides) continue;
      const i = this.bound(list, "dep", dep);
      if (i < list.length && this.arrival[list[i]] <= arrival) return true;
    }
    return false;
  }
  insert(stop, id, check = true) {
    const dep = this.dep[id];
    const arrival = this.arrival[id];
    const rides = this.rides[id];
    if (check && this.dominated(stop, dep, arrival, rides)) return false;
    const groups = (this.profiles[stop] ??= new Map());
    groups.minArrival = Math.min(groups.minArrival ?? Infinity, arrival);
    groups.minRides = Math.min(groups.minRides ?? Infinity, rides);
    for (const [count, list] of groups) {
      if (count < rides) continue;
      const lo = this.bound(list, "arrival", arrival);
      const hi = this.bound(list, "dep", dep, true);
      if (hi > lo) {
        list.splice(lo, hi - lo);
        list.cached = false;
      }
    }
    if (!groups.has(rides)) groups.set(rides, []);
    const list = groups.get(rides);
    list.splice(this.bound(list, "dep", dep), 0, id);
    list.cached = false;
    return true;
  }
}

export function computeProfile(
  batches,
  network,
  origin,
  destination,
  from,
  to,
) {
  const store = new ProfileStore(network.stopCount + 1);
  const tripBest = new Map();
  const egress = new Map();
  const endNeighbors = network.neighbors(destination);
  for (let i = 0; i < endNeighbors.stops.length; i += 1)
    egress.set(endNeighbors.stops[i], endNeighbors.meters[i]);
  // Reused scratch frontier: no candidate object allocated per scanned label.
  const arrivals = [],
    rides = [],
    kinds = [],
    refs = [],
    walking = [],
    targets = [];
  function candidateDominates(arrival, count) {
    for (let i = 0; i < arrivals.length; i += 1)
      if (arrivals[i] <= arrival && rides[i] <= count) return true;
    return false;
  }
  function offer(arrival, count, kind, ref, meters = 0, target = -1) {
    for (let i = 0; i < arrivals.length; i += 1)
      if (arrivals[i] <= arrival && rides[i] <= count) return;
    for (let i = arrivals.length - 1; i >= 0; i -= 1)
      if (arrival <= arrivals[i] && count <= rides[i]) {
        arrivals.splice(i, 1);
        rides.splice(i, 1);
        kinds.splice(i, 1);
        refs.splice(i, 1);
        walking.splice(i, 1);
        targets.splice(i, 1);
      }
    arrivals.push(arrival);
    rides.push(count);
    kinds.push(kind);
    refs.push(ref);
    walking.push(meters);
    targets.push(target);
  }
  let currentTime = NaN;
  let equalTimeTrips = new Map();
  let acceptedRows = 0;
  let relaxations = 0;
  const scanned = scanBackward(batches, from, to, (batch, row, dep) => {
    relaxations += 1;
    const arr = timeAt(batch, "arr", row);
    if (arr > to || arr < dep) return false;
    acceptedRows += 1;
    if (dep !== currentTime) {
      currentTime = dep;
      equalTimeTrips = new Map();
    }
    const { source } = batch;
    const dS = source.stopOffset + batch.dS[row];
    const aS = source.stopOffset + batch.aS[row];
    const dRoot = network.root[dS];
    const aRoot = network.root[aS];
    const trip = source.tripOffset + batch.trip[row];
    arrivals.length =
      rides.length =
      kinds.length =
      refs.length =
      walking.length =
      targets.length =
        0;
    const previous =
      arr === dep
        ? equalTimeTrips.get(trip)?.get(aS) || tripBest.get(trip)
        : tripBest.get(trip);
    if (previous && previous.stop === aS && previous.time >= arr)
      for (const id of previous.options)
        offer(store.arrival[id], store.rides[id], 1, id);
    if (batch.dropOff?.[row] !== 1) {
      const meters = egress.get(aRoot);
      if (meters !== undefined && arr + meters / WALK_SPEED <= to)
        offer(arr + meters / WALK_SPEED, 1, 0, meters);
      const neighbors = network.neighbors(aRoot);
      for (let n = 0; n < neighbors.stops.length; n += 1) {
        const stop = neighbors.stops[n];
        const groups = store.profiles[stop];
        if (
          !groups ||
          candidateDominates(groups.minArrival, groups.minRides + 1)
        )
          continue;
        const ready = arr + neighbors.meters[n] / WALK_SPEED;
        for (const [count, list] of groups) {
          if (
            !list.length ||
            candidateDominates(store.arrival[list[0]], count + 1)
          )
            continue;
          const id = store.lookup(list, ready);
          if (id !== -1)
            offer(
              store.arrival[id],
              count + 1,
              2,
              id,
              neighbors.meters[n],
              stop,
            );
        }
      }
    }

    if (!arrivals.length) return false;
    let changed = false;
    const options = [];
    for (let i = 0; i < arrivals.length; i += 1) {
      const boardable =
        batch.pickup?.[row] !== 1 &&
        !store.dominated(dRoot, dep, arrivals[i], rides[i]);
      if (kinds[i] === 1 && !boardable) {
        options.push(refs[i]);
        continue;
      }
      let alight = aS;
      let alightTime = arr;
      let next = -1;
      if (kinds[i] === 1) {
        alight = store.alightStop[refs[i]];
        alightTime = store.alightTime[refs[i]];
        next = store.next[refs[i]];
      } else if (kinds[i] === 2) {
        next = refs[i];
        if (targets[i] !== aRoot)
          next = store.add(
            arr,
            arrivals[i],
            aRoot,
            targets[i],
            arr + walking[i] / WALK_SPEED,
            -1,
            next,
            rides[i] - 1,
            1,
            walking[i],
          );
      } else if (refs[i] > 0 || aRoot !== destination)
        next = store.add(
          arr,
          arrivals[i],
          aRoot,
          destination,
          arrivals[i],
          -1,
          -1,
          0,
          1,
          refs[i],
        );
      const id = store.add(
        dep,
        arrivals[i],
        dS,
        alight,
        alightTime,
        trip,
        next,
        rides[i],
      );
      options.push(id);
      if (boardable) changed = store.insert(dRoot, id, false) || changed;
    }
    const state = { stop: dS, time: dep, options };
    if (!equalTimeTrips.has(trip)) equalTimeTrips.set(trip, new Map());
    const sameTime = equalTimeTrips.get(trip);
    const old = sameTime.get(dS);
    if (
      !old ||
      options.some(
        (id) =>
          !old.options.some(
            (other) =>
              store.arrival[other] <= store.arrival[id] &&
              store.rides[other] <= store.rides[id],
          ),
      )
    ) {
      sameTime.set(dS, state);
      changed = true;
    }
    tripBest.set(trip, state);
    return changed;
  });
  // Resolve walking access once, after the scan. Intermediate walking was
  // resolved at arrival lookup, avoiding a label copy at every nearby stop.
  const originProfile = network.stopCount;
  const access = network.neighbors(origin);
  for (let n = 0; n < access.stops.length; n += 1) {
    const stop = access.stops[n];
    for (const list of store.profiles[stop]?.values() || [])
      for (const id of list) {
        const dep = store.dep[id] - access.meters[n] / WALK_SPEED;
        if (
          dep < from ||
          store.dominated(
            originProfile,
            dep,
            store.arrival[id],
            store.rides[id],
          )
        )
          continue;
        const entry =
          stop === origin
            ? id
            : store.add(
                dep,
                store.arrival[id],
                origin,
                stop,
                store.dep[id],
                -1,
                id,
                store.rides[id],
                1,
                access.meters[n],
              );
        store.insert(originProfile, entry);
      }
  }
  const meters = egress.get(origin);
  if (meters !== undefined && from + meters / WALK_SPEED <= to) {
    // Walking-only journeys do not have a meaningful latest departure. Show
    // the option starting at the requested time alongside scheduled profiles.
    store.insert(
      originProfile,
      store.add(
        from,
        from + meters / WALK_SPEED,
        origin,
        destination,
        from + meters / WALK_SPEED,
        -1,
        -1,
        0,
        1,
        meters,
      ),
    );
  }
  const candidates = [];
  for (const list of store.profiles[originProfile]?.values() || [])
    for (const id of list) candidates.push(id);
  candidates.sort(
    (a, b) =>
      store.dep[a] - store.dep[b] || store.arrival[a] - store.arrival[b],
  );
  const options = candidates.slice(0, 6).map((id) => {
    const legs = [];
    for (let entry = id; entry !== -1; entry = store.next[entry]) {
      const board = network.localStop(store.boardStop[entry]);
      const alight = network.localStop(store.alightStop[entry]);
      if (store.kind[entry] === 1) {
        if (
          store.meters[entry] ||
          board.sourceId !== alight.sourceId ||
          board.stopIdx !== alight.stopIdx
        )
          legs.push({
            kind: "walk",
            from: board,
            to: alight,
            boardTime: store.dep[entry],
            alightTime: store.alightTime[entry],
            distanceMeters: store.meters[entry],
          });
      } else {
        const source = network.sources[network.owner[store.boardStop[entry]]];
        legs.push({
          kind: "ride",
          sourceId: source.id,
          trip: store.trip[entry] - source.tripOffset,
          boardStop: board.stopIdx,
          alightStop: alight.stopIdx,
          boardTime: store.dep[entry],
          alightTime: store.alightTime[entry],
        });
      }
    }
    return {
      departure: store.dep[id],
      arrival: store.arrival[id],
      transfers: Math.max(0, store.rides[id] - 1),
      legs,
    };
  });
  return {
    found: options.length > 0,
    options,
    totalOptions: candidates.length,
    scanned,
    diagnostics: {
      labels: store.length,
      relaxations,
      acceptedRows,
      lookups: store.lookups,
      lookupHits: store.lookupHits,
    },
  };
}
