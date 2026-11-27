const { readCsv, uint } = require("./io");
const { requireIndex } = require("./dictionaries");

async function buildExtras(sourcePath, dictionaries, strategy) {
  const { stops, stopIndex, trips, tripIndex, routeIndex, routes, stopsRaw } =
    dictionaries;
  const transfers = [];
  const seen = new Set();
  for await (const row of readCsv(sourcePath, "transfers.txt")) {
    const transferType = uint(row.transfer_type, "transfer_type", 0);
    if (transferType > 5) throw new Error("Unsupported transfer_type");
    const linked = transferType >= 4;
    const stopIdx = (key) =>
      linked && !key ? null : requireIndex(stopIndex, key, "transfer stop");
    const fromStopIdx = stopIdx(row.from_stop_id);
    const toStopIdx = stopIdx(row.to_stop_id);
    if (
      linked &&
      [fromStopIdx, toStopIdx].some(
        (idx) =>
          idx !== null &&
          !["", "0", undefined].includes(stopsRaw[idx].location_type),
      )
    )
      throw new Error(
        "Linked-trip transfer endpoints must be stops, not stations",
      );
    const minTransferTime = row.min_transfer_time
      ? uint(row.min_transfer_time, "min_transfer_time")
      : null;
    if (transferType === 2 && minTransferTime === null)
      throw new Error("Type-2 transfer requires min_transfer_time");
    if (linked && minTransferTime !== null)
      throw new Error("Linked-trip transfer min_transfer_time must be null");
    if (linked && (!row.from_trip_id || !row.to_trip_id))
      throw new Error("Linked-trip transfer requires both trips");
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
      row.from_stop_id || "",
      row.to_stop_id || "",
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
      fromStopIri: fromStopIdx === null ? null : stops[fromStopIdx].iri,
      toStopIri: toStopIdx === null ? null : stops[toStopIdx].iri,
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
  return { transfers };
}
module.exports = { buildExtras };
