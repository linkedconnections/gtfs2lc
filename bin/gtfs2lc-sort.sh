#!/bin/bash
[[ $# == 1 ]] && {
  cd $1 && {
    echo Converting newlines dos2unix;
    {
      sed 's/\r//' stop_times.txt > stop_times_unix.txt; mv stop_times_unix.txt stop_times.txt &
      sed 's/\r//' trips.txt > trips_unix.txt; mv trips_unix.txt trips.txt &
      sed 's/\r//' calendar.txt > calendar_unix.txt; mv calendar_unix.txt calendar.txt &
      sed 's/\r//' calendar_dates.txt > calendar_dates_unix.txt; mv calendar_dates_unix.txt calendar_dates.txt ;
      sed 's/\r//' routes.txt > routes_unix.txt; mv routes_unix.txt routes.txt ;
            
    } ;
    echo Removing UTF-8 artifacts in directory $1;
    {
      sed '1s/^\xEF\xBB\xBF//' stop_times.txt > stop_times_unix.txt; mv stop_times_unix.txt stop_times.txt &
      sed '1s/^\xEF\xBB\xBF//' trips.txt > trips_unix.txt; mv trips_unix.txt trips.txt &
      sed '1s/^\xEF\xBB\xBF//' calendar.txt > calendar_unix.txt; mv calendar_unix.txt calendar.txt &
      sed '1s/^\xEF\xBB\xBF//' calendar_dates.txt > calendar_dates_unix.txt; mv calendar_dates_unix.txt calendar_dates.txt ;
      sed '1s/^\xEF\xBB\xBF//' routes.txt > routes_unix.txt; mv routes_unix.txt routes.txt ;
    } ;
    echo Sorting files in directory $1;
    { head -n 1 stop_times.txt ; tail -n +2 stop_times.txt | sort -t , -k1,1 -k5,5n ; } > stop_times2.txt ; mv stop_times2.txt stop_times.txt &
    { head -n 1 trips.txt ; tail -n +2 trips.txt | sort -t , -k 3 ; } > trips2.txt ; mv trips2.txt trips.txt &
    { head -n 1 calendar.txt ; tail -n +2 calendar.txt | sort -t , -k 1; } > calendar2.txt ; mv calendar2.txt calendar.txt &
    { head -n 1 calendar_dates.txt ; tail -n +2 calendar_dates.txt | sort -t , -k 1n; } > calendar_dates2.txt ; mv calendar_dates2.txt calendar_dates.txt &
  } ;
} || {
  echo Give a path to the gtfs dir as the only argument;
}
