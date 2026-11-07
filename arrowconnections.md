# Linked Connections v2-alpha: Arrow Connections

**Draft specification · 7 November 2026.** This is the second generation of the
Linked Connections specification. The alpha identifier is `2-alpha`; it is not a
stable v2 release. It replaces the experimental gtfs2lc Arrow versions 1–5.
[Linked Connections 1.0](https://linkedconnections.org/specification/1-0) remains
available for RDF/JSON-LD consumers.

Arrow Connections publishes a timetable as typed Apache Arrow tables. Compact
release-local indices make connection scans efficient; explicit global IRIs link
the same stops, trips, dated runs and calls across tables and independent updates.
A scheduled connection is one adjacent call-to-call ride on one dated run.
Terminal calls and dwell times are retained separately, so the same release can
support journey planning, station boards and dated trip views.

The static release is generated from **one GTFS Schedule source plus deterministic
identity and partition configuration**. Crowdedness, forecasts, compositions,
disruptions and real-time estimates are independent overlays. They do not become
columns in planning pages and do not block timetable generation.

The words MUST, SHOULD and MAY express requirements, recommendations and options.
A producer claiming the core profile MUST implement the core tables, identifiers,
release consistency and validation below. Optional enrichment schemas do not
imply source availability or an implemented collector.

## Quick start

Use Node.js 24 or later and the converter checkout containing this implementation.
An npm release is not required; pin a reviewed Git commit for reproducible builds.
The cleaner normalizes and sorts the extracted source in place, so retain the
original archive when you need an unchanged input.

```sh
node bin/gtfs2lc.js /path/to/extracted/gtfs --format arrow \
  --source-id example.transit --id-base https://data.example.org/id \
  --start-date 20261107 --end-date 20261114 --regions 4 \
  --release-id timetable-20261107 --output ./data
```

Serve `data/` as the origin root, fetch `/manifest.json`, and follow its descriptors.
The default identity base `https://example.org/id` is illustrative: publishers
SHOULD configure an authority they control. `--source-id` is required and identifies
a persistent operator namespace, not a mirror or collection channel.

The default `--profile linked-connections-v2-alpha` writes `format: "linked-connections"`,
`version: "2-alpha"`, and `identityProfile: "lc-global-v1"`. The explicit
`--profile irail-cdn-v1` writes `format: "irail-cdn"`, numeric `version: 1`, and
`identityProfile: "irail-global-v1"`, with the same ordered schemas. Its default
delivery prefix is `/data`; mount the generated directory there. These are distinct
publication contracts; do not interpret the iRail version number as Linked
Connections 1.0. `--url-prefix /some/path` changes delivery paths without changing
entity identity. The two profiles never produce experimental Arrow version 5.

## Wire format and versions

Every `.arrow` resource MUST be an independently readable **Arrow IPC file**,
little-endian, with `ARROW1` framing and a footer. IPC streams are not v2-alpha
files. IPC-level compression is disabled; a server MAY negotiate HTTP content
encoding while preserving the decoded Arrow bytes. Use media type
`application/vnd.apache.arrow.file`. Descriptors hash the unencoded file bytes.

Required schema metadata is `format=linked-connections`, `schemaVersion=2-alpha`,
`identityProfile=lc-global-v1`, `dataset=<schema key below>`, `releaseId=<release ID>`.
The iRail profile substitutes its format, schema version and identity profile.
The exporter also records `specification=https://linkedconnections.org/specification/2-0-alpha`.
Planning pages additionally carry decimal `epochSeconds`, equal to the descriptor.

Consumers MUST check the format/version and required column types and nullability.
The tables below give the complete ordered baseline. Compatible extensions MAY
append nullable fields; consumers SHOULD locate known columns by name and tolerate
such additions. Incompatible changes require a different version. A release ID
identifies a dataset generation, never a schema revision. Alpha revisions should
be pinned to a specification/exporter commit while the draft evolves.

All absolute times are POSIX seconds in UTC, not milliseconds. Int64 time columns
are nullable signed 64-bit integers (Arrow JS exposes BigInt). Planning offsets use
Uint32. Missing optional values use Arrow null, not empty strings or zero. Numeric
row references are zero-based Int32 values within the same static release; `-1`
is allowed only for documented absent references such as a stop parent or shape.

## Discovery and immutable releases

Fetch and retain one `manifest.json` for the query/session. It pins dictionary and
planning descriptors and is also published at `/releases/<releaseId>/manifest.json`
(with the configured delivery prefix). Paths are origin-relative URLs, resolved
against the manifest response URL. Consumers MUST follow these paths rather than
construct filenames. The root discovery document may change; release objects MUST
never change their bytes or reuse an ID.

Required manifest members:

| Member                                                      | Meaning                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `format`, `version`                                         | `linked-connections`, string `2-alpha`                                                                            |
| `specification`                                             | The v2-alpha specification URL                                                                                    |
| `status`                                                    | `production` for a converted source; fixtures must be explicitly identified                                       |
| `sourceId`, `sourceIri`                                     | Persistent source namespace and its global IRI                                                                    |
| `identityProfile`, `identityBase`                           | Identity contract and authority                                                                                   |
| `identityStrategy`                                          | Descriptor of the effective `identity-strategy.json`                                                              |
| `releaseId`, `generatedAt`, `timeZone`                      | Unique generation, UTC build instant, GTFS agency timezone                                                        |
| `sources[]`                                                 | Source attribution, license (null if unknown), and source content fingerprint                                     |
| `coverage.start`, `coverage.end`                            | Half-open UTC departure bounds; arrivals may extend past the end                                                  |
| `coverage.startServiceDate`, `coverage.endServiceDate`      | Inclusive service-date bounds represented by connections                                                          |
| `partitioning.timePartitionSeconds`, `partitioning.maxRows` | 21,600 seconds and at most 50,000 rows per page                                                                   |
| `partitioning.regions[]`                                    | Source-local region IDs with optional hub coordinates                                                             |
| `capabilities`                                              | Dataset availability; unavailable data must not masquerade as a successful empty response                         |
| `files`                                                     | Required stops/trips/routes/calls/transfers descriptors and planning descriptor array; optional shapes/enrichment |

Every file descriptor MUST include `path`, `rowCount`, `byteLength`, `sha256`
(lowercase hexadecimal SHA-256) and `mediaType`. The identity strategy descriptor
has the same members except `rowCount`. Planning descriptors additionally contain
`epochSeconds`, `regionId`, inclusive `minDepartureTime` and `maxDepartureTime`,
and sorted unique `arrivalRegions`.

[Download the complete illustrative manifest](examples/manifest.json). Its
`demo.fixture` data is synthetic. A production publisher must supply attribution
and determine its right to republish the source; a null license is not a license.

Build in private temporary storage. Validate the full release, finalize immutable
objects, and replace discovery **last**. A failed conversion MUST preserve the
previous discovery document. The local exporter uses a directory rename followed
by atomic manifest replacement and rejects reused release IDs. Production object
storage needs equivalent staging and a single coordinated publisher; concurrent
writers must not move discovery backwards. Retain old releases for the advertised
client/cache lifetime. Serve discovery with a short cache lifetime, immutable files
with long caching, and provide GET/HEAD, CORS, content types and validators.

## Partitioning, time and ordering

Each departure stop belongs to exactly one region. A connection is published only
in its departure region. Producers MAY choose a region algorithm; clients MUST
use published region assignments. This exporter uses one region by default or
hub-based clustering with `--regions`. The number of selected hubs may be smaller
than requested. Region boundaries must not remove possible transfers.

Compute the page epoch as `floor(departureSeconds / 21600) * 21600`. Buckets start
at 00:00, 06:00, 12:00 and 18:00 UTC. Sort each region/bucket by
`(departureTimeOffset, tripIdx, serviceDate, stopSequence)` and split into files of
at most 50,000 rows. Sparse buckets need no empty pages. Equal departure times may
cross page boundaries and regions; page-array order is not a global scan order.

```js
const departureSeconds = page.epochSeconds + row.departureTimeOffset;
const arrivalSeconds = page.epochSeconds + row.arrivalTimeOffset;
```

Departure offsets MUST be less than 21,600. Arrival offsets MAY extend beyond the
bucket or UTC day; never take them modulo a bucket. Both MUST fit Uint32 without
wrapping, and arrival MUST not precede departure. For a departure query `[from,to)`,
a page can intersect when `maxDepartureTime >= from && minDepartureTime < to`.
A backward scan must discover incoming regions through `arrivalRegions` or read
all relevant regions conservatively.

Expand GTFS active service dates, including calendar exceptions, in the agency
timezone. GTFS times measure seconds from **local noon minus twelve hours** on the
service date; this matters on DST transitions. Preserve times beyond 24:00 and the
original service date even when the event falls on another UTC or local day.
Never let the conversion host's timezone determine the schedule. The exporter
requires one agency timezone per release. `--start-date` and `--end-date` filter
service days inclusively, rather than clipping after-midnight events by UTC date.

## Global identifiers

Use one canonical IRI for an entity in Arrow, real-time observations and RDF.
Release IDs, row numbers, delivery hosts, estimated times and current platforms
MUST NOT determine stable event identity. Indices accelerate joins inside a pinned
release; IRIs support explicit reconciliation across releases and sources.

Default templates use `B=<identityBase>`, `S=<sourceId>`, and one escaped path
component per opaque key:

| Entity                         | Default IRI                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| Source / channel               | `B/S/source`, `B/S/providers/<channel>`                           |
| Stop / station                 | `B/S/stops/<key>`, `B/S/stations/<key>`                           |
| Agency / route / trip template | `B/S/agencies/<key>`, `B/S/routes/<key>`, `B/S/trips/<key>`       |
| Dated run                      | `B/S/runs/<trip-key>/<YYYYMMDD>`                                  |
| Call                           | `B/S/runs/<trip-key>/<YYYYMMDD>/calls/<original-sequence>`        |
| Connection                     | `B/S/runs/<trip-key>/<YYYYMMDD>/connections/<departure-sequence>` |
| Shape / unit                   | `B/S/shapes/<key>`, `B/S/units/<key>`                             |

Repeated stops retain distinct calls through their original sequences. Sequences
need not be consecutive: 10 → 20 is an adjacent connection when there is no call
between them. A public train number or `block_id` alone does not identify a dated
run or prove passengers can stay on board across trips.

Source IDs follow `[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*`. Raw keys are opaque and
case-sensitive; percent-encode the entire key exactly once as one RFC 3986 path
component. `t/loop` becomes `t%2Floop`; literal `t%2Floop` is different. Reject
empty/dot keys, missing resolver fields and IRI collisions. If an upstream source
renumbers or reuses IDs, publishers need a persistent mapping or new logical keys;
this converter cannot infer real-world continuity from changing raw IDs.

`--iri-strategy <json>` configures `strategyVersion: 1`, `identityProfile`,
`identityBase`, `timeZone`, named `bases`, `templates`, `resolve`, and `sources`.
Source-specific bases/templates/resolvers override global values by name.
`--id-base` overrides the selected source's base. The release pins the effective
rules and their hash; collection channels should share them. Preserve established
station IRIs only from verified mappings. The SNCB profile recognizes station UICs
and keeps platform identities distinct; arbitrary international or platform IDs
must not be blindly padded into SNCB station codes.

Templates insert `{base}`, `{bases.name}`, `{sourceId}`, or escaped context fields
such as `{trips.key}` and `{connection.stopSequence}`. Available roots include
`stops`, `routes`, `trips`, `connection`, `agency`, `shapes`, `provider`, `unit`, and
`entity`. Resolvers support own-property paths, `substring(start,end)`,
`format(value, 'yyyyMMdd')`, and structured `literal`, `coalesce`, `concat` and
`padStart` expressions. Date patterns support `yyyy`, `yy`, `MM`, `dd`, `HH`, `mm`,
`ss` and quoted literals. Instants need an explicit timezone; service dates retain
their calendar day. Prototype access, arbitrary JavaScript, imports and resolver
cycles are rejected. Identity and delivery configuration are separate.

## Core table semantics

### Planning connections

Each planning row is an adjacent scheduled ride. Its local key is
`(tripIdx, serviceDate, stopSequence)` and its global identity is `iri`.
`arrivalStopSequence` is the next original call sequence and MUST be greater than
`stopSequence`. The departure call supplies departure time and pickup restrictions;
the arrival call supplies arrival time and drop-off restrictions. Every numeric
and IRI relationship MUST agree with the referenced dictionary and call rows.

### Stops, trips and routes

Stops preserve actual platform identities. `parentIdx=-1` means no parent;
`parentIri` is null then. Validate an acyclic hierarchy and use `stationIri` to
group a station family without losing event locations. Names, coordinates and
platform labels may be unknown. The default `minTransferTime` is 120 seconds and
can be configured with `--default-transfer-time`, including zero when justified.
An unrestricted same-stop type-2 transfer replaces that stop's fallback. Curated
station codes, localized names and transfer statistics remain null unless supplied
by an independently documented enrichment process.

Trips are templates; `routeIdx` and `routeIri` identify the route. `shapeIdx=-1`
means no shape, while `geometryIdx=-1` is reserved in this version. `headsign`,
`shortName`, `blockId`, wheelchair and bicycle fields retain GTFS meanings.
`vehicleIri` and product classification remain null without a reliable mapping.
Routes preserve raw `route_type`, including extended codes; unknown codes are not
implicitly rail. `agencyIri` is global while `agencyId` retains the raw source ID.

Nullable accessibility/bicycle enum fields distinguish absent (null) from explicit
GTFS unknown (0): wheelchair boarding/trip accessibility use 1 for possible and 2
for not possible; bikes use 1 allowed and 2 not allowed. Direction is 0/1 with no
global geographical meaning. Pickup/drop-off codes are 0 regular, 1 forbidden,
2 phone arrangements, 3 coordination with the driver. Codes 2/3 need explicit
booking support; they must not silently become ordinary unrestricted boarding.

### Calls and transfers

`calls.arrow` contains all scheduled calls, including terminal arrivals and
one-stop runs, ordered by `(tripIdx, serviceDate, stopSequence)`. At least one of
arrival/departure exists. Origin arrival and terminal departure may be null.
Preserve dwell and original sequences. Stop-specific headsigns override the trip
headsign. `shapeDistance` retains native `shape_dist_traveled` units. Reject
untimed interior calls unless an explicit interpolation policy is implemented.

Transfer types 0/1/2/3 mean recommended/timed/minimum-time/forbidden. A type-2 rule
MUST have `minTransferTime`. Null route/trip selectors mean unconstrained, and
trip-specific rules take precedence over route-specific and generic rules under
GTFS specificity. Validate duplicate selector tuples and applicable conflicts.
Inherit station rules to child platforms without erasing platform-specific rules.
Timed transfers are not permission to set every buffer to zero. Inter-stop walking
needs measured/routable durations; proximity alone does not prove a footpath.

### Shapes

`shapes.arrow` is an index. Each row's `path` points to a separate ordered
`shapePoints` IPC file; `pointCount` is its row count. Sequence numbers need not be
consecutive. Coordinates are WGS84 degrees; distances are optional and remain in
source units when `distanceUnit` is null. Clip a trip shape using ordered calls and
shape distances, preserving repeated coordinates and loops. Shape geometry is a
route polyline, not a physical railway topology or evidence of walkability.

## Ordered core schemas

The schema key is the value of Arrow metadata `dataset`. Columns appear in the
following exact order. `Nullable: yes` requires a validity bitmap when null values
are present. Optional nullable extensions may follow these baseline columns.

### `planning.arrow`

Schema key: `planning`.

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
| `tripIri`             | Utf8       | no       |
| `runIri`              | Utf8       | no       |
| `departureStopIri`    | Utf8       | no       |
| `arrivalStopIri`      | Utf8       | no       |
| `departureCallIri`    | Utf8       | no       |
| `arrivalCallIri`      | Utf8       | no       |

### `stops.arrow`

Schema key: `stops`.

| Column                 | Arrow type | Nullable |
| ---------------------- | ---------- | -------- |
| `stopId`               | Utf8       | no       |
| `name`                 | Utf8       | yes      |
| `lat`                  | Float64    | yes      |
| `lon`                  | Float64    | yes      |
| `parentIdx`            | Int32      | no       |
| `regionIdx`            | Int32      | no       |
| `iri`                  | Utf8       | no       |
| `stationIri`           | Utf8       | yes      |
| `minTransferTime`      | Uint32     | no       |
| `stationId`            | Utf8       | yes      |
| `hafasId`              | Utf8       | yes      |
| `nameNl`               | Utf8       | yes      |
| `nameFr`               | Utf8       | yes      |
| `nameDe`               | Utf8       | yes      |
| `nameEn`               | Utf8       | yes      |
| `countryCode`          | Utf8       | yes      |
| `tafTapCode`           | Utf8       | yes      |
| `telegraphCode`        | Utf8       | yes      |
| `platformCode`         | Utf8       | yes      |
| `officialTransferTime` | Uint32     | yes      |
| `avgStopTimes`         | Float64    | yes      |
| `wheelchairBoarding`   | Uint8      | yes      |
| `parentIri`            | Utf8       | yes      |

### `trips.arrow`

Schema key: `trips`.

| Column                 | Arrow type | Nullable |
| ---------------------- | ---------- | -------- |
| `tripId`               | Utf8       | no       |
| `routeIdx`             | Int32      | no       |
| `headsign`             | Utf8       | yes      |
| `shortName`            | Utf8       | yes      |
| `vehicleIri`           | Utf8       | yes      |
| `shapeIdx`             | Int32      | no       |
| `geometryIdx`          | Int32      | no       |
| `directionId`          | Uint8      | yes      |
| `blockId`              | Utf8       | yes      |
| `wheelchairAccessible` | Uint8      | yes      |
| `bikesAllowed`         | Uint8      | yes      |
| `iri`                  | Utf8       | no       |
| `routeIri`             | Utf8       | no       |
| `shapeIri`             | Utf8       | yes      |

### `routes.arrow`

Schema key: `routes`.

| Column      | Arrow type | Nullable |
| ----------- | ---------- | -------- |
| `routeId`   | Utf8       | no       |
| `shortName` | Utf8       | yes      |
| `longName`  | Utf8       | yes      |
| `iri`       | Utf8       | no       |
| `agencyId`  | Utf8       | no       |
| `routeType` | Int32      | no       |
| `product`   | Utf8       | yes      |
| `agencyIri` | Utf8       | no       |

### `calls.arrow`

Schema key: `calls`.

| Column          | Arrow type | Nullable |
| --------------- | ---------- | -------- |
| `tripIdx`       | Int32      | no       |
| `serviceDate`   | Uint32     | no       |
| `stopSequence`  | Uint32     | no       |
| `stopIdx`       | Int32      | no       |
| `arrivalTime`   | Int64      | yes      |
| `departureTime` | Int64      | yes      |
| `pickupType`    | Uint8      | no       |
| `dropOffType`   | Uint8      | no       |
| `headsign`      | Utf8       | yes      |
| `shapeDistance` | Float64    | yes      |
| `iri`           | Utf8       | no       |
| `tripIri`       | Utf8       | no       |
| `runIri`        | Utf8       | no       |
| `stopIri`       | Utf8       | no       |

### `transfers.arrow`

Schema key: `transfers`.

| Column            | Arrow type | Nullable |
| ----------------- | ---------- | -------- |
| `fromStopIdx`     | Int32      | no       |
| `toStopIdx`       | Int32      | no       |
| `transferType`    | Uint8      | no       |
| `minTransferTime` | Uint32     | yes      |
| `fromTripIdx`     | Int32      | yes      |
| `toTripIdx`       | Int32      | yes      |
| `fromRouteIdx`    | Int32      | yes      |
| `toRouteIdx`      | Int32      | yes      |
| `iri`             | Utf8       | no       |
| `fromStopIri`     | Utf8       | no       |
| `toStopIri`       | Utf8       | no       |
| `fromTripIri`     | Utf8       | yes      |
| `toTripIri`       | Utf8       | yes      |
| `fromRouteIri`    | Utf8       | yes      |
| `toRouteIri`      | Utf8       | yes      |

### `shapes.arrow`

Schema key: `shapes`.

| Column         | Arrow type | Nullable |
| -------------- | ---------- | -------- |
| `shapeId`      | Utf8       | no       |
| `path`         | Utf8       | no       |
| `pointCount`   | Uint32     | no       |
| `distanceUnit` | Utf8       | yes      |
| `iri`          | Utf8       | no       |

### `shapes/*.arrow`

Schema key: `shapePoints`.

| Column     | Arrow type | Nullable |
| ---------- | ---------- | -------- |
| `sequence` | Uint32     | no       |
| `lat`      | Float64    | no       |
| `lon`      | Float64    | no       |
| `distance` | Float64    | yes      |
| `iri`      | Utf8       | no       |
| `shapeIri` | Utf8       | no       |

## Independent overlays

The core static converter does not collect live data. Overlay publishers MUST
identify observation/source times, provenance, expiry/coverage and the static
release used by numeric indices. A canonical IRI can be reconciled across releases;
a matching integer index cannot. Publish overlays under their own immutable
snapshot descriptors and replace their own discovery last. Unavailable, stale and
successful-empty are distinct states.

- **Delays/cancellations:** preserve the original GTFS-RT TripUpdates protobuf when
  available. A normalized row selects a run or call using `scope` and
  `scheduleRelationship`. Resolve source-specific observations by entity, field
  and scope using freshness and provenance. Arrival and departure estimates are
  independent. Preserve run cancellation, skipped calls, NO_DATA and source
  retraction separately. Additional trips need complete identities/calls before
  routing; scheduled connection identity never changes because of a delay.
- **Occupancy:** observations and forecasts are independent `occupancy.arrow`
  snapshots joined by departure `callIri`. Levels are `low`, `medium`, `high` or
  `unknown`; ordinal scores are 0, 0.5 and 1 respectively, with null for unknown
  (not measured load percentages). Preserve source, original
  observation/model-generation time and expiry. Never embed crowdedness in the
  timetable or pretend GTFS supplies it.
- **Compositions:** ordered physical units per dated run and call-bounded segment,
  including one-unit trains. Segment bounds are original call sequences;
  `position` is zero-based. `confirmedBy` retains the upstream confirmation/origin indicator. Orientation
  is `left` or `right` for rolling-material display, not geographical heading.
  Capacities are counts; nullable amenities distinguish unknown from false.
  Preserve unit identity, orientation, observation time and source. Historical
  fallback must be explicitly identified; it is not a fresh observation.
- **Alerts:** `alerts` stores one language row per alert; `alertEntities` stores
  associated stop/route/trip/run/call selectors. Do not guess omitted selectors.
  Text and links retain language, issuer, validity and source timestamps.
- **Stop status:** per-call arrival/departure platforms, cancellation flags and
  reported states are independently nullable. The clock passing an event does
  not establish a reported arrival or departure.

These schemas are optional contracts, not a claim that gtfs2lc produces live
snapshots. Extensions must document their semantic enums and resolver policy.
In `delaysCancellations`, `scope` is `trip` or `stop`; `stopSequence=0` is a trip-scope
sentinel only when scope is `trip`. Relationships use GTFS-RT uppercase names
such as `SCHEDULED`, `CANCELED`, `SKIPPED`, `NO_DATA`, `ADDED`, `UNSCHEDULED` or
`REPLACEMENT`, with applicability declared by the publisher. Event times and
observations use UTC seconds. Optional provenance/expiry fields may be appended.

### `compositions.arrow`

Schema key: `compositions`.

| Column                          | Arrow type | Nullable |
| ------------------------------- | ---------- | -------- |
| `tripIdx`                       | Int32      | no       |
| `serviceDate`                   | Uint32     | no       |
| `segmentId`                     | Utf8       | no       |
| `fromStopSequence`              | Uint32     | no       |
| `toStopSequence`                | Uint32     | no       |
| `position`                      | Uint32     | no       |
| `unitUic`                       | Utf8       | yes      |
| `materialNumber`                | Utf8       | yes      |
| `materialType`                  | Utf8       | yes      |
| `materialSubType`               | Utf8       | yes      |
| `materialSubTypeName`           | Utf8       | yes      |
| `tractionType`                  | Utf8       | yes      |
| `orientation`                   | Utf8       | yes      |
| `confirmedBy`                   | Utf8       | yes      |
| `seatsFirstClass`               | Uint32     | yes      |
| `seatsSecondClass`              | Uint32     | yes      |
| `seatsCoupeFirstClass`          | Uint32     | yes      |
| `seatsCoupeSecondClass`         | Uint32     | yes      |
| `standingPlacesFirstClass`      | Uint32     | yes      |
| `standingPlacesSecondClass`     | Uint32     | yes      |
| `tractionPosition`              | Uint32     | yes      |
| `lengthInMeter`                 | Float32    | yes      |
| `hasToilet`                     | Bool       | yes      |
| `hasPrmToilet`                  | Bool       | yes      |
| `hasTables`                     | Bool       | yes      |
| `hasFirstClassOutlets`          | Bool       | yes      |
| `hasSecondClassOutlets`         | Bool       | yes      |
| `hasHeating`                    | Bool       | yes      |
| `hasAirco`                      | Bool       | yes      |
| `hasBikeSection`                | Bool       | yes      |
| `canPassToNextUnit`             | Bool       | yes      |
| `hasSemiAutomaticInteriorDoors` | Bool       | yes      |
| `hasLuggageSection`             | Bool       | yes      |
| `hasPrmSection`                 | Bool       | yes      |
| `hasPriorityPlaces`             | Bool       | yes      |
| `source`                        | Utf8       | no       |
| `observedAt`                    | Int64      | no       |
| `iri`                           | Utf8       | no       |
| `tripIri`                       | Utf8       | no       |
| `runIri`                        | Utf8       | no       |
| `fromCallIri`                   | Utf8       | no       |
| `toCallIri`                     | Utf8       | no       |
| `sourceIri`                     | Utf8       | no       |
| `unitIri`                       | Utf8       | yes      |

### `occupancy.arrow`

Schema key: `occupancy`.

| Column         | Arrow type | Nullable |
| -------------- | ---------- | -------- |
| `tripIdx`      | Int32      | no       |
| `serviceDate`  | Uint32     | no       |
| `stopSequence` | Uint32     | no       |
| `level`        | Utf8       | no       |
| `score`        | Float32    | yes      |
| `source`       | Utf8       | no       |
| `observedAt`   | Int64      | no       |
| `expiresAt`    | Int64      | yes      |
| `iri`          | Utf8       | no       |
| `callIri`      | Utf8       | no       |
| `sourceIri`    | Utf8       | no       |

### `alerts.arrow`

Schema key: `alerts`.

| Column        | Arrow type | Nullable |
| ------------- | ---------- | -------- |
| `alertId`     | Utf8       | no       |
| `language`    | Utf8       | no       |
| `type`        | Utf8       | no       |
| `header`      | Utf8       | yes      |
| `lead`        | Utf8       | yes      |
| `description` | Utf8       | yes      |
| `company`     | Utf8       | yes      |
| `linksJson`   | Utf8       | yes      |
| `validFrom`   | Int64      | yes      |
| `validTo`     | Int64      | yes      |
| `modifiedAt`  | Int64      | yes      |
| `source`      | Utf8       | no       |
| `observedAt`  | Int64      | no       |
| `iri`         | Utf8       | no       |
| `sourceIri`   | Utf8       | no       |

### `alert-entities.arrow`

Schema key: `alertEntities`.

| Column         | Arrow type | Nullable |
| -------------- | ---------- | -------- |
| `alertId`      | Utf8       | no       |
| `stopIdx`      | Int32      | yes      |
| `routeIdx`     | Int32      | yes      |
| `tripIdx`      | Int32      | yes      |
| `serviceDate`  | Uint32     | yes      |
| `stopSequence` | Uint32     | yes      |
| `iri`          | Utf8       | no       |
| `alertIri`     | Utf8       | no       |
| `stopIri`      | Utf8       | yes      |
| `routeIri`     | Utf8       | yes      |
| `tripIri`      | Utf8       | yes      |
| `runIri`       | Utf8       | yes      |
| `callIri`      | Utf8       | yes      |

### `stop-status.arrow`

Schema key: `stopStatus`.

| Column               | Arrow type | Nullable |
| -------------------- | ---------- | -------- |
| `tripIdx`            | Int32      | no       |
| `serviceDate`        | Uint32     | no       |
| `stopSequence`       | Uint32     | no       |
| `arrivalPlatform`    | Utf8       | yes      |
| `departurePlatform`  | Utf8       | yes      |
| `arrivalCancelled`   | Bool       | yes      |
| `departureCancelled` | Bool       | yes      |
| `isExtra`            | Bool       | yes      |
| `arrivalState`       | Utf8       | yes      |
| `departureState`     | Utf8       | yes      |
| `notesJson`          | Utf8       | yes      |
| `source`             | Utf8       | no       |
| `observedAt`         | Int64      | no       |
| `iri`                | Utf8       | no       |
| `callIri`            | Utf8       | no       |
| `sourceIri`          | Utf8       | no       |

### `delays-cancellations.arrow`

Schema key: `delaysCancellations`.

| Column                 | Arrow type | Nullable |
| ---------------------- | ---------- | -------- |
| `tripIdx`              | Int32      | no       |
| `serviceDate`          | Uint32     | no       |
| `stopSequence`         | Uint32     | no       |
| `scope`                | Utf8       | no       |
| `scheduleRelationship` | Utf8       | no       |
| `arrivalTime`          | Int64      | yes      |
| `departureTime`        | Int64      | yes      |
| `arrivalDelay`         | Int32      | yes      |
| `departureDelay`       | Int32      | yes      |
| `assignedStopIdx`      | Int32      | yes      |
| `uncertainty`          | Uint32     | yes      |
| `source`               | Utf8       | no       |
| `observedAt`           | Int64      | no       |
| `iri`                  | Utf8       | no       |
| `tripIri`              | Utf8       | no       |
| `runIri`               | Utf8       | no       |
| `sourceIri`            | Utf8       | no       |
| `callIri`              | Utf8       | yes      |
| `assignedStopIri`      | Utf8       | yes      |

## Consuming the release

1. Fetch and pin discovery; check format/version, source, coverage and descriptors.
   Load stops/transfers and fetch trip/route labels as needed. Check hashes and
   schema metadata before mixing objects into the query.
2. Resolve stations into their platform families, preserving actual call stops.
   Select candidate planning pages by bounds and departure regions, then
   heap-merge cursors by absolute departure time. Equal-time zero-duration chains
   may need a fixed point before advancing the scan.
3. Track on-board continuity by **dated run and original call sequence**. Staying
   aboard bypasses boarding restrictions and transfer buffers, while boarding and
   alighting must honor pickup/drop-off. Keep route/trip/platform context for
   specific transfer rules; one earliest label per station is not sufficient for
   every constrained transfer.
4. Join independent updates to the appropriate departure and arrival calls.
   Cancelled runs cannot be boarded; skipped events disallow boarding/alighting.
   Re-sort by **effective** departure time before a real-time scan and widen the
   fetched interval for delays/additional service. Static bounds alone do not
   establish effective ordering.
5. Reconstruct contiguous rides using ordered calls and look up labels, occupancy,
   composition segments, alerts and geometry after selecting journeys. An
   arrive-by/profile/multi-criteria planner needs its own reverse constraints and
   labels; a basic earliest-arrival scan does not reproduce every journey ranking.

## Incremental RDF updates

A publisher MAY offer an independent Linked Data Event Stream using the same
canonical IRIs. This alpha does not require a feed for a core static release and
`gtfs2lc` does not run an update server. The iRail profile describes a 12-hour
LDES 2.0 working-draft observation feed at `/feed`, encoded as Jelly-RDF 1.2 with
HTTP Zstandard. It sends a description RDF Message first, then one member per
message, ordered by commit timestamp and a monotonic tie-breaking sequence.

Such a feed must declare timestamp/member/version paths, interval pagination,
retention and source provenance. Upsert and source-state retraction are distinct
from train cancellation. Observation feeds are folded by entity **and source**
before field resolution; consumers must not blindly treat the last observation
from any source as complete effective state. A consumer outside retained history
must bootstrap from current snapshots. The iRail feed is a separate publication
profile, not a replacement for static release consistency or a mandatory part of
v2-alpha.

## Validation, limitations and migration

Producers MUST reject orphan/out-of-range numeric references, disagreement between
numeric and IRI joins, duplicate event identities, cyclic stop parents, invalid
times, overflowing offsets, negative travel times, inconsistent epochs, unsorted
pages and descriptors inconsistent with published bytes. Original service dates,
non-consecutive sequences, repeated stops, terminals, dwell, pickup/drop-off and
calendar exceptions MUST survive conversion.

The exporter rejects nonempty `frequencies.txt` and `pathways.txt`, linked-trip
transfer types 4/5, missing interior times, multiple agency timezones, duplicate
call sequences and unknown referenced entities. It does not interpolate times,
infer cross-trip stay-on-board links, import curated station translations, collect
live overlays or provide complete step-free routing. It uses disk-backed planning
sort runs of 50,000 rows and currently limits one region/bucket to 64 runs; increase
partitioning for larger buckets. Dictionaries, one trip pattern and shapes still
need memory. `--workers` controls legacy RDF conversion; Arrow expansion currently
runs in the batch process. Run static generation as a bounded batch job, not in an
edge request.

Experimental Arrow versions 1–5 used a different manifest, IPC streams, fewer
identity fields and incomplete calls. They are **not** Linked Connections
specification versions. Rebuild those datasets from GTFS and update consumers to
this contract. There is no lossless adapter from connection-only exports because
terminal calls and original event identity may be missing. Linked Connections 1.0
RDF publication remains available independently; v2-alpha consumers must explicitly
select the new format. Do not rename an old version-5 manifest to `2-alpha`.

## References

- [Apache Arrow columnar and IPC file format](https://arrow.apache.org/docs/format/Columnar.html)
- [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/)
- [GTFS Realtime reference](https://gtfs.org/documentation/realtime/reference/)
- [Linked Connections 1.0](https://linkedconnections.org/specification/1-0)
- [gtfs2lc implementation](https://github.com/linkedconnections/gtfs2lc/tree/feat-arrow)
