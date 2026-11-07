const { readCsv, uint, optionalNumber } = require("./io");
const { requireIndex } = require("./dictionaries");

async function buildExtras(sourcePath, dictionaries, strategy, publish) {
  const { stops, stopIndex, trips, tripIndex, routeIndex, routes, tripsRaw } =
    dictionaries;
  const shapes = new Map();
  for await (const point of readCsv(sourcePath, "shapes.txt")) {
    if (!point.shape_id) throw new Error("Missing shape_id");
    const points = shapes.get(point.shape_id) ?? [];
    points.push({
      sequence: uint(point.shape_pt_sequence, "shape sequence"),
      lat: optionalNumber(point.shape_pt_lat, "shape latitude", -90, 90),
      lon: optionalNumber(point.shape_pt_lon, "shape longitude", -180, 180),
      distance: optionalNumber(point.shape_dist_traveled, "shape distance", 0),
    });
    shapes.set(point.shape_id, points);
  }
  const shapeRows = [];
  for (const [key, points] of [...shapes].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    points.sort((a, b) => a.sequence - b.sequence);
    if (
      points.length < 2 ||
      points.some(
        (p, i) =>
          p.lat === null ||
          p.lon === null ||
          (i && p.sequence === points[i - 1].sequence),
      )
    )
      throw new Error(`Invalid shape: ${key}`);
    const iri = strategy.mint("shape", { shapes: { key, shape_id: key } }, [
      key,
    ]);
    const name = `shapes/${String(shapeRows.length).padStart(5, "0")}.arrow`;
    for (const point of points) {
      point.iri = strategy.mint(
        "entity",
        { entity: { kind: "shape-points", key: `${key}/${point.sequence}` } },
        ["shape-points", `${key}/${point.sequence}`],
      );
      point.shapeIri = iri;
    }
    const descriptor = await publish("shapePoints", name, points);
    shapeRows.push({
      shapeId: key,
      iri,
      path: descriptor.path,
      pointCount: points.length,
    });
    shapes.delete(key);
  }
  const shapeIndex = new Map(shapeRows.map((row, i) => [row.shapeId, i]));
  trips.forEach((trip, i) => {
    const key = tripsRaw[i].shape_id;
    if (key && !shapeIndex.has(key)) throw new Error(`Unknown shape: ${key}`);
    if (key) {
      trip.shapeIdx = shapeIndex.get(key);
      trip.shapeIri = shapeRows[trip.shapeIdx].iri;
    }
  });
  const transfers = [];
  const seen = new Set();
  for await (const row of readCsv(sourcePath, "transfers.txt")) {
    const fromStopIdx = requireIndex(
      stopIndex,
      row.from_stop_id,
      "transfer stop",
    );
    const toStopIdx = requireIndex(stopIndex, row.to_stop_id, "transfer stop");
    const transferType = uint(row.transfer_type, "transfer_type", 0);
    if (transferType > 3)
      throw new Error(
        "Linked-trip transfers (types 4/5) require a separate extension",
      );
    const minTransferTime = row.min_transfer_time
      ? uint(row.min_transfer_time, "min_transfer_time")
      : null;
    if (transferType === 2 && minTransferTime === null)
      throw new Error("Type-2 transfer requires min_transfer_time");
    const selectors = {};
    for (const [prefix, table, map] of [
      ["Trip", trips, tripIndex],
      ["Route", routes, routeIndex],
    ]) {
      for (const side of ["from", "to"]) {
        const raw = row[`${side}_${prefix.toLowerCase()}_id`];
        if (raw) {
          const idx = requireIndex(map, raw, `transfer ${prefix}`);
          selectors[`${side}${prefix}Idx`] = idx;
          selectors[`${side}${prefix}Iri`] = table[idx].iri;
        }
      }
    }
    const key = JSON.stringify([
      row.from_stop_id,
      row.to_stop_id,
      row.from_trip_id || "",
      row.to_trip_id || "",
      row.from_route_id || "",
      row.to_route_id || "",
    ]);
    if (seen.has(key)) throw new Error("Duplicate transfer selectors");
    seen.add(key);
    transfers.push({
      iri: strategy.mint("entity", { entity: { kind: "transfers", key } }, [
        "transfers",
        key,
      ]),
      fromStopIdx,
      toStopIdx,
      fromStopIri: stops[fromStopIdx].iri,
      toStopIri: stops[toStopIdx].iri,
      transferType,
      minTransferTime,
      ...selectors,
    });
    if (
      fromStopIdx === toStopIdx &&
      transferType === 2 &&
      !Object.keys(selectors).length
    )
      stops[fromStopIdx].minTransferTime = minTransferTime;
  }
  return { shapes: shapeRows, transfers };
}
module.exports = { buildExtras };
