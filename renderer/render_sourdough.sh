#!/usr/bin/env bash
set -euxo pipefail

PLANET_PBF="$1"
OUTPUT_PMTILES="$2"

DATA_DIR="$(realpath "$(dirname "$PLANET_PBF")/..")"
OSM_FILENAME="$(basename "$PLANET_PBF")"
OUTPUT_BASENAME="$(basename "$OUTPUT_PMTILES")"

SOURDOUGH_IMAGE=ghcr.io/jake-low/sourdough-builder:main

docker pull "$SOURDOUGH_IMAGE"

docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
  -v "$DATA_DIR:/tiles/data" \
  "$SOURDOUGH_IMAGE" \
  --osm-path="/tiles/data/sources/$OSM_FILENAME" \
  --output="/tiles/data/$OUTPUT_BASENAME" \
  --download \
  --force \
  --storage=ram --nodemap-type=array
