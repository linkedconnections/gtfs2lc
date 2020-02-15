#!/bin/bash

##
## This file sorts and joins trips that should be one correctly from a newline delimited jsonld file of connections (the output of `gtfs2lc -f jsonld`)
##

CURDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

## should be 1 argument: the connections.nldjsonld file, and this file should exist
[[ $# == 1 ]] && [[ -f $1 ]] && {
    ## Skip first line that corresponds to JSON-LD @context
    ## Order it by departureTime, as well as 
    DEPARTURETIME=$(( `sed 1,1d $1 | head -n1 | tr "," "\n" | grep -n "departureTime"| cut -d: -f1` ));
    DEPARTURESTOP=$(( `sed 1,1d $1 | head -n1 | tr "," "\n" | grep -n "departureStop"| cut -d: -f1` ));
    ARRIVALTIME=$(( `sed 1,1d $1 | head -n1 | tr "," "\n" | grep -n "arrivalTime"| cut -d: -f1` ));
    ARRIVALSTOP=$(( `sed 1,1d $1 | head -n1 | tr "," "\n" | grep -n "arrivalStop"| cut -d: -f1` ));
    ROUTE=$(( `sed 1,1d $1 | head -n1 | tr "," "\n" | grep -n "gtfs:route"| cut -d: -f1` ));

    ## And after the sorting, we need to pipe it to a process that is able to join trains. Ordered in descending order, but afterwards again sorted in ascending order
    sort $1 -t , -k ${DEPARTURETIME}dr,${DEPARTURETIME} -k ${ARRIVALTIME}dr,${ARRIVALTIME} -k ${ROUTE}dr,${ROUTE} -k ${DEPARTURESTOP}dr,${DEPARTURESTOP} -k ${ARRIVALSTOP}dr,${ARRIVALSTOP} | $CURDIR/linkedconnections-sortandjoin.js | sort -t , -k ${DEPARTURETIME}d,${DEPARTURETIME};
} || {
    echo "Please provide the location of your output of 'gtfs2lc -f jsonld'"
}

