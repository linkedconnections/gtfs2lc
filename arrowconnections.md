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
3. **Paged.** Connections are grouped into [Arrow RecordBatches](https://arrow.apache.org/docs/format/Columnar.html) of `BATCH_SIZE` (50,000) rows. A RecordBatch _is_ a page: a client can process one as it arrives over a streamed `fetch()`, without waiting for the whole file.
4. **Globally consistent identifiers across pages.** Every page refers to stops, trips, and routes by small integers that mean the same thing in every page and every file of a given conversion — see [Identifier strategy](#identifier-strategy).
5. **Sorted.** `linkedConnections.arrow` is one array, globally sorted by `departureTime` ascending — the exact precondition CSA requires. (Other `gtfs2lc` formats are not globally sorted; see `README.md`'s note on `linkedconnections-joinandsort`. Arrow Connections sorts as part of the merge step because an unsorted file would be useless for its one stated purpose.)

## File layout

A conversion with `--format arrow` writes four files plus a manifest into the
output directory:

| File                             | Contents                                                                                      | Typical size              |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------- |
| `manifest.json`                  | File names, the effective `baseUris`, entity counts, whether `connections` is gzip-compressed | a few hundred bytes       |
| `stops.arrow`                    | One row per GTFS stop                                                                         | small (stop count)        |
| `routes.arrow`                   | One row per GTFS route                                                                        | small (route count)       |
| `trips.arrow`                    | One row per GTFS trip                                                                         | small–medium (trip count) |
| `linkedConnections.arrow`(`.gz`) | One row per connection, sorted by `departureTime`                                             | large (connection count)  |

Each `.arrow` file is a standard [Arrow IPC streaming format](https://arrow.apache.org/docs/format/Columnar.html#ipc-streaming-format)
file — readable with any Arrow library, not just this project's tooling.

### `manifest.json`

```json
{
  "format": "gtfs2lc-arrow-connections",
  "version": 2,
  "generatedAt": "2026-09-12T13:10:43.233Z",
  "files": {
    "stops": "stops.arrow",
    "routes": "routes.arrow",
    "trips": "trips.arrow",
    "connections": "linkedConnections.arrow"
  },
  "compressed": false,
  "baseUris": {
    "stop": "http://example.org/stops/{stops.stop_id}",
    "route": "http://example.org/routes/{routes.route_id}",
    "trip": "http://example.org/trips/{trips.trip_id}/{trips.startTime(yyyyMMdd)}",
    "connection": "http://example.org/connections/{trips.startTime(yyyyMMdd)}/{depStop}/{trips.trip_id}",
    "resolve": { "depStop": "connection.departureStop.stop_id" }
  },
  "counts": { "stops": 2891, "routes": 1501, "trips": 68123 }
}
```

`baseUris` is the same URI-template configuration `gtfs2lc` uses for its
RDF outputs (see `baseUris-example.json`). It is not needed to run a route
planner — Arrow Connections identifies stops/trips/routes by GTFS id, not by
IRI — but it lets a client reconstruct a canonical IRI for a stop or trip
(for citation, or to cross-reference this conversion's `jelly`/`jsonld`
sibling output) without gtfs2lc having to bake full IRIs into every page.

`version` tracks the schema of these files, not of `gtfs2lc` itself:

- **1** — initial schema.
- **2** — `stops.arrow` gained `parentIdx`. A client reading a `version: 1`
  file (no `parentIdx` column) should treat every stop as having no parent,
  i.e. behave as if station grouping were simply unavailable, rather than
  fail — `public/index.html` does this.

### `stops.arrow`

| Column      | Type      | Nullable | Notes                                                           |
| ----------- | --------- | -------- | --------------------------------------------------------------- |
| `stopId`    | `Utf8`    | no       | the GTFS `stop_id`                                              |
| `name`      | `Utf8`    | yes      | `stop_name`, for search/autocomplete                            |
| `lat`       | `Float64` | yes      | `stop_lat`                                                      |
| `lon`       | `Float64` | yes      | `stop_lon`                                                      |
| `parentIdx` | `Int32`   | no       | row index of this stop's GTFS `parent_station`, or `-1` if none |

Row index **is** the stop's global integer id, referenced from
`linkedConnections.arrow` as `departureStopIdx`/`arrivalStopIdx`.

`parentIdx` mirrors GTFS's station hierarchy (`parent_station`): a platform
or boarding area points at its station, which itself has `parentIdx === -1`.
No `stop_times.txt` row ever departs from or arrives at a station-level stop
directly — only from its child platforms — so a client that lets people
search by station (see `public/index.html`) has to resolve a chosen
station to the set of its descendant stop indices before matching it
against `departureStopIdx`/`arrivalStopIdx`. Stops with `parentIdx === -1`
are exactly the set worth offering in a search box: they're either a real
station, or a standalone stop with no hierarchy at all.

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

### `linkedConnections.arrow`

| Column             | Type                | Notes                                         |
| ------------------ | ------------------- | --------------------------------------------- |
| `departureStopIdx` | `Int32`             | row index into `stops.arrow`                  |
| `arrivalStopIdx`   | `Int32`             | row index into `stops.arrow`                  |
| `departureTime`    | `Timestamp(SECOND)` | seconds since Unix epoch, UTC                 |
| `arrivalTime`      | `Timestamp(SECOND)` | seconds since Unix epoch, UTC                 |
| `tripIdx`          | `Int32`             | row index into `trips.arrow`                  |
| `pickupType`       | `Uint8`             | raw GTFS `pickup_type` (0–3), 0 when absent   |
| `dropOffType`      | `Uint8`             | raw GTFS `drop_off_type` (0–3), 0 when absent |

Rows are sorted by `departureTime` ascending across the whole file, not just
within a RecordBatch.

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

## Paging and streaming in the browser

An Arrow IPC stream is a sequence of self-describing messages: one schema
message, then one message per RecordBatch. `apache-arrow`'s JavaScript API
can consume this incrementally from a `fetch()` `Response` body — a
RecordBatch becomes available to the caller as soon as its bytes have
arrived, without waiting for the rest of the file. `gtfs2lc` writes
`linkedConnections.arrow` in batches of 50,000 connections
(`lib/arrow/schema.js`'s `BATCH_SIZE`), so in practice a client sees a new
page roughly every few hundred KB.

`public/index.html` (see `README.md`) uses this directly: it buffers the
RecordBatch pages covering a bounded window after the requested departure
time (see below), rather than the whole file, before planning a journey.

There is currently no separate time-indexed manifest of "which RecordBatch
starts at which departure time" — a client that wants to start mid-file has
to skip pages by peeking at their first row. That's a reasonable place for a
future version of this format to add a lightweight index; see below.

## Journey planning: a multi-criteria profile, not just earliest arrival

`public/index.html` plans journeys with the multi-criteria **Profile
Connection Scan Algorithm** from the CSA paper
(https://arxiv.org/abs/1703.05997), the same algorithm
[planner.js](https://planner.js.org) implements: instead of a single
earliest-arrival answer, it computes a Pareto-optimal front over (arrival
time, number of transfers) and returns up to six non-dominated journeys — a
faster option with more transfers alongside a slower direct one, for
instance, are both kept, since neither is strictly better than the other.

Concretely: it buffers every connection in a bounded window after the
requested departure time (`MAX_SCAN_HORIZON_SECONDS`, 3 days by default —
this is the one place this client reads more than the current page's worth
of the file, since the scan below needs the whole window before it can
start), then scans that window **backward** (latest departure first),
building a small Pareto-optimal profile per stop of "the best (arrival,
transfers) achievable by boarding a trip that departs this stop no earlier
than X". A per-trip table remembers the best continuation reachable by
staying on board past a given point, so riding a trip through several stops
never counts as a transfer. The origin's profile, evaluated at the
requested departure time and unioned across every platform in its station
family, is the answer: a genuine Pareto front, typically a handful of
entries, each one already a fully reconstructed sequence of legs.

GTFS trips are distributed round-robin across `gtfs2lc` workers (by trip,
not by date or time — see `StopTimes2Cxs.js`), so per-worker output is not
time-ordered, and neither is a naive concatenation of worker outputs. Since
a sorted stream is this format's entire reason to exist, `mergeArrowWorkerOutput`
(`lib/arrow/merge.js`) reads every worker's connections back into flat typed
arrays, sorts a permutation index by `departureTime`, and rewrites the result
as freshly-batched, sorted RecordBatches.

This holds all connections in memory as seven typed-array columns —
roughly 30 bytes/connection — for the duration of the merge. For a feed the
size of a busy national railway's yearly schedule (order of ten million
connections), that's on the order of a few hundred MB, not a full-blown
external sort. Very large feeds (or workstations with limited RAM) may
eventually need a disk-backed merge sort instead; this is a known current
limitation, not a design constraint of the format itself.

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
  the RecordBatch containing a given departure time instead of scanning
  from the front.
- **Footpaths / transfers**, real-time delay updates, and anything else a
  fuller journey planner eventually needs — out of scope for this document,
  which only covers the static base schedule.
