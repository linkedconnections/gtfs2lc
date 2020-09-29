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
      sed 's/\r//' routes.txt > routes_unix.txt; mv routes_unix.txt routes.txt ;
      sed 's/\r//' stops.txt > stops_unix.txt; mv stops_unix.txt stops.txt ;
    } ;
    echo Removing UTF-8 artifacts in directory $1;
    {
      sed '1s/^\xEF\xBB\xBF//' stop_times.txt > stop_times_unix.txt; mv stop_times_unix.txt stop_times.txt &
      sed '1s/^\xEF\xBB\xBF//' trips.txt > trips_unix.txt; mv trips_unix.txt trips.txt &
      sed '1s/^\xEF\xBB\xBF//' calendar.txt > calendar_unix.txt; mv calendar_unix.txt calendar.txt &
      sed '1s/^\xEF\xBB\xBF//' calendar_dates.txt > calendar_dates_unix.txt; mv calendar_dates_unix.txt calendar_dates.txt ;
      sed '1s/^\xEF\xBB\xBF//' routes.txt > routes_unix.txt; mv routes_unix.txt routes.txt ;
      sed '1s/^\xEF\xBB\xBF//' stops.txt > stops_unix.txt; mv stops_unix.txt stops.txt ;
    } ;

    echo Trimming EOLs and removing continuous double quotes
    {
      sed 's/[[:blank:]]*$//' stop_times.txt | sed 's/""//g' > stop_times_unix.txt; mv stop_times_unix.txt stop_times.txt &
      sed 's/[[:blank:]]*$//' trips.txt | sed 's/""//g' > trips_unix.txt; mv trips_unix.txt trips.txt &
      sed 's/[[:blank:]]*$//' calendar.txt | sed 's/""//g' > calendar_unix.txt; mv calendar_unix.txt calendar.txt &
      sed 's/[[:blank:]]*$//' calendar_dates.txt | sed 's/""//g' > calendar_dates_unix.txt; mv calendar_dates_unix.txt calendar_dates.txt ;
      sed 's/[[:blank:]]*$//' routes.txt | sed 's/""//g' > routes_unix.txt; mv routes_unix.txt routes.txt ;
      sed 's/[[:blank:]]*$//' stops.txt | sed 's/""//g' > stops_unix.txt; mv stops_unix.txt stops.txt ;
    }
    ## Find the right numbers of the column keys needed
    TRIPID_TRIPS=`head -n1 trips.txt | tr "," "\n" | grep -wn "trip_id"| cut -d: -f1`
    TRIPID_STOPTIMES=`head -n1 stop_times.txt | tr "," "\n" | grep -wn "trip_id"| cut -d: -f1`
    STOPSEQUENCE_STOPTIMES=`head -n1 stop_times.txt | tr "," "\n" | grep -wn "stop_sequence"| cut -d: -f1`
    ## Sort stop_times.txt by trip id and stop sequence
    { head -n 1 stop_times.txt ; tail -n +2 stop_times.txt | sort -t , -k ${TRIPID_STOPTIMES}d,${TRIPID_STOPTIMES} -k${STOPSEQUENCE_STOPTIMES}n,${STOPSEQUENCE_STOPTIMES}; } > stop_times2.txt ; mv stop_times2.txt stop_times.txt ;
    ## Sort trips.txt by trip_id and have the same ordering as stop_times.txt
    { head -n 1 trips.txt ; tail -n +2 trips.txt | sort -t , -k ${TRIPID_TRIPS}d,${TRIPID_TRIPS} ; } > trips2.txt ; mv trips2.txt trips.txt &
    ## Use stoptimes2connections to create a set of connections files
    echo Creating connection files according to the number of CPU processors available
    $CURDIR/stoptimes2connections.js;

    ## Finally sort calendar.txt and calendar_dates.txt files in order to be processed for gtfs2lc
    echo Sorting files in directory $1;
    { head -n 1 calendar.txt ; tail -n +2 calendar.txt | sort -t , -k 1d,1; } > calendar2.txt ; mv calendar2.txt calendar.txt &
    { head -n 1 calendar_dates.txt ; tail -n +2 calendar_dates.txt | sort -t , -k 1d,1; } > calendar_dates2.txt ; mv calendar_dates2.txt calendar_dates.txt &
  } ;
} || {
  echo Give a path to the gtfs dir as the only argument;
}
