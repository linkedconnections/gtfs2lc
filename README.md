# gtfs to linked connections

Transforms a GTFS file in memory towards a directed acyclic graph of "connections".

Outputs connections as objects

## Use

Requirements:
 * node js

Install using `npm install`

### Command Line

```bash
# First argument: path or url to gtfs
./gtfs-csv2connections path-to-gtfs.zip  > connections.ttl
```

