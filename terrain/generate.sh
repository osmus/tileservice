#!/bin/bash

# This script generates hillshade and contour line tiles from Mapzen's DEM dataset

### Configuration parameters

SOURCE_DATASET=mapzen-dem.wms.xml
MINZOOM=10
MAXZOOM=12
# BOUNDS="[-124.73460, 45.56631, -116.87882, 48.99251]" # US-WA
# BOUNDS="[-180, -85.05, 180, 85.05]" # let's GOOOO!
BOUNDS="[-180, -60, 180, 85.05]" # exclude antarctica

# Z7 + Z8 took about 9h on my laptop. But osmx extract for a planet file was running at the same time


### GDAL settings (these make fetching and reprojecting data faster)

export GDAL_CACHEMAX=4096 # in MB
export GDAL_MAX_CONNECTIONS=8 # make GDAL use more parallelism when fetching (default is 2)

for zoom in $(seq $MINZOOM $MAXZOOM); do
  echo $BOUNDS \
  | mercantile tiles $zoom \
  | python filter_tiles.py land.geojson \
  | jq -r '[.[2], .[0], .[1]] | join(" ")' \
  | xargs --verbose -d '\n' -n 1 -P 16 sh -c "python make_tile.py $SOURCE_DATASET \$0 >/dev/null 2>&1"
done

