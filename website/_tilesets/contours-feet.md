---
layout: tileset
title: "Contours (Feet)"
type: vector
permalink: /vector/contours-feet/
tilejson_url: "https://tiles.openstreetmap.us/vector/contours-feet.json"
center: [-121.7, 46.8]
zoom: 8.5
---

Topographic contour lines with elevation values in feet. Derived from [Mapzen's global DEM dataset](https://registry.opendata.aws/terrain-tiles/), which combines data from [various open DEM datasets](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md). Created using [GDAL](https://gdal.org/).

Contour interval varies with zoom level. Contour elevations are given by the `ele` attribute. Index contours (every fifth contour line, which are typically labeled on maps) are indicated by the `idx = true` attribute.
