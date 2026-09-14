# Arrow Connections format

Arrow Connections is the route-planning output of `gtfs2lc --format arrow`.
It stores stop/trip indices and connection times in typed columns, rather
than RDF terms or connection IRIs. The browser prototype is documented in
[`public/README.md`](public/README.md).

## Version 5

Connections are grouped by departure-stop region and six-hour UTC bucket,
then split into independently readable Arrow IPC stream pages of at most
50,000 rows. Each page is sorted by departure time ascending. A profile
planner can read its column arrays backward and merge pages with a heap.

Version 5 changes the published timestamp encoding and adds a page index.
Raw conversion-worker files still use the internal absolute-timestamp
schema; the merge validates and converts timestamps when publishing pages.

| Version | Connection layout                                                 |
| ------- | ----------------------------------------------------------------- |
| 1       | Original absolute-timestamp connection schema                     |
| 2       | Stop tables gained `parentIdx`                                    |
| 3       | Region/month files; `connections.files[region][YYYY-MM]`          |
| 4       | Region/six-hour files; `connections.files[region][YYYY-MM-DDTHH]` |
| 5       | Indexed independent pages; relative timestamps described below    |

The bundled planner reads versions 3–5. Version-3/4 timestamp columns remain
`TimestampSecond` values in `BigInt64Array` views; they are not interpreted
as offsets. Consumers that only support the old manifest or timestamp
schema need updating to read version 5. Existing exports are not migrated.

## Files

| File                                               | Contents                                                     |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `manifest.json`                                    | Version, dictionaries, source counts, regions and page index |
| `stops.arrow`                                      | Stop identities, names, coordinates, parent/region indices   |
| `trips.arrow`                                      | GTFS trip identities, route indices and headsigns            |
| `routes.arrow`                                     | Route identities and names                                   |
| `partitions/<region>/<YYYY-MM-DDTHH>/<page>.arrow` | One independent sorted connection page                       |

The page suffix is `.arrow.gz` when `--compressed` is used. Stop, trip and
route tables remain uncompressed. Every connection page includes its own
schema and RecordBatch, so it can be fetched and decoded independently;
there is no dependency on the bytes of an earlier page.

Page names are an implementation detail. Clients must follow manifest
paths, resolved relative to the manifest URL. Source-local integer IDs
remain consistent across all pages of that source. IDs from different
sources are unrelated; a multi-source planner must namespace them.

## Manifest

```json
{
  "format": "gtfs2lc-arrow-connections",
  "version": 5,
  "generatedAt": "2026-09-14T09:00:00.000Z",
  "files": {
    "stops": "stops.arrow",
    "trips": "trips.arrow",
    "routes": "routes.arrow"
  },
  "compressed": false,
  "counts": { "stops": 1000, "trips": 20000, "routes": 300 },
  "partitioning": {
    "method": "hub",
    "regionCount": 2,
    "regions": [
      { "id": 0, "hubStopIdx": 42, "lat": 51.03, "lon": 3.71 },
      { "id": 1, "hubStopIdx": 84, "lat": 50.85, "lon": 4.35 }
    ]
  },
  "connections": {
    "timePartitionSeconds": 21600,
    "periods": ["2026-09-14T06"],
    "pages": {
      "0": {
        "2026-09-14T06": [
          {
            "path": "partitions/0/2026-09-14T06/00000.arrow",
            "epochSeconds": 1789365600,
            "minDepartureTime": 1789365600,
            "maxDepartureTime": 1789369200,
            "rowCount": 50000,
            "arrivalRegions": [0, 1],
            "byteLength": 1102000
          }
        ]
      }
    }
  }
}
```

The example's counts and byte length are illustrative. `baseUris`, also
written by the exporter, retains the URI-template configuration used by
RDF formats. It is not needed for routing, but lets clients reconstruct
identifiers from the corresponding GTFS entities.

| Index field                            | Meaning                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `timePartitionSeconds`                 | Fixed UTC bucket duration, currently 21,600 seconds                          |
| `periods`                              | Sorted keys of buckets with data in any region                               |
| `pages[region][period]`                | Pages for that region and bucket, in ascending departure order               |
| `path`                                 | Relative URL of the independently readable page                              |
| `epochSeconds`                         | UTC Unix epoch seconds used to decode both time-offset columns               |
| `minDepartureTime`, `maxDepartureTime` | Inclusive bounds of actual departures in the page, in absolute epoch seconds |
| `rowCount`                             | Number of connections, between 1 and 50,000                                  |
| `arrivalRegions`                       | Sorted unique source-local regions containing arrival stops                  |
| `byteLength`                           | Published file size, including gzip when applicable                          |

The exporter records the epoch in Arrow schema metadata as the decimal
string `epochSeconds` as well. This makes standalone pages interpretable.
The manifest supplies it to the planner before decoding.

For a query with departures in `[from, to)`, a page is relevant when
`maxDepartureTime >= from && minDepartureTime < to`. Bounds can overlap at
equal departure times across pages. Clients must merge those ties; page
order is not a connection-continuation order. Missing region/bucket entries
mean no data. Sparse buckets do not require empty pages.

## Connection page schema

All connection fields are non-nullable.

| Column                | Arrow type | Meaning                                   |
| --------------------- | ---------- | ----------------------------------------- |
| `departureStopIdx`    | `Int32`    | Row in this source's `stops.arrow`        |
| `arrivalStopIdx`      | `Int32`    | Row in this source's `stops.arrow`        |
| `departureTimeOffset` | `Uint32`   | Departure seconds after the page epoch    |
| `arrivalTimeOffset`   | `Uint32`   | Arrival seconds after the same page epoch |
| `tripIdx`             | `Int32`    | Row in this source's `trips.arrow`        |
| `pickupType`          | `Uint8`    | GTFS `pickup_type`, default 0             |
| `dropOffType`         | `Uint8`    | GTFS `drop_off_type`, default 0           |

Decode either timestamp with:

```js
const departure = epochSeconds + departureTimeOffset[row];
const arrival = epochSeconds + arrivalTimeOffset[row];
```

The epoch is the six-hour bucket's start. Departure offsets are less than
21,600. **Arrival offsets may extend beyond the bucket**, including into
another UTC day. They are not taken modulo six hours. Both offsets must be
integers in `[0, 4294967295]`; the writer rejects negative or overflowing
values rather than silently wrapping them. Adding them to an epoch in
JavaScript uses exact integer arithmetic within the safe-integer range.

The numeric column payload is **22 bytes/connection**, down from 30 in the
absolute-timestamp schema, before IPC framing/alignment and optional gzip.
The page index has its own overhead. `Uint32` offsets also avoid repeated
BigInt-to-Number conversion in the scan. They do not encode local time or
GTFS service-day seconds.

For versions 3 and 4, the two offset columns above are instead named
`departureTime` and `arrivalTime`, both Arrow `TimestampSecond`. Their raw
buffers contain absolute epoch seconds as 64-bit integers. Arrow scalar
getters can expose different units; the planner deliberately uses raw
numeric column views.

Pickup/drop-off codes are preserved for consumers to interpret. The
prototype forbids boarding/alighting for code 1, permits staying aboard,
and currently treats conditional service codes 2/3 as usable.

## Dictionary schemas

The dictionary schemas are unchanged from version 4. Row position is the
source-local numeric identity; string IDs are for display and linking.

| `stops.arrow` column | Type      | Nullable | Meaning                         |
| -------------------- | --------- | -------- | ------------------------------- |
| `stopId`             | `Utf8`    | no       | GTFS stop ID                    |
| `name`               | `Utf8`    | yes      | Stop name                       |
| `lat`, `lon`         | `Float64` | yes      | Coordinates                     |
| `parentIdx`          | `Int32`   | no       | Parent row, or -1               |
| `regionIdx`          | `Int32`   | no       | Departure partition's region ID |

Connections normally use boarding/alighting stops, which can be children of
a station. The prototype normalizes station families for profile lookup,
while preserving actual platform indices on returned ride legs. Missing
legacy parent/region columns default to -1/0 respectively.

| `trips.arrow` column | Type    | Nullable | Meaning       |
| -------------------- | ------- | -------- | ------------- |
| `tripId`             | `Utf8`  | no       | GTFS trip ID  |
| `routeIdx`           | `Int32` | no       | Route row     |
| `headsign`           | `Utf8`  | yes      | Trip headsign |

| `routes.arrow` column   | Type   | Nullable | Meaning       |
| ----------------------- | ------ | -------- | ------------- |
| `routeId`               | `Utf8` | no       | GTFS route ID |
| `shortName`, `longName` | `Utf8` | yes      | Route names   |

A GTFS trip may run on several service dates. `tripIdx` is not a dated run
identifier. Connection identities/IRIs, per-stop headsign overrides,
`stop_sequence`, frequencies, real-time updates and explicit transfer rules
are not added by version 5.

## Geospatial and temporal partitioning

`--regions N` selects hubs from stops covering many trips, then assigns
stops to their nearest hub. Connections belong to the region of their
**departure** stop; they are not duplicated in the arrival region.
With one region, only temporal/page splitting remains.

Buckets start at 00:00, 06:00, 12:00 and 18:00 UTC, include their start and
exclude their end. A 24-hour query touches four buckets when aligned and
five otherwise, covering at most 30 hours before page-level filtering.
The fixed UTC boundaries work across local daylight-saving changes and
GTFS times after midnight.

Conversion still holds raw connection columns and grouping indices in
memory for sorting. Version 5 writes one page at a time and awaits the
complete output pipeline, including gzip and disk writes, before publishing
the index. It does not implement an external-memory conversion sort.

## Profile-based browser consumption

The browser uses one scan worker and up to two independent loader workers.
Loaders decode pages into typed views and transfer the underlying buffers.
The scan worker keeps a 64 MiB LRU connection cache; active query data,
profiles, walking neighbors and dictionaries are additional memory.

Relevant pages from every selected network/region are loaded with bounded
concurrency, prioritizing later departure bounds. A binary search selects
the query window within each batch. A heap then merges mutable batch
cursors in decreasing departure order. No connection objects, combined
row arrays or global connection sort are required. Equal-time zero-duration
chains are relaxed after positive-duration connections at that timestamp.

Profiles group retained labels by ride count, ordered by departure and
arrival. A binary search finds the earliest-arriving catchable continuation
for each count. Labels live in typed-array storage; candidate frontiers
reuse scratch arrays. Walking links are checked during continuation lookup,
so a label is not copied into every neighboring stop's profile. Access from
the origin is resolved once after scanning.

Walking can connect any selected sources and also nearby stops within a
source. It is considered before, between and after rides, so A → B → A and
initial walking to another operator are ordinary cases of the same scan.
There is no closest-20-bridges limit or single-interchange branch.
Arrival-region index summaries are provided for future pruning experiments;
the current implementation uses time bounds and scans all selected regions
to avoid unsafe geographic pruning.

The browser returns up to six alternatives over later departure, earlier
arrival and fewer vehicle changes, within 24 elapsed hours. Walking uses
straight-line distances and a 5 km/h assumption; station-family transfer
time is zero. These assumptions are separate from the Arrow storage schema.
See [`public/README.md`](public/README.md) for controls, modules, tests and
remaining routing limitations.
