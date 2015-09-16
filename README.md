# Guide: GTFS -> Linked Connections

This document explains how you can transform your own GTFS feed into "[connections](https://github.com/linkedconnections/arrdep2connections#2-a-connection-object)".

Note that the code in this repository is depreciated.

## Introduction

A connection is the combination of a departure and its successive arrival of the same trip. 
Our goal is to retrieve a list of connections that is sorted by departure time, better known as a Directed Acyclic Graph. This way, routeplanning algorithms can be performed.

First, we calculate two sorted lists: one for arrivals and one for departures.
After that we can easily calculate connections out of these lists.

### Step 1: Calculate arrivals/departures
The code and instructions are available at:
https://github.com/brechtvdv/gtfs2arrdep

This process can take up a lot of memory when there are thousands arrivals/departures in a day.
It is recommended to test your dataset by setting a startDate and endDate in step 3.

This generates JSON-LD streams of arrivals and departures that you use in step 2.

### Step 2: Calculate connections
The code and instructions are available at:
https://github.com/linkedconnections/arrdep2connections

### Done
With the retrieved JSON-LD stream of connections you can now setup your own [server](https://github.com/linkedconnections/server.js) and start experimenting with the [client](https://github.com/linkedconnections/client.js) and [Connection Scanning Algorithm](https://github.com/linkedconnections/csa.js).
