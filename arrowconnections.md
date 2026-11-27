# Linked Connections 2.0-alpha in GTFS2LC

The default Arrow exporter implements the [Linked Connections v2-alpha draft](https://github.com/linkedconnections/website/pull/14). Its schema identifier is
`2-alpha`. The core schemas in [lib/arrow/definitions.json](lib/arrow/definitions.json)
match that draft's `specification/schemas.json`, including column order,
types and nullability. Pin a specification and exporter commit while the alpha evolves.

The draft fits GTFS2LC's existing service-calendar expansion, agency-timezone
handling, immutable release generation and external connection sorting. The main
wire changes from the earlier implementation are:

| Earlier Arrow export                                      | Current core export                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `manifest.json`, `format` and `version`                   | JSON-LD `manifest.jsonld`, `@type: Timetable`, `schemaVersion: 2-alpha` |
| `files.*`, descriptor `path`                              | Top-level table IRI strings and page `@id` values                       |
| `files.planning`, dataset `planning`                      | `connections.pages`, dataset `connections`                              |
| Numeric `regionId` and `stops.regionIdx`                  | Page `region` and `stops.regionIri`, using absolute HTTP(S) IRIs        |
| Numeric departure bounds in descriptors                   | UTC dateTime strings in `minDepartureTime` and `maxDepartureTime`       |
| Calls, shapes and enrichment columns in the core contract | Five baseline schemas below; enrichments are outside this core export   |
| Transfer types 4/5 rejected                               | Explicit linked-trip transfers supported                                |

[Linked Connections 1.0](https://linkedconnections.org/specification/1-0) RDF and
JSON-LD output remain available through the existing non-Arrow formats.

## Build and publish

Use Node.js 24 or later. The cleaner sorts and normalizes the extracted GTFS files
in place; keep the archive if an unchanged input is needed.

```sh
node bin/gtfs2lc.js /path/to/extracted/gtfs --format arrow \
  --source-id example.transit --id-base https://data.example.org/id \
  --start-date 20261107 --end-date 20261114 --regions 4 \
  --release-id timetable-20261107 --output ./data
```

Serve `data/` at the origin root and fetch `/manifest.jsonld`. Use `--url-prefix
/timetables` when mounting the directory at `/timetables`; this changes delivery
IRIs, not entity identifiers. Consumers follow manifest IRIs rather than construct
filenames. A complete synthetic example is in [examples/manifest.jsonld](examples/manifest.jsonld).

`--profile irail-cdn-v1` selects iRail identity defaults and the `/data` delivery
prefix. Both presets publish the same LC2-alpha manifest, schemas, linked-trip
transfers and GTFS Realtime descriptors. The preset name does not introduce a
separate serialization version; all Arrow files use `schemaVersion=2-alpha`.

Publishers SHOULD manually provide a license IRI and/or a rights or attribution
statement, using `--license https://example.org/license` and/or `--rights
"Timetable data by Example Transit"`. The draft makes this a SHOULD; both options
are optional and GTFS2LC does not infer legal conditions from agency names.
Missing values are omitted. A supplied license
must be an absolute IRI; a supplied rights statement must be nonempty.

`--source-id` identifies a persistent source namespace, not a collection channel or
mirror. Configure an identity authority you control with `--id-base` or
`--iri-strategy`; the default `https://example.org/id` is illustrative.
`--start-date` and `--end-date` select service days inclusively, preserving their
after-midnight connections.

`gtfs2lc-build --format arrow` accepts the same identity, legal, realtime, region,
release and service-date options. `scripts/build-sncb.js --format arrow` supplies
`--source-id be.sncb`; it also accepts `--license` and `--rights` or the environment
variables `SNCB_LICENSE` and `SNCB_RIGHTS`.

## Manifest and immutable releases

The JSON-LD manifest uses
`https://linkedconnections.org/specification/2-0-alpha/context.jsonld`, aligned with
the draft's Linked Connections vocabulary, Hydra, DCAT and Dublin Core terms.

| Property                                | GTFS2LC value                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| `@context`                              | The draft context IRI                                                               |
| `@id`                                   | Discovery IRI, including the configured delivery prefix                             |
| `@type`                                 | `Timetable`                                                                         |
| `schemaVersion`                         | `2-alpha`                                                                           |
| `releaseId`                             | Unique generation ID, supplied or generated                                         |
| `generatedAt`                           | UTC generation instant                                                              |
| `timeZone`                              | The single GTFS agency IANA timezone                                                |
| `license`, `rights`                     | Optional, supplied by the publisher                                                 |
| `coverageStart`, `coverageEnd`          | Half-open departure bounds as UTC dateTime strings; arrivals can extend beyond them |
| `stops`, `trips`, `routes`, `transfers` | One Arrow file IRI string each; an empty transfers table is still published         |
| `connections`                           | A `ConnectionCollection` containing an explicit `pages` list                        |
| `realtime`                              | Optional GTFS Realtime descriptors, configured with `--realtime`                    |

Table references are plain strings, for example
`"stops": "/releases/timetable-20261107/stops.arrow"`. Page entries are objects
with `@id`, `@type: ConnectionsPage`, decimal `epochSeconds`, inclusive departure
bounds, and, when partitioned, a `region` IRI and a sorted unique list of
`arrivalRegions` IRIs. The manifest does not include row counts, byte sizes,
hashes or media types. Arrow supplies the schema and row count; HTTP supplies the
content type. Relative IRIs resolve against the manifest response URL.

The builder writes a private temporary directory, validates conversion, renames
it to `releases/<releaseId>/`, and atomically replaces root discovery last. A copy
of the manifest is retained inside the release. Reusing a release ID fails;
failed conversions preserve the existing discovery document. Retain old releases
while clients or caches can still reference them. Coordinate concurrent
publishers when deploying to object storage.

The exporter creates files, not an HTTP service. Hosting MUST support GET and
HEAD, `Access-Control-Allow-Origin: *`, `application/ld+json` for the manifest,
`application/vnd.apache.arrow.file` for Arrow, and `application/x-protobuf` for
linked GTFS Realtime feeds. Use short caching for discovery and
long caching for immutable release files, with conditional requests and validators.

## Arrow files and schemas

Every resource is an independently readable little-endian Arrow IPC **file** with
`ARROW1` framing and a footer. IPC streams and IPC compression are not used.
`--stream` and `--compressed` are rejected for Arrow; HTTP content encoding is a
hosting concern.

Required Arrow metadata is `schemaVersion=2-alpha`, `releaseId=<releaseId>` and
`dataset=<schema key>`. Connection pages additionally carry decimal `epochSeconds`,
UTC `minDepartureTime`/`maxDepartureTime`, and `region` when partitioned. Additional
implementation metadata such as `format`, `identityProfile` and `specification`
is informational, not required by the core draft.

The following is the complete ordered baseline. Consumers check types and
nullability, locate known columns by name, and ignore unknown columns. Compatible
extensions may append nullable columns. Missing optional values use Arrow null,
not empty strings or zero. `…Idx` columns are zero-based Int32 row references
within this release; `parentIdx=-1` means no parent. Entity `iri` values are
absolute HTTP(S) identifiers and never depend on a table's row number.

### `connections`

Schema key: `connections`.

| Column                | Arrow type | Nullable |
| --------------------- | ---------- | -------- |
| `departureStopIdx`    | Int32      | no       |
| `arrivalStopIdx`      | Int32      | no       |
| `departureTimeOffset` | Uint32     | no       |
| `arrivalTimeOffset`   | Uint32     | no       |
| `tripIdx`             | Int32      | no       |
| `pickupType`          | Uint8      | no       |
| `dropOffType`         | Uint8      | no       |
| `serviceDate`         | Uint32     | no       |
| `stopSequence`        | Uint32     | no       |
| `arrivalStopSequence` | Uint32     | no       |
| `iri`                 | Utf8       | no       |

### `stops`

Schema key: `stops`.

| Column            | Arrow type | Nullable |
| ----------------- | ---------- | -------- |
| `name`            | Utf8       | yes      |
| `lat`             | Float64    | yes      |
| `lon`             | Float64    | yes      |
| `parentIdx`       | Int32      | no       |
| `minTransferTime` | Uint32     | no       |
| `iri`             | Utf8       | no       |
| `regionIri`       | Utf8       | yes      |

### `trips`

Schema key: `trips`.

| Column      | Arrow type | Nullable |
| ----------- | ---------- | -------- |
| `routeIdx`  | Int32      | no       |
| `headsign`  | Utf8       | yes      |
| `shortName` | Utf8       | yes      |
| `iri`       | Utf8       | no       |

### `routes`

Schema key: `routes`.

| Column      | Arrow type | Nullable |
| ----------- | ---------- | -------- |
| `shortName` | Utf8       | yes      |
| `longName`  | Utf8       | yes      |
| `routeType` | Int32      | no       |
| `iri`       | Utf8       | no       |

### `transfers`

Schema key: `transfers`.

| Column            | Arrow type | Nullable |
| ----------------- | ---------- | -------- |
| `fromStopIdx`     | Int32      | yes      |
| `toStopIdx`       | Int32      | yes      |
| `transferType`    | Uint8      | no       |
| `minTransferTime` | Uint32     | yes      |
| `fromTripIdx`     | Int32      | yes      |
| `toTripIdx`       | Int32      | yes      |
| `fromRouteIdx`    | Int32      | yes      |
| `toRouteIdx`      | Int32      | yes      |

## Connection semantics and time

Each row is the ride between adjacent calls of one dated run. `(tripIdx,
serviceDate)` identifies that run; `(tripIdx, serviceDate, stopSequence)` identifies
the connection. `stopSequence` and `arrivalStopSequence` retain the original GTFS
sequences, which need not be consecutive, and the latter is greater. Repeated
stops have distinct connection identities. A terminal arrival is represented by
the last connection; the core does not publish a separate calls table or one-stop
run events.

Absolute seconds are reconstructed as:

```js
const departureSeconds = page.epochSeconds + row.departureTimeOffset;
const arrivalSeconds = page.epochSeconds + row.arrivalTimeOffset;
```

Offsets must fit Uint32 and arrivals must not precede departures. Arrivals may
extend beyond a page or UTC day; never take offsets modulo a bucket. `serviceDate`
is a Uint32 `YYYYMMDD` in the agency timezone. GTFS times are seconds from **local
noon minus twelve hours** on that service day, including DST transitions and
values beyond 24:00. The conversion host timezone does not determine times.

`pickupType` comes from the departure call, `dropOffType` from the arrival call:
0 regular, 1 unavailable, 2 phone the agency, 3 coordinate with the driver. Types 2
and 3 are not ordinary boarding. A connection whose departure sequence equals the
previous connection's arrival sequence continues the same run without a vehicle
change, transfer buffer or pickup restriction.

Stops preserve GTFS names, coordinates and parent hierarchy; unknown names and
coordinates remain null. Connections refer to actual platforms. `parentIdx` is
acyclic. `minTransferTime` defaults to 120 seconds, configured by
`--default-transfer-time` (including zero); a generic same-stop type-2 transfer
sets that stop's default to the explicit GTFS value. Trips refer to routes through
`routeIdx`; display names and route types retain GTFS semantics, including extended
route types.

## Page discovery and regions

GTFS2LC implements the draft's **explicit list** discovery option. It advertises
no search template or pagination strategy. Sparse periods have no page. In
particular, it does not claim `ScheduledPagination`, which would require an empty
page for every slot and prohibit splitting a busy slot.

Connections are grouped into six-hour UTC buckets with epoch
`floor(departureSeconds / 21600) * 21600`, sorted by `(departureTime, tripIdx,
serviceDate, stopSequence)`, then split into pages of at most 50,000 rows. The
six-hour boundary is an implementation choice; clients rely on descriptor bounds.
Equal departure times can cross pages. Pages in different regions overlap in
time; list order is not a global scan order. `next`/`previous` are optional for
list discovery and are not emitted by this exporter.

`--regions 1` disables region partitioning: every `stops.regionIri` is null and
pages omit `region`/`arrivalRegions`. With `--regions N`, hub clustering greedily
selects stops covering the most uncovered trips and assigns stops to the nearest
hub. It can select fewer hubs than requested. Region IRIs use the identity
strategy's `entity` template with kind `regions` and the hub's **GTFS stop ID** as
key, never a dictionary row number. Each connection appears exactly once in its
departure stop's region. Arrival region IRIs make backward page selection possible.
Stops without coordinates go into the first region.

For a departure query `[from,to)`, select pages in relevant departure regions with
`maxDepartureTime >= from && minDepartureTime < to`, comparing dateTime instants.
Merge all selected pages by absolute departure time, fetching additional regions
as they become reachable. A backward scan uses `arrivalRegions` or conservatively
loads all regions. Equal-time zero-duration chains may require repeated processing
before advancing the scan.

## Transfers and linked trips

Transfers preserve the selectors and types of GTFS `transfers.txt`. Types 0
(recommended), 1 (timed), 2 (minimum time), and 3 (forbidden) require both stops;
type 2 also requires `minTransferTime`. Null trip/route selectors are wildcards.
Clients apply the most specific matching rule, trips before routes before neither;
a station rule covers its platforms unless a platform-specific rule applies.

Types 4 (in-seat transfer) and 5 (no in-seat transfer) require both trip selectors.
Stop selectors are optional and nullable; supplied endpoints must be stops, not
stations. `minTransferTime` must be null. One incoming trip may link to several
outgoing trips (a split), and several incoming trips may link to one outgoing trip
(a join). GTFS2LC preserves these explicit links. It also derives simple in-seat
continuations from `block_id` by default; a shared public train number alone never
creates a link.

For each service date within the requested horizon, trips in the same nonempty
block are ordered by first departure. A consecutive pair gets a type-4 rule when
the first trip's last `stop_id` equals the second trip's first `stop_id`, and the
second departure follows the first arrival by zero to 1500 seconds, inclusive.
Different platforms of one parent station do not match. Calendar additions and
removals apply before derivation. Times beyond 24:00 remain on their original
service date; derivation never bridges different service dates. Blocks with only
one active trip produce no link. Splits and joins still require explicit rules.

`--no-derive-in-seat-transfers` disables derivation. Set
`--max-in-seat-transfer-gap <seconds>` to change the default 25-minute maximum;
zero allows only immediate continuations. The same options are available on
`gtfs2lc-build` and `scripts/build-sncb.js`. Library users can set
`deriveInSeatTransfers: false` or `maxInSeatTransferGap` in seconds.

Each ordered trip pair is emitted once, even if it qualifies on multiple dates.
Any explicit type-4 or type-5 row for that pair suppresses derivation, regardless
of its stop selectors. Derived rows set both stop selectors to the junction stop
and leave `minTransferTime` null. They use the existing `entity` IRI template with
kind `transfers` and a JSON key containing the two raw trip IDs. Other identifiers
and the core Arrow schemas are unchanged.

The converter prints a JSON summary to stderr and stores it as the
`inSeatTransferDerivation` schema metadata string in `transfers.arrow`. It records
`enabled`, `maxGapSeconds`, `derivedLinks` (unique pairs), `qualifyingPairDays`
(qualifying pairs counted per date before deduplication), and `skipped` counts
for `explicitRulePresent`, `differentStop`, `missingEndpointTime`, `timeOverlap`,
and `gapTooLarge`. Each rejected candidate contributes to its first matching
reason in that order. This provenance distinguishes inferred vehicle
continuations from the operator's explicit rules.

For type 4, the traveller may stay aboard from the last connection of the from run
to the first connection of its corresponding to run, without a transfer buffer or
junction pickup/drop-off restrictions. The corresponding run is the earliest first
departure not before the from run's last arrival, considering runs of the to trip
on the same or next service date. If none exists, there is no continuation. Type 5
requires alighting and applying ordinary transfer rules. The timetable exports
these relationships; run matching is the consuming planner's responsibility.

## Entity identifiers and GTFS Realtime

Default IRIs use `B=<identityBase>`, `S=<sourceId>`, with each raw key escaped once
as a path segment:

| Entity     | Default IRI                                                      |
| ---------- | ---------------------------------------------------------------- |
| Stop       | `B/S/stops/<stop_id>`                                            |
| Route      | `B/S/routes/<route_id>`                                          |
| Trip       | `B/S/trips/<trip_id>`                                            |
| Connection | `B/S/runs/<trip_id>/<YYYYMMDD>/connections/<departure-sequence>` |
| Region     | `B/S/regions/<hub-stop_id>`                                      |

`t/loop` becomes `t%2Floop`; the literal key `t%2Floop` remains distinct. Numeric
indices only join files of one release. Stable IRIs allow cross-release matching
when the publisher maintains entity identity; raw GTFS ID reuse needs a persistent
mapping or a new namespace. The draft also permits release-scoped IRIs; this
exporter's defaults are stable across releases.

`--iri-strategy <json>` accepts `strategyVersion: 1`, `identityProfile`,
`identityBase`, `timeZone`, named `bases`, `templates`, `resolve`, and `sources`.
Source overrides merge by name. `--id-base` overrides the selected source's base.
Templates can use `{base}`, `{bases.name}`, `{sourceId}`, or escaped context fields
such as `{trips.key}` and `{connection.stopSequence}`. Safe resolvers support field
paths, `substring`, `format`, and structured `literal`, `coalesce`, `concat` and
`padStart`. Arbitrary JavaScript and prototype access are rejected. This builder's
strategy is separate from the RFC 6570 templates exposed to GTFS-RT consumers.

Optionally supply `--realtime feeds.json`, containing an array like:

```json
[
  {
    "@id": "https://data.example.org/gtfs-rt/trip-updates",
    "@type": "GtfsRealtimeFeed",
    "tripTemplate": "https://data.example.org/id/example.transit/trips/{trip_id}",
    "stopTemplate": "https://data.example.org/id/example.transit/stops/{stop_id}",
    "routeTemplate": "https://data.example.org/id/example.transit/routes/{route_id}"
  }
]
```

`tripTemplate` is required. Include `stopTemplate` and `routeTemplate` when the
feed uses those identifiers. Feeds are served as `application/x-protobuf` over HTTP.
The exporter expands each supplied RFC 6570 template for **every corresponding
GTFS entity** and rejects any mismatch with the generated IRI. A custom identity
strategy that cannot be reproduced by such templates cannot be linked this way.
The exporter neither downloads nor snapshots the feed; its changing bytes are
outside the immutable release.

Consumers join feeds using exact, case-sensitive minted IRIs, then `start_date`
as the run's service date and `stop_sequence` as the call sequence. An arrival
update belongs to the connection ending at that call; a departure update belongs
to the one starting there. A repeated stop cannot be matched unambiguously from
`stop_id` alone. Without `start_date`, accept only a uniquely identifiable run
using absolute update times and the accepted delay range; a delay alone requires
one candidate run in the release. Future runs remain eligible.

Apply GTFS-RT cancellation, skipped-call and delay propagation semantics. Scheduled
connection identities stay fixed. Effective departures can change order: fetch a
wider scheduled interval and re-sort by effective departure time. Added or
unscheduled trips have no core connections here. See the draft for full realtime
matching rules.

## Validation, limits and migration

There is one Arrow contract shared by the default and iRail presets. It does not publish
Arrow realtime overlays, accessibility attributes, shapes, occupancy, train
composition, alerts or a live update server; the draft leaves them unstandardized.

The converter rejects orphan numeric references, duplicate dictionary IDs and
call sequences, IRI collisions, cyclic parents, invalid times, arrival before
departure, overflowing offsets, unsupported transfer types and malformed linked
transfers. It preserves calendar exceptions, original service dates, repeated stops,
non-consecutive sequences and pickup/drop-off values. An independent HTTP reader,
[examples/read-arrow.js](examples/read-arrow.js), follows table IRI strings and
page entries, checks IPC framing, release metadata and schemas, and validates page
time bounds and ordering. The source index
command discovers LC2-alpha `manifest.jsonld` releases from either preset.

Nonempty `frequencies.txt` and `pathways.txt`, missing interior times and multiple
agency timezones remain unsupported and are rejected. Shapes are ignored by the
core exporter. It does not interpolate times or provide complete step-free routing.
Core connections do not retain all single-stop run or standalone terminal-call
information needed for a station-board application.

Sorting uses disk-backed runs of 50,000 rows and currently limits each
region/six-hour bucket to 64 runs; use more regions for larger datasets. Dictionaries,
one trip pattern and region trip sets still need memory. Arrow expansion runs in
the batch process; `--workers` controls legacy RDF conversion. Run generation as a
bounded batch job.
