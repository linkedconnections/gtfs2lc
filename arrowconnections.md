# Arrow Connections: a columnar, browser-ready connections format

This document specifies the `arrow` output format of `gtfs2lc`. Where the
`jelly`, `turtle`, `ntriples`, `jsonld`, and `csv` formats describe a full
Linked Connections graph, Arrow Connections is deliberately narrower: it
stores only what a [Connection Scan Algorithm (CSA)](https://arxiv.org/abs/1703.05997)
route planner needs to compute a journey, laid out so that a browser can
`fetch()` it, start scanning immediately, and never allocate one JavaScript
object per connection.

See the root `README.md` for how this format compares to `jelly`, `turtle`,
`ntriples`, and `csv` in practice.

## Why not just compress Jelly-RDF harder?

We looked into this first — see the discussion that led here. The short
version: Jelly-RDF's _size_ problem turned out to be mostly a missing
`--compressed` flag, not the format. But size was never the only problem for
a browser route planner: RDF/JS quads are one allocation per triple, and a
Connection Scan needs to touch every connection to find a route. A columnar,
typed-array layout removes that allocation entirely — a departure time is a
`Float64Array` slot, not a `Literal` object with a nested `NamedNode`
datatype.

## Design goals

1. **Minimal.** Store only what CSA needs: departure/arrival stop, departure/arrival time, trip, and GTFS pickup/drop-off type. No connection IRIs, no per-stop headsign overrides, no `stop_sequence` — see [Non-goals](#non-goals--future-extensions).
2. **Columnar.** Each field is its own typed array (`Int32Array`, a `TimestampSecond` column, etc.), so a client can index straight into memory with no per-row parsing.
3. **Paged, geospatially and by time.** Connections are split into `(region, month)` partition files (see [Geospatial and temporal partitioning](#geospatial-and-temporal-partitioning)), and within each file, grouped into [Arrow RecordBatches](https://arrow.apache.org/docs/format/Columnar.html) of `BATCH_SIZE` (50,000) rows. A client can process a RecordBatch as it arrives over a streamed `fetch()`, and fetch only the region/month files it actually needs.
4. **Globally consistent identifiers across pages.** Every page, in every partition file, of every source, refers to stops, trips, and routes by small integers that mean the same thing everywhere — see [Identifier strategy](#identifier-strategy).
5. **Sorted, per partition.** Each `(region, month)` file is one array, sorted by `departureTime` ascending — the exact precondition CSA requires — though there is no ordering guarantee _across_ files; a client combining several has to merge/re-sort them itself. (Other `gtfs2lc` formats are not sorted at all; see `README.md`'s note on `linkedconnections-joinandsort`. Arrow Connections sorts as part of the merge step because an unsorted file would be useless for its one stated purpose.)

## File layout

A conversion with `--format arrow` writes `stops.arrow`, `routes.arrow`,
`trips.arrow`, and a manifest into the output directory — plus, unlike
earlier versions of this format, **connections are no longer one file**.
They're partitioned by geospatial region and by calendar month, following
the fragmentation approach from
[Delva et al., "Geospatially Partitioning Public Transit Networks for Open
Data Publishing"](https://arxiv.org/abs/1703.05997) (JWE 2021) — see
[Geospatial and temporal partitioning](#geospatial-and-temporal-partitioning)
below.

| File                                       | Contents                                                                                                                                          | Typical size              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `manifest.json`                            | File names, partitioning info, `baseUris`, entity counts                                                                                          | a few KB                  |
| `stops.arrow`                              | One row per GTFS stop                                                                                                                             | small (stop count)        |
| `routes.arrow`                             | One row per GTFS route                                                                                                                            | small (route count)       |
| `trips.arrow`                              | One row per GTFS trip                                                                                                                             | small–medium (trip count) |
| `partitions/<region>/<month>.arrow`(`.gz`) | One row per connection whose _departure stop_ is in `<region>`, departing in calendar month `<month>` ("YYYY-MM", UTC), sorted by `departureTime` | small–medium per file     |

Each `.arrow` file is a standard [Arrow IPC streaming format](https://arrow.apache.org/docs/format/Columnar.html#ipc-streaming-format)
file — readable with any Arrow library, not just this project's tooling.

### `manifest.json`

```json
{
  "format": "gtfs2lc-arrow-connections",
  "version": 3,
  "generatedAt": "2026-09-13T08:00:00.000Z",
  "files": {
    "stops": "stops.arrow",
    "routes": "routes.arrow",
    "trips": "trips.arrow"
  },
  "compressed": false,
  "baseUris": {
    "stop": "http://example.org/stops/{stops.stop_id}",
    "route": "http://example.org/routes/{routes.route_id}",
    "trip": "http://example.org/trips/{trips.trip_id}/{trips.startTime(yyyyMMdd)}",
    "connection": "http://example.org/connections/{trips.startTime(yyyyMMdd)}/{depStop}/{trips.trip_id}",
    "resolve": { "depStop": "connection.departureStop.stop_id" }
  },
  "counts": { "stops": 2891, "routes": 1501, "trips": 68123 },
  "partitioning": {
    "method": "hub",
    "regionCount": 8,
    "regions": [{ "id": 0, "hubStopIdx": 42, "lat": 51.03, "lon": 3.71 }]
  },
  "connections": {
    "months": ["2026-07", "2026-08"],
    "files": {
      "0": { "2026-07": "partitions/0/2026-07.arrow" },
      "1": { "2026-07": "partitions/1/2026-07.arrow" }
    }
  }
}
```

`baseUris` is the same URI-template configuration `gtfs2lc` uses for its
RDF outputs (see `baseUris-example.json`). It is not needed to run a route
planner — Arrow Connections identifies stops/trips/routes by GTFS id, not by
IRI — but it lets a client reconstruct a canonical IRI for a stop or trip
(for citation, or to cross-reference this conversion's `jelly`/`jsonld`
sibling output) without gtfs2lc having to bake full IRIs into every page.

`connections.files[regionId][month]` is the only place a client learns
where a given partition lives; `connections.months` is every month any
region has data for.

`version` tracks the schema of these files, not of `gtfs2lc` itself:

- **1** — initial schema.
- **2** — `stops.arrow` gained `parentIdx`.
- **3** — connections are partitioned by `(region, month)` instead of one
  `linkedConnections.arrow` file; `stops.arrow` gained `regionIdx`;
  `manifest.json` gained `partitioning` and `connections`. A client reading
  an older manifest (no `regionIdx`/`connections` object) should treat every
  stop as unpartitioned (region 0) rather than fail — `public/index.html`
  does this for `parentIdx`/`regionIdx` already, though it does require a
  `version: 3`-shaped `connections` object to find any data at all.

### `stops.arrow`

| Column      | Type      | Nullable | Notes                                                           |
| ----------- | --------- | -------- | --------------------------------------------------------------- |
| `stopId`    | `Utf8`    | no       | the GTFS `stop_id`                                              |
| `name`      | `Utf8`    | yes      | `stop_name`, for search/autocomplete                            |
| `lat`       | `Float64` | yes      | `stop_lat`                                                      |
| `lon`       | `Float64` | yes      | `stop_lon`                                                      |
| `parentIdx` | `Int32`   | no       | row index of this stop's GTFS `parent_station`, or `-1` if none |
| `regionIdx` | `Int32`   | no       | row index into `manifest.json`'s `partitioning.regions`         |

Row index **is** the stop's global integer id, referenced from every
connections partition as `departureStopIdx`/`arrivalStopIdx`.

`parentIdx` mirrors GTFS's station hierarchy (`parent_station`): a platform
or boarding area points at its station, which itself has `parentIdx === -1`.
No `stop_times.txt` row ever departs from or arrives at a station-level stop
directly — only from its child platforms — so a client that lets people
search by station (see `public/index.html`) has to resolve a chosen
station to the set of its descendant stop indices before matching it
against `departureStopIdx`/`arrivalStopIdx`. Stops with `parentIdx === -1`
are exactly the set worth offering in a search box: they're either a real
station, or a standalone stop with no hierarchy at all.

`regionIdx` is the stop's precomputed geospatial partition — see
[Geospatial and temporal partitioning](#geospatial-and-temporal-partitioning).
Unlike GTFS's own station hierarchy, this is entirely a `gtfs2lc` invention:
nothing else defines it, so a client always looks it up here rather than
computing it itself.

### `routes.arrow`

| Column      | Type   | Nullable | Notes               |
| ----------- | ------ | -------- | ------------------- |
| `routeId`   | `Utf8` | no       | the GTFS `route_id` |
| `shortName` | `Utf8` | yes      | `route_short_name`  |
| `longName`  | `Utf8` | yes      | `route_long_name`   |

Row index is the route's global integer id.

### `trips.arrow`

| Column     | Type    | Nullable | Notes                         |
| ---------- | ------- | -------- | ----------------------------- |
| `tripId`   | `Utf8`  | no       | the GTFS `trip_id`            |
| `routeIdx` | `Int32` | no       | row index into `routes.arrow` |
| `headsign` | `Utf8`  | yes      | `trip_headsign`               |

Row index is the trip's global integer id, referenced from
`linkedConnections.arrow` as `tripIdx`.

### `partitions/<region>/<month>.arrow`

| Column             | Type                | Notes                                         |
| ------------------ | ------------------- | --------------------------------------------- |
| `departureStopIdx` | `Int32`             | row index into `stops.arrow`                  |
| `arrivalStopIdx`   | `Int32`             | row index into `stops.arrow`                  |
| `departureTime`    | `Timestamp(SECOND)` | seconds since Unix epoch, UTC                 |
| `arrivalTime`      | `Timestamp(SECOND)` | seconds since Unix epoch, UTC                 |
| `tripIdx`          | `Int32`             | row index into `trips.arrow`                  |
| `pickupType`       | `Uint8`             | raw GTFS `pickup_type` (0–3), 0 when absent   |
| `dropOffType`      | `Uint8`             | raw GTFS `drop_off_type` (0–3), 0 when absent |

Every row's `departureStopIdx` resolves (via `stops.arrow`'s `regionIdx`) to
the `<region>` this file is filed under — that's the partitioning key, not
`arrivalStopIdx` (a connection can very well arrive in a different region
than it departed from). Rows are sorted by `departureTime` ascending within
this one file, not just within a RecordBatch — but there is no ordering
guarantee _across_ files, since each `(region, month)` partition is sorted
independently. A client combining several partitions (see
[Journey planning](#journey-planning-a-multi-criteria-profile-not-just-earliest-arrival))
must merge/re-sort them itself.

Reading a `Timestamp(SECOND)` column back through the Arrow JavaScript API
yields plain JS millisecond numbers (`new Date(value)` works directly) — see
[apache-arrow's](https://www.npmjs.com/package/apache-arrow) own conversion
behavior; the on-disk representation stays whole seconds.

## Identifier strategy

`gtfs2lc` already has a global-identifier strategy for its RDF outputs: the
`baseUris` URI templates (`URIStrategy.js`), which turn a `stop_id`/`trip_id`/
`route_id` into a stable IRI. Arrow Connections reuses that same strategy at
the level of **what counts as an identifier** (a GTFS id is authoritative,
IRIs are a presentation of it), but resolves it once, up front, into small
integers instead of repeating strings:

1. Before any worker starts, `gtfs2connections.js` calls
   `buildDictionaries()`, which makes one pass over the already-loaded
   `stops.db`/`routes.db`/`trips.db` stores and writes `stops.arrow`,
   `routes.arrow`, and `trips.arrow`. A GTFS entity's row position in that
   file **is** its integer id for this conversion.
2. Every worker (there can be several, running in parallel — see
   `README.md`'s `--workers` option) loads those three files back into
   `Map<gtfsId, integer>` lookups before it writes a single connection row.
   Because every worker reads the _same_ three files, "the station and trip
   identifiers match across pages" by construction: there is only one
   assignment of integers, made once, consulted read-only everywhere else.
3. Connections themselves get no identifier at all in this format — see
   [Non-goals](#non-goals--future-extensions).

This is why Arrow Connections does not need Arrow's built-in
dictionary-encoding feature (`DictionaryArray` + per-stream dictionary
batches): that mechanism assumes one _self-contained_ stream defining its own
dictionary. Here, the dictionary is deliberately external and shared by
every page and every worker, which is a simpler guarantee to reason about
across a multi-file, multi-worker, appended-to-over-time pipeline than
reconciling per-stream dictionaries would be.

"Yet can be prefixed": because `stops.arrow`/`trips.arrow`/`routes.arrow`
store bare GTFS ids and `manifest.json` stores the `baseUris` templates
separately, nothing about the wire format repeats a base URI per row. A
client only pays for reconstructing a full IRI on the rare occasion it needs
one.

## Geospatial and temporal partitioning

Delva et al.'s paper (see the top of this document) measured what happens
when a Linked Connections feed is split up geospatially as well as by time,
for exactly this format's use case: a client-side route planner that
shouldn't have to download data it will never touch. Their headline result —
geospatial partitioning speeds up client-side queries a lot on some networks
(a national railway, a regional bus network) and barely at all on others (a
dense city network, because a typical trip there already visits most of the
network) — is why partitioning here is a knob (`--regions`), not a fixed
architectural choice: a dense urban feed gets little from it and might
reasonably use `--regions 1`.

**Splitting connections.** Every connection is filed under exactly one
`(region, month)` pair: the region its **departure stop** belongs to (see
`stops.arrow`'s `regionIdx`), and the UTC calendar month its departure time
falls in. This mirrors the paper's own choice of qualifying a partition by
"connections whose departure stop lies in this region" — the paper found
this ambiguity (does a partition hold connections _starting_ in a region, or
merely _crossing_ it?) important enough to state explicitly in its own
hypermedia description, so we do too, here, in the schema documentation
directly rather than needing a runtime-inspectable qualifier.

**Choosing regions: the Hub method.** Of the four partitioning methods the
paper evaluated (k-means, METIS, and two methods of their own — Hub and a
merge-based variant of it), `gtfs2lc` implements **Hub**
(`lib/arrow/regions.js`): greedily pick the stop covering the most
not-yet-covered trips, `--regions` times, then assign every other stop to
its nearest hub by straight-line distance (the discrete equivalent of the
hub points' Voronoi diagram). It was chosen over the alternatives because it
needs no extra dependency (no k-means/METIS library) and the paper found it,
and its merge-based variant, performed best of the four across their three
evaluated networks. `manifest.json`'s `partitioning.regions` records each
hub's stop index and coordinates, purely for inspection — nothing at query
time needs to redo this computation, since every stop's assignment is
already baked into `stops.arrow`.

This is also a deliberate simplification relative to the paper: their
approach publishes each partition's exact geospatial extent as a
[GeoSPARQL](https://www.ogc.org/standard/geosparql/) WKT polygon so a
generic Linked-Data-Fragments client — one with no other way to know which
partition a stop falls in — can do its own point-in-polygon test against a
TREE `GeospatiallyContainsRelation`. Here, a client already has to load
`stops.arrow` to plan anything at all, so it can just read `regionIdx`
directly; no WKT, no GeoSPARQL dependency, no point-in-polygon math ships to
the browser.

**Splitting by month.** Independently of region, connections are also split
by the UTC calendar month their departure time falls in
(`partitions/<region>/<month>.arrow`) — the paper's own Linked Connections
baseline already fragments by time (into 20-minute pages, in their
evaluation); a month is a coarser grain chosen because, combined with
regions, individual files stay conveniently small without creating an
unwieldy number of them.

## Paging and streaming in the browser

An Arrow IPC stream is a sequence of self-describing messages: one schema
message, then one message per RecordBatch. `apache-arrow`'s JavaScript API
can consume this incrementally from a `fetch()` `Response` body — a
RecordBatch becomes available to the caller as soon as its bytes have
arrived, without waiting for the rest of the file. `gtfs2lc` writes each
partition file in batches of 50,000 connections (`lib/arrow/schema.js`'s
`BATCH_SIZE`).

The geospatial+temporal partitioning above is what actually lets
`public/index.html` avoid downloading data it doesn't need: rather than
fetch every region up front, it starts from just the origin's and
destination's own regions (for the months the query's time horizon spans),
then **widens outward** for a few rounds — after each fetch, it checks which
_other_ regions the data just loaded actually points into (an arrival stop
in a region not loaded yet) and fetches those too, every newly-needed
`(region, month)` file **in parallel** rather than one at a time. This is
the geospatial equivalent of "start fetching data from another arrow file
when you enter that geospatial area": which file to fetch next is decided
by where the data already in hand leads, not by a fixed traversal order.

It's a heuristic, not an exhaustive guarantee — a journey that needs to pass
through a region touched by neither endpoint nor any region discovered
within a few widening rounds (`MAX_WIDENING_ROUNDS` in `public/index.html`)
won't be found. For a small number of regions (the common case) this
converges immediately in practice, as shown by scanning only 2 regions to
answer a real cross-country query in the SNCB/NMBS feed (see the README's
measurements). There is still no separate time-indexed manifest of "which
RecordBatch inside a given partition file starts at which departure time" —
a client fetches a whole `(region, month)` file rather than seeking within
it. That remains a reasonable place for a future version of this format to
add a lightweight index.

## Journey planning: a multi-criteria profile, not just earliest arrival

`public/index.html` plans journeys with the multi-criteria **Profile
Connection Scan Algorithm** from the CSA paper
(https://arxiv.org/abs/1703.05997), the same algorithm
[planner.js](https://planner.js.org) implements: instead of a single
earliest-arrival answer, it computes a Pareto-optimal front over (arrival
time, number of transfers) and returns up to six non-dominated journeys — a
faster option with more transfers alongside a slower direct one, for
instance, are both kept, since neither is strictly better than the other.

Concretely: it builds a pool of connections by fetching the `(region,
month)` partitions the widening process above determines it needs, sorts
that pool by departure time, then scans it **backward** (latest departure
first), building a small Pareto-optimal profile per stop of "the best
(arrival, transfers) achievable by boarding a trip that departs this stop no
earlier than X". A per-trip table remembers the best continuation reachable
by staying on board past a given point, so riding a trip through several
stops — even across a region boundary — never counts as a transfer. The
origin's profile, evaluated at the requested departure time and unioned
across every platform in its station family, is the answer: a genuine
Pareto front, typically a handful of entries, each one already a fully
reconstructed sequence of legs.

GTFS trips are distributed round-robin across `gtfs2lc` workers (by trip,
not by date or time — see `StopTimes2Cxs.js`), so per-worker output is not
time-ordered, and neither is a naive concatenation of worker outputs. Since
each partition file needs to be independently sorted, `mergeArrowWorkerOutput`
(`lib/arrow/merge.js`) reads every worker's connections back into flat typed
arrays, groups row indices by `(region, month)`, sorts each group by
`departureTime`, and writes each group out as its own freshly-batched,
sorted partition file.

This holds all of a conversion's connections in memory as seven typed-array
columns — roughly 30 bytes/connection — for the duration of the merge, same
as before partitioning existed; partitioning changes _how the sorted result
gets written out_, not how much has to be resident to sort it. For a feed
the size of a busy national railway's yearly schedule (order of ten million
connections), that's on the order of a few hundred MB, not a full-blown
external sort. Very large feeds (or workstations with limited RAM) may
eventually need a disk-backed merge sort instead; this is a known current
limitation, not a design constraint of the format itself.

## Multiple sources

`public/index.html` can plan journeys against several independently
generated `gtfs2lc` conversions at once — one per transit operator, say — by
reading a `sources.json` next to the page:

```json
{
  "sources": [
    { "id": "nmbs", "name": "NMBS/SNCB", "manifest": "nmbs/manifest.json" },
    { "id": "delijn", "name": "De Lijn", "manifest": "delijn/manifest.json" }
  ]
}
```

Every other file a source references (`stops.arrow`, partition files, ...)
is resolved relative to that source's own `manifest.json`, so each source is
just a `gtfs2lc --format arrow` output directory dropped in as a
subdirectory, unmodified. Run `gtfs2lc-sources-index <dir>` to (re)generate
`sources.json` by scanning `<dir>`'s immediate subdirectories for a
`gtfs2lc-arrow-connections` manifest. If no `sources.json` is present at all,
the page falls back to treating its own directory as the one and only
source, so existing single-source setups keep working unmodified.

The browser lets people check/uncheck which sources to search, defaulting to
all discovered ones; stop autocomplete only searches checked sources. **A
journey must still start and end within the same source** — see
[Non-goals](#non-goals--future-extensions) for why cross-network transfers
aren't implemented. What "traverse multiple files in parallel" buys you here
is concurrency, not a combined route: loading several sources' dictionaries
at startup, and — within a single source's journey — fetching every
newly-needed `(region, month)` file at once rather than sequentially (see
[Paging and streaming in the browser](#paging-and-streaming-in-the-browser)).

## Non-goals / future extensions

Deliberately left out of v1, because CSA doesn't need them to compute a
route — a future version could add these as additional, optional columns
without breaking the ones above:

- **Connection identity.** No IRI, no id column at all. If you need to cite
  or dereference a specific connection later, reconstruct it from
  `tripIdx` → `trips.arrow` → `tripId`, plus `departureTime`, through the
  same `connection` URI template recorded in `manifest.json`.
- **Per-stop headsign overrides.** `trips.arrow.headsign` is the trip-level
  `trip_headsign`; a connection-level `stop_headsign` override (rare, but
  real in some feeds) is not represented.
- **`stop_sequence`.** Not needed to distinguish connections for routing.
- **A time-indexed page manifest**, so a browser client can jump straight to
  the RecordBatch inside a partition file containing a given departure time,
  instead of always fetching the whole `(region, month)` file.
- **Cross-network (inter-source) transfers.** With multiple sources loaded,
  a journey must still start and end within one source — there is no
  walking-transfer or shared-stop data connecting, say, a national railway
  source to a regional bus source. Adding it is a real feature, not a
  tweak: it needs geospatial nearest-stop matching across sources (find
  every stop of every _other_ source within walking distance of a given
  stop) and a transfer-time model, likely surfaced as another per-stop
  precomputed table analogous to `parentIdx`/`regionIdx`.
- **Footpaths / transfers** within a single source, real-time delay
  updates, and anything else a fuller journey planner eventually needs —
  out of scope for this document, which only covers the static base
  schedule.
