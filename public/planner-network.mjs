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
  const cachedNeighbors = new Map();
  function neighbors(stop) {
    stop = root[stop];
    if (cachedNeighbors.has(stop)) return cachedNeighbors.get(stop);
    const stops = [stop];
    const distances = [0];
    const radius = Math.ceil(maxWalkMeters / CELL);
    const candidates = [];
    if (Number.isFinite(x[stop])) {
      if ((2 * radius + 1) ** 3 > roots.length) candidates.push(roots);
      else {
        const a = Math.floor(x[stop] / CELL);
        const b = Math.floor(y[stop] / CELL);
        const c = Math.floor(z[stop] / CELL);
        for (let dx = -radius; dx <= radius; dx += 1)
          for (let dy = -radius; dy <= radius; dy += 1)
            for (let dz = -radius; dz <= radius; dz += 1) {
              const cell = grid.get(key(a + dx, b + dy, c + dz));
              if (cell) candidates.push(cell);
            }
      }
      for (const cell of candidates)
        for (const other of cell) {
          if (other === stop) continue;
          const chord = Math.hypot(
            x[other] - x[stop],
            y[other] - y[stop],
            z[other] - z[stop],
          );
          if (chord > maxWalkMeters) continue;
          const meters =
            2 * EARTH * Math.asin(Math.min(1, chord / (2 * EARTH)));
          if (meters <= maxWalkMeters) {
            stops.push(other);
            distances.push(meters);
          }
        }
    }
    const result = {
      stops: Int32Array.from(stops),
      meters: Float64Array.from(distances),
    };
    cachedNeighbors.set(stop, result);
    return result;
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
    globalStop,
    localStop,
  };
}
