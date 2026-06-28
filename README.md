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

We support other formats such as `csv` as well.

The `turtle` and `ntriples` formats are RDF 1.2 Message Logs. Every Connection is serialized as one RDF Message, with its quads kept together behind `@message .` or `MESSAGE` delimiters. The output uses RDF/JS terms and [`rdf-parser-ts`](https://github.com/pietercolpaert/rdf-parser.ts) for serialization and parsing.

For _big_ GTFS files, your memory may not be sufficient. Luckily, we’ve implemented a way to use your hard disk instead of your RAM. You can enable this with an option: `gtfs2lc /path/to/extracted/gtfs -f json --store LevelStore`.

Conversion uses up to eight workers by default. Use `--workers <count>` to set an explicit limit.

It may also be the case that your disk has limited storage space. In that case you may want to use the `--compressed` option.

### Step 5: Generate _Linked_ Connections!

When you download a new GTFS file, all identifiers in there might change and conflict with your previous export. Therefore, we need to think about a way to create global identifiers for the connections, trips, routes and stops in our system. As we are publishing our data on the Web, we will also use Web addresses for these global identifiers.

See `baseUris-example.json` for an example on URI templates of what a stable identifier strategy could look like. Copy it and edit it to your likings. For a more detailed explanation of how to use the URI templates see the description at our [`GTFS-RT2LC`](https://github.com/linkedconnections/gtfsrt2lc#uri-templates) tool, which uses the same strategy.

Resolver expressions support property access from `connection`, `trips`, `routes`, and `stops`, plus `format(...)` and `substring(...)`. Arbitrary JavaScript is intentionally rejected.

Now you can generate Linked Data in JSON-LD as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f jsonld -b baseUris.json
```

That’s it! Want to serve your Linked Connections over HTTP? Take a look at our work over here: [The Linked Connection’s server](https://github.com/julianrojas87/linked-connections-server) (WIP)

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

Run `npm run build:sncb` to download the latest SNCB/NMBS GTFS feed and generate JSON-LD connections for seven service days, starting today in the `Europe/Brussels` timezone. Results are written to `build/sncb/output`.

The build can be reproduced or customized with environment variables:

```bash
SNCB_START_DATE=2026-06-28 SNCB_DAYS=7 SNCB_FORMAT=jsonld npm run build:sncb
```

`SNCB_BUILD_DIR`, `SNCB_GTFS_URL`, `SNCB_TIMEZONE`, `SNCB_WORKERS`, and `SNCB_COMPRESSED=1` are also supported.

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
