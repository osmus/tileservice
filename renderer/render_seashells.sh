#!/usr/bin/env bash

# This script does not check to see if a render is already running.
# See _example.sh for usage advice.

# Get the directory of the current script
DIR="$(dirname "$0")"

DEFAULT_WORKING_DIR="/var/lib/render"

WORKING_DIR="${1:-$DEFAULT_WORKING_DIR}"

mkdir -p "$WORKING_DIR"

mkdir -p /var/log/render
LOG_TIMESTAMP=$(date +%Y%m%d%H%M%S)
LOG_FILE="/var/log/render/logs_$LOG_TIMESTAMP.txt"

touch "$LOG_FILE"
tail -f "$LOG_FILE" | nc seashells.io 1337 > /tmp/seashells_render & sleep 10

# Get the size of the file in bytes
OSM_PLANET_SIZE=$(stat -c%s "$WORKING_DIR/data/sources/planet.osm.pbf")

# Print the size with comma separators
OSM_PLANET_SIZE=$(printf "%'d" "$OSM_PLANET_SIZE")

RSS_FILE="$WORKING_DIR/rss.xml"
PLANET="$WORKING_DIR/data/planet.pmtiles"

"$DIR/rss_update.sh" "$RSS_FILE" "Build Started." "The OSM planet file is ${OSM_PLANET_SIZE} bytes."

run() {
  TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
  START_TIME=$(date +%s)
  "$DIR/render_once.sh" "$WORKING_DIR"

  # Check the exit status of render_once.sh
  if [ $? -eq 0 ]; then
    # Record the end time
    END_TIME=$(date +%s)

    # Calculate the time difference
    TIME_DIFF=$((END_TIME - START_TIME))

    # Convert the time difference to hours and minutes
    HOURS=$((TIME_DIFF / 3600))
    MINUTES=$(((TIME_DIFF / 60) % 60))

    # Format hours and minutes with singular or plural as appropriate
    HOUR_TEXT="hours"
    MINUTE_TEXT="minutes"
    if [ "$HOURS" -eq 1 ]; then
      HOUR_TEXT="hour"
    fi
    if [ "$MINUTES" -eq 1 ]; then
       MINUTE_TEXT="minute"
    fi

    # Get the size of the file in bytes
    PMTILES_PLANET_SIZE=$(stat -c%s "$PLANET")

    # Print the size with comma separators
    PMTILES_PLANET_SIZE=$(printf "%'d" "$PMTILES_PLANET_SIZE")

    "$DIR/rss_update.sh" "$RSS_FILE" "Build Complete" "Tiles are up to date as of ${TIMESTAMP}Z. Render took ${HOURS} ${HOUR_TEXT} and ${MINUTES} ${MINUTE_TEXT}. The planet PMTiles file is ${PMTILES_PLANET_SIZE} bytes."
  else
    "$DIR/rss_update.sh" "$RSS_FILE" "Build Failed" "Review the build log to find out why."
  fi

  echo 'Removing local planet file'
  rm -rf "$PLANET"
}

run 2>&1 | tee -a "$LOG_FILE"