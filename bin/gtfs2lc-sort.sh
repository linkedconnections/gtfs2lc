#!/bin/bash

##Retrieve directory of this bash script
CURDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"

##Go to the dir of the GTFS
[[ $# == 1 ]] && {
  cd $1 && {
    echo Converting newlines dos2unix;
    {
      sed 's/\r//' stop_times.txt > stop_times_unix.txt; mv stop_times_unix.txt stop_times.txt &
      sed 's/\r//' trips.txt > trips_unix.txt; mv trips_unix.txt trips.txt &
      sed 's/\r//' calendar.txt > calendar_unix.txt; mv calendar_unix.txt calendar.txt &
      sed 's/\r//' calendar_dates.txt > calendar_dates_unix.txt; mv calendar_dates_unix.txt calendar_dates.txt ;
    } ;
    echo Removing UTF-8 artifacts in directory $1;
    {
      sed '1s/^\xEF\xBB\xBF//' stop_times.txt > stop_times_unix.txt; mv stop_times_unix.txt stop_times.txt &
      sed '1s/^\xEF\xBB\xBF//' trips.txt > trips_unix.txt; mv trips_unix.txt trips.txt &
      sed '1s/^\xEF\xBB\xBF//' calendar.txt > calendar_unix.txt; mv calendar_unix.txt calendar.txt &
      sed '1s/^\xEF\xBB\xBF//' calendar_dates.txt > calendar_dates_unix.txt; mv calendar_dates_unix.txt calendar_dates.txt ;
    } ;
    ## Find the right numbers of the column keys needed
    TRIPID_TRIPS=`head -n1 trips.txt | tr "," "\n" | grep -n "trip_id"| cut -d: -f1`
    TRIPID_STOPTIMES=`head -n1 stop_times.txt | tr "," "\n" | grep -n "trip_id"| cut -d: -f1`
    STOPSEQUENCE_STOPTIMES=`head -n1 stop_times.txt | tr "," "\n" | grep -n "stop_sequence"| cut -d: -f1`

    ## sort stop_times.txt by trip id and stop sequence
    { head -n 1 stop_times.txt ; tail -n +2 stop_times.txt | sort -t , -k ${STOPSEQUENCE_STOPTIMES}d,${TRIPID_STOPTIMES}d; } > stop_times2.txt ; mv stop_times2.txt stop_times.txt ;
    ## use stoptimes2connections to create a connections CSV file instead
    echo Creating connections.txt file
    $CURDIR/stoptimes2connections.js > connections.txt;
    echo Combining splitting trains into 1 connection
    ## order the connections.txt according to deptime, artime and stops
    TRIPID_CONNECTIONS=`head -n1 connections.txt | tr "," "\n" | grep -n "trip_id"| cut -d: -f1`
    DEPTIME=`head -n1 connections.txt | tr "," "\n" | grep -n "departure_dfm"| cut -d: -f1`
    ARTIME=`head -n1 connections.txt | tr "," "\n" | grep -n "arrival_dfm"| cut -d: -f1`
    DEPARTURESTOPID=`head -n1 connections.txt | tr "," "\n" | grep -ne "departure_stop$"| cut -d: -f1`
    ARRIVALSTOPID=`head -n1 connections.txt | tr "," "\n" | grep -ne "arrival_stop$"| cut -d: -f1`
    { head -n 1 connections.txt ; tail -n +2 connections.txt | sort -t , -k $DEPTIME -k $ARTIME -k $DEPARTURESTOPID -k $ARRIVALSTOPID ; } > connections2.txt ; mv connections2.txt connections.txt
    
    ## Now launch the nodejs script that can join connections that are the same but which should have multiple trips
    $CURDIR/joinconnections.js > connections2.txt && mv connections2.txt connections.txt;

    ## Finally sort all files in  order to be processed for gtfs2lc
    echo Sorting files in directory $1;
    { head -n 1 connections.txt ; tail -n +2 connections.txt | sort -t , -k ${TRIPID_CONNECTIONS}d ; } > connections2.txt ; mv connections2.txt connections.txt &
    { head -n 1 trips.txt ; tail -n +2 trips.txt | sort -t , -k ${TRIPID_TRIPS}d ; } > trips2.txt ; mv trips2.txt trips.txt &
    { head -n 1 calendar.txt ; tail -n +2 calendar.txt | sort -t , -k 1d; } > calendar2.txt ; mv calendar2.txt calendar.txt &
    { head -n 1 calendar_dates.txt ; tail -n +2 calendar_dates.txt | sort -t , -k 1d; } > calendar_dates2.txt ; mv calendar_dates2.txt calendar_dates.txt &
  } ;
} || {
  echo Give a path to the gtfs dir as the only argument;
}
