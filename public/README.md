# Browser route planner

This prototype plans journeys entirely in the browser over GTFS-to-Arrow
exports. Serve this directory over HTTP, open `index.html`, select the
networks to search, choose stops and a departure time, then plan.

```bash
# Run from the repository root:
node bin/gtfs2lc.js /path/to/gtfs --format arrow --regions 8 --output public/my-feed
node bin/gtfs2lc-sources-index.js public
npx serve public
```

Keep the `planner-*.mjs` modules next to `index.html`. Apache Arrow is loaded
from the pinned CDN import in the workers, so the initial visit needs CDN
access. This is a static site; no routing server or cross-origin isolation
headers are required.

## What a journey can include

All checked sources participate, even when the two selected stops belong
to the same operator. A journey can change operators multiple times,
including A → B → A, or use a third selected operator. The planner considers:

- Walking from the origin to a nearby stop, including another operator's stop.
- Rides on any selected network, with walking between rides when needed.
- Walking from the final ride to the destination.
- A walking-only journey when the destination is close enough.

The window is **24 elapsed hours** from the requested departure time.
Departures must be before its end; arriving exactly at the deadline is
allowed. UTC timestamps make this independent of daylight-saving changes.

The walking setting bounds **each continuous walking leg**, not the sum of
all walks. Walking uses straight-line distance at 5 km/h and can connect
stops within the same network as well as across networks. Walks are not
chained to bypass the distance limit. Station children are grouped under
their parent station, with zero internal transfer time. These are prototype
assumptions: barriers, pedestrian paths, accessibility and GTFS minimum
transfer times are not modeled.

Alternatives are nondominated over later departure, earlier arrival and
fewer vehicle changes. The first six by departure time are displayed.
Walking access/egress adds no vehicle change; changing vehicles adds one,
including after a walk. Pickup/drop-off value `1` forbids boarding/alighting;
it does not prevent remaining aboard. Conditional pickup/drop-off values
`2` and `3` are currently treated as usable, without reservation checks.

## Loading and workers

```mermaid
flowchart LR
    UI[Main thread: stop search and rendering] -->|query + selected source IDs| Scan[Scan worker]
    Scan -->|page requests| Loaders[Up to two loader workers]
    Loaders -->|transferred Arrow buffers| Scan
    Scan -->|progress + labeled journey legs| UI
```

Startup fetches source manifests and stop tables. Trip and route tables
load lazily when a returned ride needs labels. They remain Arrow tables in
the scan worker, and only the displayed strings are decoded.

The scan worker owns the network, profiles and a **64 MiB LRU connection
cache**. A query may temporarily hold more than the cache budget; that
budget does not cap active query data, walking neighbors or profile memory.
Only the most recently used network/walking configuration is cached.

Up to two loader workers fetch and decode independently. The scan schedules
at most four pending page loads and prioritizes later pages. Loader workers
transfer their backing `ArrayBuffer`s to the scan worker; they do not retain
copies. If nested workers are unavailable, the scan worker can read pages
itself. There is one dependent backward scan, not one full-network copy per
CPU. Progress reports distinguish page loading, scanning and label loading.

All selected regions contribute their relevant time pages. This removes
the old endpoint-region and closest-20-bridges heuristics, which could miss
valid multimodal journeys. Version-5 indexes avoid fetching pages whose
departure bounds cannot overlap the query.

HTTP data requests use `no-store` so locally regenerated exports are visible
after reload. The in-memory cache still serves repeated queries. Reload
after regenerating a feed; an open page keeps its original manifest.

## How the scan avoids copies

Connections stay in Arrow column views. Binary searches locate the window
within each batch, then a heap merges batch cursors backward. The planner
does not create one object per connection, concatenate row arrays, or sort
a combined connection pool. Equal-departure zero-duration connections are
relaxed to a fixed point so page order does not hide a valid continuation.

Profiles are grouped by vehicle count and ordered by departure. Within a
group, arrival also increases with departure, allowing one binary search
to find the best catchable continuation instead of traversing every label.
Retained labels use growing typed arrays; small reusable arrays hold
candidate alternatives. Continuation lookups cache their valid time intervals and
invalidate them when a frontier changes. Walking is resolved during continuation lookup,
with origin access evaluated once afterward. Only completed journey legs
become objects sent to the main thread.

Copies still occur where necessary: Arrow assembles IPC buffers, typed
profile storage occasionally grows, legacy timestamps are converted to
numbers as read, and stop-search metadata crosses the worker boundary.
The design specifically removes the large connection-object and pool copies.

## Data format and compatibility

See [the Arrow format specification](../arrowconnections.md).

New exports use **version 5**: six-hour UTC buckets containing independent
pages of at most 50,000 rows, indexed by departure bounds. Each page has an
epoch and two `Uint32` second-offset columns, reducing connection column
payload from 30 to 22 bytes per row before IPC framing/compression.

Existing version-3 monthly and version-4 six-hour exports still work. Their
readers discard batches before the window and stop after it, keeping only
batch views that overlap. They still need to stream past earlier bytes;
version 5 can skip unrelated pages entirely. No migration is required, and
existing data in this directory is not rewritten by these code changes.

## Modules and verification

| Module                                                 | Responsibility                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `planner-client.mjs`                                   | Main-thread requests, progress and worker errors                   |
| `planner-worker.mjs`                                   | Scan-worker setup and serialized requests                          |
| `planner-service.mjs`                                  | Selected sources and lazy result labels                            |
| `planner-core.mjs`                                     | Source discovery, page scheduling and query cache                  |
| `planner-loader-pool.mjs`, `planner-loader-worker.mjs` | Parallel decoding and buffer transfers                             |
| `planner-data.mjs`                                     | Arrow views, LRU cache and backward heap merge                     |
| `planner-network.mjs`                                  | Source-local ID mapping, station families and spatial neighbors    |
| `planner-profile.mjs`                                  | Ordered profiles, walking continuations and journey reconstruction |

From the repository root, run `npm run check` and `npm test`. The planner
cases also run directly with `node test/planner-cases.mjs`. They exercise
real worker threads (with Node adapters for browser APIs), legacy and new
formats, compression, page boundaries, cross-network walking, A → B → A
journeys, source selection, zero-duration ties, cache ownership, and
comparison with exhaustive small-network routing.

## Remaining limitations and useful next work

The full selected network is now searched, so selecting a large bus feed
can still cost appreciable CPU time even for a railway-to-railway journey.
Worker isolation keeps this off the UI thread; it does not eliminate CPU
work. Measure load time, scan time, profile labels and walking-neighbor
lookups separately before tuning further.

Useful next steps are a real pedestrian/transfer graph, query cancellation,
profile reuse for repeated origins at the same destination/window, and a
proven reachability filter that can prune pages without missing multimodal
routes. The index already includes arrival-region summaries for further
experiments; the current planner uses time bounds, not geographic pruning.

Trip IDs identify GTFS trips, not dated vehicle runs. Staying aboard requires
matching the next stop and a catchable departure; explicit dated run IDs
would make continuity safer for looping trips across service dates. There
is no real-time support, transfer-rule enforcement, or guarantee that a
straight-line walking link is physically traversable.
