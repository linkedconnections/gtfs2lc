#!/bin/bash
[[ $# == 1 ]] && {
  cd $1 && {
    echo Sorting files in directory $1;
    { head -n 1 stop_times.txt ; tail -n +2 stop_times.txt | sort -t , -k 1,5n ; } > stop_times2.txt ; mv stop_times2.txt stop_times.txt &
    { head -n 1 trips.txt ; tail -n +2 trips.txt | sort -t , -k 3 ; } > trips2.txt ; mv trips2.txt trips.txt &
    { head -n 1 calendar.txt ; tail -n +2 calendar.txt | sort -t , -k 1; } > calendar2.txt ; mv calendar2.txt calendar.txt &
    { head -n 1 calendar_dates.txt ; tail -n +2 calendar_dates.txt | sort -t , -k 1n; } > calendar_dates2.txt ; mv calendar_dates2.txt calendar_dates.txt &
  } ;
} || {
  echo Give a path to the gtfs dir as the only argument;
}
