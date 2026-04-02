#!/usr/bin/env bash
set -euo pipefail

PLANET_PBF="$1"
OUTPUT_PMTILES="$2"

DIR="$(dirname "$0")"
DATA_DIR="$(realpath "$(dirname "$PLANET_PBF")/..")"
OSM_FILENAME="$(basename "$PLANET_PBF")"
OUTPUT_BASENAME="$(basename "$OUTPUT_PMTILES")"

PLANETILER_IMAGE=ghcr.io/onthegomap/planetiler:0.10.0

docker pull "$PLANETILER_IMAGE"

docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
  -v "$DATA_DIR:/data" \
  -v "$DIR/layers:/layers" \
  "$PLANETILER_IMAGE" \
  generate-custom \
  --osm-path="/data/sources/$OSM_FILENAME" \
  --bounds=world \
  --output="/data/$OUTPUT_BASENAME" \
  --force \
  --schema=/layers/pedestrian.yml \
  --storage=ram --nodemap-type=array \
  --max-point-buffer=4
