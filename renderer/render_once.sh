#!/usr/bin/env bash

# Assumption: planet.osm.pbf is pre-positioned in data/sources

set -x

# Get the directory of the current script
DIR="$(dirname "$0")"

WORKING_DIR="${1:-$DIR}"

DATE="$(date -u '+%Y-%m-%d %H:%M:%S')"
echo "Start Render: $DATE"

mkdir -p "$WORKING_DIR/data/sources"
mkdir -p "$WORKING_DIR/data/tmp"

rm -rf "$WORKING_DIR/data/sources/tmp*.osm.pbf"

pyosmium-up-to-date -vvvv --size 10000 "$WORKING_DIR/data/sources/planet.osm.pbf"

# Remove excess docker files from past runs
docker system prune --force

# Make sure we have the latest planetiler
docker pull ghcr.io/onthegomap/planetiler:latest

docker run -e JAVA_TOOL_OPTIONS='-Xmx2g' \
	-v "$WORKING_DIR/data":/data \
	-v "$DIR/layers":/layers \
	ghcr.io/onthegomap/planetiler:latest --area=planet \
	--download --download-only --only-fetch-wikidata --wikidata-max-age=P30D --wikidata-update-limit=100000

# Remove default downloaded OSM file
rm -rf "$WORKING_DIR/data/sources/monaco.osm.pbf"

PLANET="$WORKING_DIR/data/planet.pmtiles"

# Read in a line-delimited list of BCP 47 codes corresponding to name:* subkeys
languages=$(cat languages.txt | tr $'\n' ',')

docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
	-v "$WORKING_DIR/data":/data \
	-v "$DIR/layers":/layers \
	ghcr.io/onthegomap/planetiler:latest --area=planet --bounds=world \
	--output="/data/planet.pmtiles" \
	--force \
	--transportation_name_size_for_shield \
	--transportation_name_limit_merge \
	--boundary-osm-only \
	--storage=ram --nodemap-type=array \
	--max-point-buffer=4 \
	--building_merge_z13=false \
	--languages="${languages%%,}"

# Check if the file exists and is at least 50GB
if [[ ! -f "$PLANET" ]]; then
	echo "Error: File $PLANET does not exist."
	exit 1
elif [[ $(stat -c %s "$PLANET") -lt $((50 * 1024 * 1024 * 1024)) ]]; then
	echo "Error: File $PLANET is smaller than 50GB."
	exit 1
fi

echo 'Uploading planet to s3 bucket in background'
aws s3 cp "$PLANET" s3://osmus-tile/ --only-show-errors &

# Render optional layers
for file in "$DIR/layers/"*.yml; do
	# Get the base name of the file without the .yml extension
	layer_name=$(basename "$file" .yml)

	echo "Processing layer: $layer_name"

	docker run -e JAVA_TOOL_OPTIONS='-Xmx150g' \
		-v "$WORKING_DIR/data":/data \
		-v "$DIR/layers":/layers \
		ghcr.io/onthegomap/planetiler:latest generate-custom \
		--area=planet --bounds=world \
		--output="/data/$layer_name.pmtiles" \
		--force \
		--schema="/layers/$layer_name.yml" \
		--storage=ram --nodemap-type=array \
		--max-point-buffer=4

	echo "Uploading $layer_name to s3 bucket in background"
	{
		aws s3 cp "$WORKING_DIR/data/$layer_name.pmtiles" s3://osmus-tile/ --only-show-errors
		rm -rf "$WORKING_DIR/data/$layer_name.pmtiles"
	} &
done

echo 'Waiting for all background jobs to finish'
wait

echo 'Invalidating the CDN cache'
aws cloudfront create-invalidation --distribution-id E1SJ64GZNQSV8M --invalidation-batch "{\"Paths\": {\"Quantity\": 1, \"Items\": [\"/*\"]}, \"CallerReference\": \"invalidation-$DATE\"}"

echo 'Render Complete'
date -u '+%Y-%m-%d %H:%M:%S'
