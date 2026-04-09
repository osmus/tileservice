#!/usr/bin/env bash
set -euo pipefail

TILESET="$1"
DIR="$(dirname "$0")"

exec &> >(tee -a "/var/log/render/${TILESET}_$(date +%Y-%m-%dT%H:%M:%S).log")

echo "=== Build started: $TILESET at $(date -u '+%Y-%m-%d %H:%M:%S') ==="

PLANET=/home/tiler/data/sources/planet.osm.pbf
OUTPUT=/home/tiler/data/${TILESET}.pmtiles

echo "Updating planet file"
pyosmium-up-to-date -vvvv --size 10000 "$PLANET"

docker system prune --force

"$DIR/render_${TILESET}.sh" "$PLANET" "$OUTPUT"

MIN_SIZE=$(( 1 * 1024 * 1024 * 1024 ))
ACTUAL_SIZE=$(stat -c%s "$OUTPUT")
if (( ACTUAL_SIZE < MIN_SIZE )); then
  echo "Error: $OUTPUT is ${ACTUAL_SIZE} bytes, expected at least ${MIN_SIZE}"
  exit 1
fi
pmtiles verify "$OUTPUT"

echo "Uploading $TILESET"
rclone copyto "$OUTPUT" "osmus-r2://osmus-tile/vector/${TILESET}.pmtiles" --no-check-dest --s3-no-check-bucket

# openmaptiles is also mirrored to S3 under the legacy path for backwards compatibility
if [[ "$TILESET" == "openmaptiles" ]]; then
  aws s3 cp "$OUTPUT" "s3://osmus-tile/planet.pmtiles" --only-show-errors
fi

rm "$OUTPUT"

echo "=== Build complete: $TILESET at $(date -u '+%Y-%m-%d %H:%M:%S') ==="
