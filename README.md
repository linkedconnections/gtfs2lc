# GTFS to Linked Connections

[![Node.js CI](https://github.com/linkedconnections/gtfs2lc/actions/workflows/build-test.yml/badge.svg)](https://github.com/linkedconnections/gtfs2lc/actions/workflows/build-test.yml) [![npm](https://img.shields.io/npm/v/gtfs2lc.svg?style=popout)](https://npmjs.com/package/gtfs2lc) [![Coverage Status](https://coveralls.io/repos/github/linkedconnections/gtfs2lc/badge.svg?branch=master)](https://coveralls.io/github/linkedconnections/gtfs2lc?branch=master)

Transforms a GTFS file into a directed acyclic graph of actual _connections_.

A _connection_ is the combination of a departure and its successive arrival of the same trip.
Our goal is to retrieve a list of connections that is sorted by departure time, better known as a Directed Acyclic Graph. This way, route planning algorithms can be performed.

More information and live demo at https://linkedconnections.org

## Converting your GTFS to (linked) connections

### Step 0: Installation

Install it using the [Node Package Manager (npm)](https://www.npmjs.com/get-npm).
Node.js 24 or 26 is required.

```bash
npm install -g gtfs2lc
```

### Step 1: discover a GTFS file

If you haven’t yet picked a GTFS file you want to work with, different repositories exist. Our favorite ones:

- [Transit.land’s feed registry](http://transit.land/feed-registry/)
- [Mobility Database](https://mobilitydatabase.org)

Yet, you may also directly ask your local public transport authority for a copy.

Mind that we have not tested our code with all GTFS files yet, and there are [known limitations](#not-yet-implemented).

### Step 2: unzip your GTFS

You can use your favorite unzipper. E.g., `unzip gtfs.zip` should work fine.

### Step 3: Order and clean your CSV files

This process runs automatically, so you can skip to Step 4. You can also run it independently with `gtfs2lc-clean <path>`. The cross-platform cleaner normalizes the CSV files and uses a disk-backed external sort for `stop_times.txt`.

`stop_times.txt` is ordered by `trip_id` and `stop_sequence`; source files are only replaced after their normalized versions have been written successfully.

### Step 4: Generate connections!

Successfully finished the previous steps? Then you can now generate actual departure and arrival pairs (connections) as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f json
```

The default output is a binary Jelly-RDF stream (`linkedConnections.jelly`). We support other formats such as `jsonld`, `turtle`, `ntriples`, `csv`, and `arrow` through the `--format` option.

The `turtle` and `ntriples` formats are RDF 1.2 Message Logs. Every Connection is serialized as one RDF Message, with its quads kept together behind `@message .` or `MESSAGE` delimiters. The output uses RDF/JS terms and [`rdf-parser-ts`](https://github.com/pietercolpaert/rdf-parser.ts) for serialization and parsing.

`arrow` is a different kind of format: instead of an RDF graph, it writes a columnar, typed-array [Apache Arrow](https://arrow.apache.org/) dataset with the minimal fields a [Connection Scan Algorithm](https://arxiv.org/abs/1703.05997) route planner needs, sorted by departure time and paged into Arrow RecordBatches a browser can stream and scan directly. See [`arrowconnections.md`](arrowconnections.md) for the full schema, and [`public/index.html`](public/index.html) for a working in-browser route planner built on top of it.

For _big_ GTFS files, your memory may not be sufficient. Luckily, we’ve implemented a way to use your hard disk instead of your RAM. You can enable this with an option: `gtfs2lc /path/to/extracted/gtfs -f json --store LevelStore`.

Conversion uses up to eight workers by default. Use `--workers <count>` to set an explicit limit.

It may also be the case that your disk has limited storage space. In that case you may want to use the `--compressed` option. **For the RDF formats especially, this matters far more than it sounds:** Jelly-RDF, Turtle, and N-Triples are all just as gzip-compressible as any other text-adjacent format, but `gtfs2lc` does not gzip the final merged file unless you ask it to. Skipping `--compressed` on a large feed can mean shipping a file 10-15x larger than it needs to be, for free, with no other change. See [Choosing a format](#choosing-a-format) below for measurements.

### Choosing a format

There is no single "best" format — it depends on what you're going to do with the output. These numbers come from converting a real, ~150-day national railway GTFS feed (SNCB/NMBS) and measuring a 200,000-connection (2,000,000-quad) sample; exact ratios will vary with your feed's identifier lengths and stop/trip/route cardinality, but the relative ordering is representative.

| Format                | Use it when…                                                                                                  | Raw size                                                   | Gzipped size                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `jelly` (default)     | You want RDF and can compress the file yourself (`--compressed`, or gzip downstream)                          | 27.5 bytes/quad                                            | **1.95 bytes/quad**                                                                   |
| `turtle` / `ntriples` | You want a human-readable or maximally interoperable RDF serialization, and don't mind a larger file          | 250.8 bytes/quad                                           | 4.65 bytes/quad                                                                       |
| `jsonld` / `csv`      | You're feeding a JSON- or spreadsheet-oriented tool downstream                                                | similar order of magnitude to `ntriples`, format-dependent | —                                                                                     |
| `arrow`               | You're building a route planner (browser or otherwise) that needs to scan connections directly, not parse RDF | ~25-27 bytes/connection (7 columns, not per-quad)          | typically smaller still, and rarely worth compressing further given how it's consumed |

The practical takeaways from the investigation that produced the `arrow` format (see `arrowconnections.md` for the full story):

1. **Always pass `--compressed` for the RDF formats**, unless something downstream already compresses the file for you. It is the single biggest size lever available — bigger than any format choice below it.
2. Jelly-RDF, once compressed, is already ~2.4-2.7x more compact than compressed Turtle/N-Triples — the binary RDF format is doing its job. If you need RDF, prefer `jelly` and compress it.
3. `arrow` isn't "RDF but smaller" — it's a different shape entirely, storing GTFS-native integer indices rather than IRIs and RDF terms, with no per-connection object allocation in the browser scan. Reach for it specifically when the consumer is a route-planning algorithm, not a Linked Data client.

### Step 5: Generate _Linked_ Connections!

When you download a new GTFS file, all identifiers in there might change and conflict with your previous export. Therefore, we need to think about a way to create global identifiers for the connections, trips, routes and stops in our system. As we are publishing our data on the Web, we will also use Web addresses for these global identifiers.

See `baseUris-example.json` for an example on URI templates of what a stable identifier strategy could look like. Copy it and edit it to your likings. For a more detailed explanation of how to use the URI templates see the description at our [`GTFS-RT2LC`](https://github.com/linkedconnections/gtfsrt2lc#uri-templates) tool, which uses the same strategy.

Resolver expressions support property access from `connection`, `trips`, `routes`, and `stops`, plus `format(...)` and `substring(...)`. Arbitrary JavaScript is intentionally rejected.

Now you can generate Linked Data in JSON-LD as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f jsonld -b baseUris.json
```

That’s it! Want to serve your Linked Connections over HTTP? Take a look at our work over here: [The Linked Connection’s server](https://github.com/julianrojas87/linked-connections-server) (WIP)

### Step 6: Plan a route in the browser (Arrow format only)

If you generated `arrow` output, `public/index.html` and its adjacent `planner-*.mjs` modules form a route planner (with an `apache-arrow` CDN import): it runs a multi-criteria Profile Connection Scan Algorithm (Pareto-optimal over arrival time and transfers, like [planner.js](https://planner.js.org)) directly against your `arrow` connections, entirely client-side in a Web Worker, returning up to six alternative journeys within a 24-hour window.

```bash
gtfs2lc /path/to/extracted/gtfs -f arrow -o public/my-feed
npx serve public
```

(`fetch()` needs the files served over HTTP, not opened as `file://`.) Open the served page, search for an origin and destination stop, pick a departure time, and it plans the journey in memory, without any backend. See `arrowconnections.md` for what the format looks like and why it's shaped this way — in particular, `arrow` output is no longer one file: connections are partitioned geospatially and into six-hour UTC periods, and the browser fetches pages overlapping the query window across the selected networks (`--regions <count>` controls how many geospatial regions to create; omit it, or use `1`, to disable geospatial partitioning and keep just the six-hour time split).

#### Multiple networks at once

`public/index.html` can search across several independently-generated feeds — one per transit operator, say — each as its own subdirectory:

```bash
gtfs2lc nmbs-gtfs -f arrow --regions 8 -o public/nmbs
gtfs2lc delijn-gtfs -f arrow --regions 8 -o public/delijn
npx gtfs2lc-sources-index public   # (re)writes public/sources.json
npx serve public
```

The page lets people check/uncheck which sources to search (defaulting to all of them), and fetches every region/time file a query needs across the selected sources concurrently. Journeys can use all selected operators, including A → B → A routes, with walking before, between and after rides. See [`public/README.md`](public/README.md) for the routing assumptions and browser architecture.

The planner still reads existing version-3 monthly and version-4 six-hour exports. New conversions produce version-5 indexed pages within six-hour buckets, with compact relative timestamps. Keep the `planner-*.mjs` files next to `index.html` when serving the page.

A 24-hour query touches four or five six-hour buckets per region; page time bounds narrow downloads further. Stops load at startup; trip and route labels load only when a journey needs them. The worker owns connections and cached tables; only stop-search metadata and completed journeys cross to the UI. See `arrowconnections.md` for the format and `public/README.md` for performance details and remaining work.

#### Isochrones

The page also has an **Isochrones** tab: a MapLibre map (loaded from a CDN on first use, so a Route-Planner-only visit never fetches it) where clicking scans every selected source for how much of the network is reachable within a chosen travel time, and plots each reached stop colored by how fast it was reached. See [`public/README.md`](public/README.md#isochrones) for how the scan works.

### More options

#### Post-processing joining connections, and adding nextConnection properties

In GTFS, joining and splitting trains are fixed in a horrible way. See https://support.google.com/transitpartners/answer/7084064?hl=en for more details.

In Linked Connections, we can solve this gracefully by adding a nextConnection array to every connection. A splitting train is then, on the last connection before it is split, indicate 2 nextConnection items.

On your newline delimited jsonld file, you can perform this script in order to make that work: `linkedconnections-joinandsort yourconnectionsfile.nldjsonld`

#### MongoDB

Next to the jsonld format, we’ve also implement the “`mongold`” format. It can be directly used by the command `mongoimport` as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f mongold -b baseUris.json | mongoimport -c myconnections
```

Mind that only MongoDB starting version 2.6 is supported and mind that it doesn’t work at this moment well together with the post-processing step of joining trips.

#### Even more options

For more options, check `gtfs2lc --help`

## Development

Install the pinned dependencies with `npm ci`, then run:

```bash
npm run check
npm test
```

`npm run check` runs ESLint, Prettier verification, and JavaScript type checking. Tests run against an isolated copy of the sample feed.

### SNCB/NMBS weekly build

Run `npm run build:sncb` to download the latest SNCB/NMBS GTFS feed and generate Jelly-RDF connections for seven service days, starting today in the `Europe/Brussels` timezone. Results are written to `build/sncb/output`.

The build can be reproduced or customized with environment variables:

```bash
SNCB_START_DATE=2026-06-28 SNCB_DAYS=7 SNCB_FORMAT=jelly npm run build:sncb
```

`SNCB_BUILD_DIR`, `SNCB_GTFS_URL`, `SNCB_TIMEZONE`, `SNCB_WORKERS`, and `SNCB_COMPRESSED=1` are also supported.

### Discover and build a Mobility Database feed

`gtfs2lc-build` searches the [Mobility Database API](https://mobilitydata.github.io/mobility-feed-api/SwaggerUI/index.html), lets you select a GTFS Schedule feed, discovers its publisher or hosted ZIP URL, and builds the dataset. For example:

```bash
MOBILITYDATABASE_REFRESH_TOKEN=... gtfs2lc-build "De Lijn"
```

The first run interactively configures stable public URI templates. It explains the collision risks, recommends agency-scoped identifiers, includes service dates in trip identifiers, includes `stop_sequence` in Connection identifiers, and previews representative identifiers before saving. The resulting file is named from the agency and Mobility Database key—for example, `de-lijn-mdb-684.json`—and can also be passed directly to `gtfs2lc --base-uris`.

Later runs reuse saved configurations without querying Mobility Database:

```bash
gtfs2lc-build mdb-684
```

The API accepts `MOBILITYDATABASE_ACCESS_TOKEN` directly or exchanges `MOBILITYDATABASE_REFRESH_TOKEN` for a one-hour access token. If neither is set, the command securely prompts for the refresh token and never saves it. Use `--help` for output, format, compression, worker, and configuration-directory options.

## How it works (for contributors)

We first convert `stop_times.txt` to connection rules called `connections.txt`.

Service dates are processed through `calendar_dates.txt` and `calendar.txt`, that was processed at the same time.

In the final step, the connection rules are expanded towards connections by joining the days, service ids and connectionRules.

Post-processing steps work directly on the output stream, and can map the output stream to Linked Data. Connections2JSONLD is the main class to look at.

Another post-processing step is introduced to fix joining and splitting trips.

## Not yet implemented

At this moment we've only implemented a conversion from the Stop Times to connections. However, in future work we will also implement a system for describing trips and routes, a system for transit stops and a system for transfers in Linked Data.

Furthermore, also `frequencies.txt` is not supported at this time. We hope to support this in the future though.

## Authors

- Pieter Colpaert <pieter.colpaert@ugent.be>

- Julián Rojas <julianandres.rojasmelendez@ugent.be>
