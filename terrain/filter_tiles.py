"""
Read tile IDs from STDIN, filter them to just those that intersect a GeoJSON geometry,
and write just the intersecting ones to STDOUT.

Useful in conjunction with `mercantile tiles` command, to filter tiles to an area of
interest and avoid needlessly tiling unwanted areas e.g. oceans.

Usage: python filter_tiles.py GEOJSON_FILE 
"""

import json
import sys

import mercantile
import shapely

geojson_file = sys.argv[1]
with open(geojson_file) as f:
    geojson = shapely.from_geojson(f.read())
    shapely.prepare(geojson)

for line in sys.stdin:
    x, y, z = json.loads(line)
    bounds = mercantile.bounds((x, y, z))
    if shapely.intersects(geojson, shapely.box(*bounds)):
        print(json.dumps([x, y, z]), file=sys.stdout)
    
    
    
