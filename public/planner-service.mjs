export function createPlannerService(planner) {
  let sources = [];
  async function labelLegs(source, legs) {
    if (!legs.length) return;
    source.labels ??= Promise.all([
      planner.loadSmallTable(source.baseUrl + source.manifest.files.trips),
      planner.loadSmallTable(source.baseUrl + source.manifest.files.routes),
    ]).catch((error) => {
      source.labels = undefined;
      throw error;
    });
    const [trips, routes] = await source.labels;
    for (const leg of legs) {
      const route = trips.getChild("routeIdx").get(leg.trip);
      leg.routeName =
        routes.getChild("shortName").get(route) ||
        routes.getChild("longName").get(route) ||
        "";
      leg.headsign = trips.getChild("headsign").get(leg.trip) || "";
    }
  }
  return async function handle(type, payload, onProgress) {
    if (type === "init") {
      const descriptors = await planner.discoverSources();
      const results = await Promise.allSettled(
        descriptors.map(planner.loadSource),
      );
      sources = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
      for (const r of results)
        if (r.status === "rejected") console.error(r.reason);
      if (!sources.length) throw new Error("No source could be loaded");
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        manifest: { counts: source.manifest.counts },
        stops: { id: source.stops.id, name: source.stops.name },
        stopFamily: { searchable: source.stopFamily.searchable },
      }));
    }
    if (type !== "plan" && type !== "isochrone")
      throw new Error(`Unknown planner request: ${type}`);
    const active = new Set(payload.sourceIds || sources.map((s) => s.id));
    const selected = sources.filter((s) => active.has(s.id));
    if (type === "isochrone") {
      const result = await planner.planIsochrone({
        ...payload,
        sources: selected,
        onProgress,
      });
      const bySource = new Map(selected.map((s) => [s.id, s]));
      const points = result.reachable
        .map((r) => {
          const source = bySource.get(r.sourceId);
          return {
            sourceId: r.sourceId,
            name: source.stops.name[r.stopIdx] || source.stops.id[r.stopIdx],
            lat: source.stops.lat[r.stopIdx],
            lon: source.stops.lon[r.stopIdx],
            durationSeconds: r.durationSeconds,
          };
        })
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      return {
        found: result.found,
        noAccess: result.noAccess,
        origin: result.origin,
        points,
        scanned: result.scanned,
      };
    }
    const result = await planner.planJourneys({
      ...payload,
      sources: selected,
      onProgress,
    });
    onProgress?.({ phase: "labels" });
    await Promise.all(
      selected.map((source) =>
        labelLegs(
          source,
          result.options.flatMap((o) =>
            o.legs.filter(
              (leg) => leg.kind === "ride" && leg.sourceId === source.id,
            ),
          ),
        ),
      ),
    );
    return result;
  };
}
