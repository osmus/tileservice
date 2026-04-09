#!/usr/bin/env bash
set -euo pipefail

PLANET_PBF="$1"
OUTPUT_PMTILES="$2"

DATA_DIR="$(realpath "$(dirname "$PLANET_PBF")/..")"
OSM_FILENAME="$(basename "$PLANET_PBF")"
OUTPUT_BASENAME="$(basename "$OUTPUT_PMTILES")"

PLANETILER_IMAGE=ghcr.io/onthegomap/planetiler:0.10.0

docker pull "$PLANETILER_IMAGE"

# Fetch wikidata translations
docker run -e JAVA_TOOL_OPTIONS='-Xmx16g' \
  -v "$DATA_DIR:/data" \
  "$PLANETILER_IMAGE" \
  --area=planet --download --download-only --only-fetch-wikidata \
  --wikidata-max-age=P30D --wikidata-update-limit=100000

# Render planet
docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
  -v "$DATA_DIR:/data" \
  "$PLANETILER_IMAGE" \
  --osm-path="/data/sources/$OSM_FILENAME" \
  --bounds=world \
  --output="/data/$OUTPUT_BASENAME" \
  --force \
  --transportation_name_size_for_shield \
  --transportation_name_limit_merge \
  --boundary-osm-only \
  --storage=ram --nodemap-type=array \
  --max-point-buffer=4 \
  --building_merge_z13=false \
  --languages='*'
