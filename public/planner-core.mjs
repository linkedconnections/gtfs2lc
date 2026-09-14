import { readConnectionBatches, PageCache } from "./planner-data.mjs";
import { buildNetwork } from "./planner-network.mjs";
import { computeProfile } from "./planner-profile.mjs";
import { computeIsochrone } from "./planner-isochrone.mjs";

export function createPlanner(
  { tableFromIPC, RecordBatchReader },
  { loadPage, cacheBytes } = {},
) {
  const cache = new PageCache(cacheBytes);
  let previousNetwork;
  let previousSources;
  let previousWalk;
  async function fetchResponse(url) {
    // Force a real network request every time: this page is meant to
    // be reloaded against locally-regenerated data (a new gtfs2lc run
    // writes the same file names), and a browser HTTP cache serving a
    // stale, previously-fetched version of a connections file looks
    // exactly like "no route found" with no error anywhere.
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok)
      throw new Error(`Could not fetch ${url}: HTTP ${response.status}`);
    return response;
  }

  async function loadSmallTable(url) {
    return tableFromIPC(await fetchResponse(url));
  }

  function columnToStringArray(table, name) {
    const vector = table.getChild(name);
    const values = new Array(table.numRows);
    for (let i = 0; i < table.numRows; i += 1) values[i] = vector.get(i);
    return values;
  }

  function columnToTypedArray(table, name) {
    return table.getChild(name).toArray();
  }

  // `parentIdx`/`regionIdx` were added to stops.arrow after this
  // format's first releases. An older stops.arrow has no such column —
  // getChild() returns null rather than throwing — so treat that as
  // "no station hierarchy / no partitioning known" instead of crashing.
  function columnToTypedArrayOrDefault(table, name, fallbackValue) {
    const vector = table.getChild(name);
    if (vector) return vector.toArray();
    console.warn(
      `stops.arrow has no '${name}' column — regenerate with a newer gtfs2lc.`,
    );
    return new Int32Array(table.numRows).fill(fallbackValue);
  }

  /**
   * Discovers which sources (independently-generated gtfs2lc datasets,
   * e.g. one per operator) are available. A `sources.json` next to this
   * page lists them; if there is none, this page falls back to
   * treating its own directory as the one and only source, so existing
   * single-source setups keep working unchanged.
   */
  async function discoverSources() {
    try {
      const response = await fetch("sources.json", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json();
        return data.sources.map((source) => ({
          id: source.id,
          name: source.name || source.id,
          manifestUrl: source.manifest,
        }));
      }
    } catch {
      // fall through to the single-source default below
    }
    return [{ id: "default", name: "This feed", manifestUrl: "manifest.json" }];
  }

  function baseUrlOf(manifestUrl) {
    const slash = manifestUrl.lastIndexOf("/");
    return slash === -1 ? "" : manifestUrl.slice(0, slash + 1);
  }

  /**
   * Groups child stops (platforms, boarding areas, ...) under their GTFS
   * `parent_station`, and lists which stops are worth offering in a
   * search box: a real station, or a standalone stop with no hierarchy
   * at all — never a child stop directly, since no connection ever
   * departs from or arrives at a station-level row (see
   * arrowconnections.md).
   */
  function buildStopFamily(stops) {
    const childrenOf = new Map();
    const searchable = [];
    for (let i = 0; i < stops.id.length; i += 1) {
      const parent = stops.parentIdx[i];
      if (parent === -1) {
        searchable.push(i);
        continue;
      }
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(i);
    }
    return { childrenOf, searchable };
  }

  async function loadSource(descriptor) {
    const manifest = await (await fetchResponse(descriptor.manifestUrl)).json();
    const baseUrl = baseUrlOf(descriptor.manifestUrl);

    const stopsTable = await loadSmallTable(baseUrl + manifest.files.stops);

    const stops = {
      id: columnToStringArray(stopsTable, "stopId"),
      name: columnToStringArray(stopsTable, "name"),
      lat: columnToTypedArray(stopsTable, "lat"),
      lon: columnToTypedArray(stopsTable, "lon"),
      parentIdx: columnToTypedArrayOrDefault(stopsTable, "parentIdx", -1),
      regionIdx: columnToTypedArrayOrDefault(stopsTable, "regionIdx", 0),
    };
    return {
      id: descriptor.id,
      name: descriptor.name,
      baseUrl,
      manifest,
      stops,
      stopFamily: buildStopFamily(stops),
    };
  }

  // Every "YYYY-MM" (UTC) month that overlaps [startSeconds, endSeconds).
  function monthsInRange(startSeconds, endSeconds) {
    const months = [];
    let cursor = new Date(startSeconds * 1000);
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1),
    );
    const endMonth = new Date(endSeconds * 1000);
    while (cursor.getTime() < endMonth.getTime()) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      );
    }
    return months;
  }

  // Version 3 used calendar months. Version 4 declares fixed UTC buckets.
  function partitionsInRange(manifest, startSeconds, endSeconds) {
    const seconds = manifest.connections.timePartitionSeconds;
    if (seconds === undefined) return monthsInRange(startSeconds, endSeconds);
    if (seconds !== 6 * 3600)
      throw new Error(`Unsupported time partition size: ${seconds}`);
    const keys = [];
    for (
      let time = Math.floor(startSeconds / seconds) * seconds;
      time < endSeconds;
      time += seconds
    ) {
      keys.push(new Date(time * 1000).toISOString().slice(0, 13));
    }
    return keys;
  }

  function ensureNetwork(sources, maxWalkMeters) {
    if (
      !previousNetwork ||
      previousWalk !== maxWalkMeters ||
      sources.length !== previousSources.length ||
      sources.some((s, i) => s !== previousSources[i])
    ) {
      previousNetwork = buildNetwork(sources, maxWalkMeters);
      previousSources = sources.slice();
      previousWalk = maxWalkMeters;
    }
    return previousNetwork;
  }

  // Schedules and loads every page whose departure bounds can overlap
  // [departureAfter, to) across a network's sources, with bounded
  // concurrency and the shared page cache. Shared by journey planning
  // (one OD pair, 24h window) and isochrones (one origin, all destinations,
  // a shorter window).
  async function loadBatches(network, departureAfter, to, onProgress) {
    const jobs = [];
    for (const source of network.sources) {
      const periods = partitionsInRange(source.manifest, departureAfter, to);
      const connections = source.manifest.connections;
      if (source.manifest.version >= 5) {
        for (const byPeriod of Object.values(connections.pages))
          for (const period of periods) {
            for (const page of byPeriod[period] || []) {
              if (
                page.maxDepartureTime < departureAfter ||
                page.minDepartureTime >= to
              )
                continue;
              jobs.push({
                source,
                url: source.baseUrl + page.path,
                epochSeconds: page.epochSeconds,
                from: -Infinity,
                to: Infinity,
                latest: page.maxDepartureTime,
              });
            }
          }
      } else {
        for (const byPeriod of Object.values(connections.files || {}))
          for (const period of periods)
            if (byPeriod[period]) {
              jobs.push({
                source,
                url: source.baseUrl + byPeriod[period],
                from: departureAfter,
                to,
                latest:
                  Date.parse(
                    period.length === 7
                      ? period + "-01T00:00:00Z"
                      : period + ":00:00Z",
                  ) / 1000,
              });
            }
      }
    }
    // All selected regions participate: walking can enter another network
    // anywhere, so endpoint-region heuristics could silently miss alternatives.
    jobs.sort((a, b) => b.latest - a.latest);
    let cursor = 0;
    let completed = 0;
    const results = new Array(jobs.length);
    onProgress?.({ phase: "loading", completed, total: jobs.length });
    const load = async () => {
      while (cursor < jobs.length) {
        const index = cursor++;
        const job = jobs[index];
        const key = JSON.stringify([
          job.source.manifest.generatedAt,
          job.url,
          job.epochSeconds,
          job.from,
          job.to,
        ]);
        let batches = cache.get(key);
        if (!batches) {
          const request = {
            url: job.url,
            epochSeconds: job.epochSeconds,
            compressed: job.source.manifest.compressed,
            from: job.from,
            to: job.to,
          };
          batches = await (loadPage
            ? loadPage(request)
            : readConnectionBatches(RecordBatchReader, request));
          cache.set(key, batches);
        }
        results[index] = batches.map((batch) => ({
          ...batch,
          source: job.source,
        }));
        completed += 1;
        onProgress?.({ phase: "loading", completed, total: jobs.length });
      }
    };
    // Bounded concurrency also bounds simultaneous decompression and IPC reads.
    const loads = await Promise.allSettled(
      Array.from({ length: Math.min(4, jobs.length) }, load),
    );
    const failed = loads.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
    return { batches: results.flat(), pages: jobs.length };
  }

  async function planJourneys({
    sources,
    origin,
    destination,
    departureAfter,
    maxWalkMeters,
    onProgress,
  }) {
    if (
      !Number.isFinite(departureAfter) ||
      !Number.isFinite(maxWalkMeters) ||
      maxWalkMeters < 0 ||
      maxWalkMeters > 5000
    )
      throw new Error("Invalid departure time or walking limit (0–5000 m)");
    const to = departureAfter + 86400;
    const network = ensureNetwork(sources, maxWalkMeters);
    const fromStop = network.globalStop(origin);
    const toStop = network.globalStop(destination);
    if (fromStop === toStop)
      return {
        found: true,
        options: [
          {
            departure: departureAfter,
            arrival: departureAfter,
            transfers: 0,
            legs: [],
          },
        ],
        totalOptions: 1,
        scanned: 0,
      };
    const { batches, pages } = await loadBatches(
      network,
      departureAfter,
      to,
      onProgress,
    );
    onProgress?.({ phase: "scanning" });
    const result = computeProfile(
      batches,
      network,
      fromStop,
      toStop,
      departureAfter,
      to,
    );
    result.diagnostics.cacheBytes = cache.bytes;
    result.diagnostics.pages = pages;
    return result;
  }

  /**
   * One-to-many earliest arrival from an arbitrary clicked point, not a
   * stop: how much of the selected networks is reachable within
   * `maxDurationSeconds`, for isochrone rendering. Walking access to the
   * origin uses the same `maxWalkMeters` setting as journey planning.
   */
  async function planIsochrone({
    sources,
    origin,
    departureAfter,
    maxWalkMeters,
    maxDurationSeconds,
    onProgress,
  }) {
    if (
      !Number.isFinite(departureAfter) ||
      !Number.isFinite(maxWalkMeters) ||
      maxWalkMeters < 0 ||
      maxWalkMeters > 5000
    )
      throw new Error("Invalid departure time or walking limit (0–5000 m)");
    if (
      !Number.isFinite(maxDurationSeconds) ||
      maxDurationSeconds < 60 ||
      maxDurationSeconds > 3 * 3600
    )
      throw new Error("Invalid isochrone duration (1–180 minutes)");
    const to = departureAfter + maxDurationSeconds;
    const network = ensureNetwork(sources, maxWalkMeters);
    const { batches, pages } = await loadBatches(
      network,
      departureAfter,
      to,
      onProgress,
    );
    onProgress?.({ phase: "scanning" });
    const result = computeIsochrone(
      batches,
      network,
      origin,
      departureAfter,
      to,
      maxWalkMeters,
    );
    result.pages = pages;
    return result;
  }

  return {
    discoverSources,
    loadSource,
    loadSmallTable,
    partitionsInRange,
    planJourneys,
    planIsochrone,
  };
}
