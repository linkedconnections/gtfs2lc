# GTFS to Linked Connections

[![Build Status](https://travis-ci.org/linkedconnections/gtfs2lc.svg?branch=master)](https://travis-ci.org/linkedconnections/gtfs2lc)

[![NPM](https://nodei.co/npm/gtfs2lc.png)](https://npmjs.org/package/gtfs2lc)

Transforms a GTFS file into a directed acyclic graph of actual _connections_.

A _connection_ is the combination of a departure and its successive arrival of the same trip. 
Our goal is to retrieve a list of connections that is sorted by departure time, better known as a Directed Acyclic Graph. This way, routeplanning algorithms can be performed.

More information and live demo at https://linkedconnections.org

## Converting your GTFS to (linked) connections

### Step 0: Installation

Install it using the [Node Package Manager (npm)](https://www.npmjs.com/get-npm).

```bash
npm install -g gtfs2lc
```

### Step 1: discover a GTFS file

If you haven’t yet picked a GTFS file you want to work with, different repositories exist. Our favourite ones:
 * [Transit.land’s feed registry](http://transit.land/feed-registry/)
 * [Transit Feeds](https://transitfeeds.com/)

Yet, you may also directly ask your local public transport authority for a copy.

Mind that we have not tested our code with all GTFS files yet, and there are [known limitations](#not-yet-implemented).

### Step 2: unzip your GTFS

You can use your favorite unzipper. E.g., `unzip gtfs.zip` should work fine.

### Step 3: Order and clean your CSV files

We’ve enclosed a bash script which ensures this for you. You can run this bash script using `gtfs2lc-sort <path>`. Next to sorting, it also unifies newlines and removed UTF-8 artefacts.

If _step 4_ would not give the desired result, you might want to tweak the script manually. In order for our script to work:
 * __stop_times.txt__ must be ordered by `trip_id` and `stop_sequence`.
 * __calendar.txt__ must be ordered by `service_id`.
 * __calendar_dates.txt__ must be ordered by `service_id`.

### Step 4: Generate connections!

Successfully finished the previous steps? Then you can now generate actual departure and arrival pairs (connections) as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f json
```

We support other formats such as `csv` as well.

For _big_ GTFS files, your memory may not be sufficient. Luckily, we’ve implemented a way to use your harddisk instead of your RAM. You can enable this with an option: `gtfs2lc /path/to/extracted/gtfs -f json --store LevelStore`.

### Step 5: Generate *Linked* Connections!

When you download a new GTFS file, all identifiers in there will might change and conflict with your previous export. Therefore, we need to think about a way to create global identifiers for the connections, trips, routes and stops in our system. As we are publishing our data on the Web, we will also use Web addresses for these global identifiers.

See `baseUris-example.json` for an example or URI templates of what a stable identifier strategy could look like. Copy it and edit it to your likings.

Now you can generate Linked Data in JSON-LD as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f jsonld -b baseUris.json
```

That’s it! Want to serve your Linked Connections over HTTP? Take a look at our work over here: [The Linked Connection’s server](https://github.com/julianrojas87/linked-connections-server) (WIP)

### More options

Next to the jsonld format, we’ve also implement the “`mongold`” format. It can be directly used by the command `mongoimport` as follows:

```bash
gtfs2lc /path/to/extracted/gtfs -f mongold -b baseUris.json | mongoimport -c myconnections
```

Mind that only MongoDB starting version 2.6 is supported.

For more options, check `gtfs2lc --help`

## How it works (for contributors)

We convert `stop_times.txt` to a stream of connection rules. These rules need a certain explanation about on which days they are running, which can be retrieved using the `trip_id` in the connection rules stream.

At the same time, we process `calendar_dates.txt` and `calendar.txt` towards a binary format. It will contain a 1 for the number of days from a start date for which the service id is true.

In the final step, the connection rules are expanded towards connections by joining the days, service ids and rules.

## Not yet implemented:

At this moment we've only implemented a conversion from the Stop Times to connections. However, in future work we will also implement a system for describing trips and routes, a system for transit stops and a system for transfers.

Furthermore, also `frequencies.txt` is not supported at this time. We hope to support this in the future though.

## Authors

Pieter Colpaert <pieter.colpaert@ugent.be>
