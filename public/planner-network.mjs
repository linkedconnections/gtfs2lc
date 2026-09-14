const EARTH = 6371000;
const CELL = 1000;
export const WALK_SPEED = 5000 / 3600;

export function buildNetwork(sources, maxWalkMeters) {
  let stopCount = 0;
  let tripCount = 0;
  const selected = sources.map((source) => {
    const networkSource = {
      ...source,
      stopOffset: stopCount,
      tripOffset: tripCount,
    };
    stopCount += source.stops.id.length;
    tripCount += source.manifest.counts.trips;
    return networkSource;
  });
  const root = new Int32Array(stopCount);
  const owner = new Int32Array(stopCount);
  const x = new Float64Array(stopCount).fill(NaN);
  const y = new Float64Array(stopCount);
  const z = new Float64Array(stopCount);
  const roots = [];
  const grid = new Map();
  const key = (a, b, c) => `${a},${b},${c}`;
  for (const [sourceIdx, source] of selected.entries()) {
    const { stops, stopOffset } = source;
    for (let i = 0; i < stops.id.length; i += 1) {
      let parent = i;
      let hops = 0;
      while (
        stops.parentIdx[parent] >= 0 &&
        stops.parentIdx[parent] < stops.id.length
      ) {
        parent = stops.parentIdx[parent];
        if (++hops > stops.id.length)
          throw new Error(`Cyclic stop hierarchy in ${source.id}`);
      }
      root[stopOffset + i] = stopOffset + parent;
      owner[stopOffset + i] = sourceIdx;
    }
    for (let i = 0; i < stops.id.length; i += 1) {
      const r = root[stopOffset + i];
      const lat = stops.lat[i];
      const lon = stops.lon[i];
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        continue;
      if (Number.isFinite(x[r]) && r !== stopOffset + i) continue;
      const phi = (lat * Math.PI) / 180;
      const lambda = (lon * Math.PI) / 180;
      x[r] = EARTH * Math.cos(phi) * Math.cos(lambda);
      y[r] = EARTH * Math.cos(phi) * Math.sin(lambda);
      z[r] = EARTH * Math.sin(phi);
    }
  }
  for (let i = 0; i < stopCount; i += 1)
    if (root[i] === i) {
      roots.push(i);
      if (!Number.isFinite(x[i])) continue;
      const k = key(
        Math.floor(x[i] / CELL),
        Math.floor(y[i] / CELL),
        Math.floor(z[i] / CELL),
      );
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
  // Shared grid lookup: every root stop (or arbitrary point) within
  // maxMeters of (px, py, pz), excluding `self` (a root stop id, or -1
  // for an arbitrary point that is not itself a stop).
  function search(px, py, pz, maxMeters, self) {
    const stops = [];
    const distances = [];
    if (!Number.isFinite(px)) return { stops, distances };
    const radius = Math.ceil(maxMeters / CELL);
    const candidates = [];
    if ((2 * radius + 1) ** 3 > roots.length) candidates.push(roots);
    else {
      const a = Math.floor(px / CELL);
      const b = Math.floor(py / CELL);
      const c = Math.floor(pz / CELL);
      for (let dx = -radius; dx <= radius; dx += 1)
        for (let dy = -radius; dy <= radius; dy += 1)
          for (let dz = -radius; dz <= radius; dz += 1) {
            const cell = grid.get(key(a + dx, b + dy, c + dz));
            if (cell) candidates.push(cell);
          }
    }
    for (const cell of candidates)
      for (const other of cell) {
        if (other === self) continue;
        const chord = Math.hypot(x[other] - px, y[other] - py, z[other] - pz);
        if (chord > maxMeters) continue;
        const meters = 2 * EARTH * Math.asin(Math.min(1, chord / (2 * EARTH)));
        if (meters <= maxMeters) {
          stops.push(other);
          distances.push(meters);
        }
      }
    return { stops, distances };
  }

  const cachedNeighbors = new Map();
  function neighbors(stop) {
    stop = root[stop];
    if (cachedNeighbors.has(stop)) return cachedNeighbors.get(stop);
    const found = search(x[stop], y[stop], z[stop], maxWalkMeters, stop);
    const result = {
      stops: Int32Array.from([stop, ...found.stops]),
      meters: Float64Array.from([0, ...found.distances]),
    };
    cachedNeighbors.set(stop, result);
    return result;
  }

  // Arbitrary map click, not necessarily a stop: every root stop within
  // maxMeters of (lat, lon), used to seed an isochrone from a clicked point.
  function pointNeighbors(lat, lon, maxMeters) {
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return { stops: new Int32Array(0), meters: new Float64Array(0) };
    const phi = (lat * Math.PI) / 180;
    const lambda = (lon * Math.PI) / 180;
    const px = EARTH * Math.cos(phi) * Math.cos(lambda);
    const py = EARTH * Math.cos(phi) * Math.sin(lambda);
    const pz = EARTH * Math.sin(phi);
    const found = search(px, py, pz, maxMeters, -1);
    return {
      stops: Int32Array.from(found.stops),
      meters: Float64Array.from(found.distances),
    };
  }
  const globalStop = ({ sourceId, stopIdx }) => {
    const source = selected.find((s) => s.id === sourceId);
    if (
      !source ||
      !Number.isInteger(stopIdx) ||
      stopIdx < 0 ||
      stopIdx >= source.stops.id.length
    )
      throw new Error("Unknown stop or inactive source");
    return root[source.stopOffset + stopIdx];
  };
  const localStop = (stop) => {
    const source = selected[owner[stop]];
    return { sourceId: source.id, stopIdx: stop - source.stopOffset };
  };
  return {
    sources: selected,
    root,
    owner,
    stopCount,
    neighbors,
    pointNeighbors,
    globalStop,
    localStop,
  };
}
