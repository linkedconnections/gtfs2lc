# GTFS to Linked Connections

[![Build Status](https://travis-ci.org/linkedconnections/gtfs2lc.svg?branch=master)](https://travis-ci.org/linkedconnections/gtfs2lc) [![npm](https://img.shields.io/npm/v/gtfs2lc.svg?style=popout)](https://npmjs.com/package/gtfs2lc) [![Greenkeeper badge](https://badges.greenkeeper.io/linkedconnections/gtfs2lc.svg)](https://greenkeeper.io/) [![Coverage Status](https://coveralls.io/repos/github/linkedconnections/gtfs2lc/badge.svg?branch=master)](https://coveralls.io/github/linkedconnections/gtfs2lc?branch=master)

Transforms a GTFS file into a directed acyclic graph of actual _connections_.

A _connection_ is the combination of a departure and its successive arrival of the same trip.
Our goal is to retrieve a list of connections that is sorted by departure time, better known as a Directed Acyclic Graph. This way, route planning algorithms can be performed.

More information and live demo at https://linkedconnections.org

## Converting your GTFS to (linked) connections

### Step 0: Installation

Install it using the [Node Package Manager (npm)](https://www.npmjs.com/get-npm).

```bash
npm install -g gtfs2lc
```

### Step 1: discover a GTFS file

If you haven’t yet picked a GTFS file you want to work with, different repositories exist. Our favorite ones:

* [Transit.land’s feed registry](http://transit.land/feed-registry/)
* [Transit Feeds](https://transitfeeds.com/)

Yet, you may also directly ask your local public transport authority for a copy.

Mind that we have not tested our code with all GTFS files yet, and there are [known limitations](#not-yet-implemented).

### Step 2: unzip your GTFS

You can use your favorite unzipper. E.g., `unzip gtfs.zip` should work fine.

### Step 3: Order and clean your CSV files

We’ve enclosed a bash script which ensures this for you. You can run this bash script using `gtfs2lc-sort <path>`. Next to sorting, it also unifies newlines and removes UTF-8 artifacts.

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

For _big_ GTFS files, your memory may not be sufficient. Luckily, we’ve implemented a way to use your hard disk instead of your RAM. You can enable this with an option: `gtfs2lc /path/to/extracted/gtfs -f json --store LevelStore`.

### Step 5: Generate *Linked* Connections!

When you download a new GTFS file, all identifiers in there might change and conflict with your previous export. Therefore, we need to think about a way to create global identifiers for the connections, trips, routes and stops in our system. As we are publishing our data on the Web, we will also use Web addresses for these global identifiers.

See `baseUris-example.json` for an example on URI templates of what a stable identifier strategy could look like. Copy it and edit it to your likings. For a more detailed explanation of how to use the URI templates see the description at our [`GTFS-RT2LC`](https://github.com/linkedconnections/gtfsrt2lc#uri-templates) tool, which uses the same strategy.

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

 * Pieter Colpaert <pieter.colpaert@ugent.be>

 * Julián Rojas <julianandres.rojasmelendez@ugent.be>
