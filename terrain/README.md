The scripts in this directory can be used to generate the hillshade and contour line tilesets used by OpenTrailMap.

The main entrypoint is `generate.sh` which builds all tiles in both tilesets. Edit the variables at the top of this script to change the min and max zoom and the bounding box for which tiles are built.

Internally, `generate.sh` calls `make_tile.py` repeatedly. `make_tile.py` takes a tile ID, fetches the required DEM data for that region, and builds a hillshade tile and contour tile. There are variables at the top of this file that can be changed to configure how tiles are built (e.g. contour intervals and simplification threshold).

DEM data is fetched from Mapzen's global DEM dataset, hosted on AWS. The file `mapzen-dem.wms.xml` describes how to read this dataset in a format that GDAL tools such as `gdalwarp` understand. `make_tile.py` uses this to fetch the DEM data for a single-tile region (plus required buffer) on the fly, and discards the data once it builds the output tiles. This reduces the disk space required to build tiles.

The scripts have the following dependencies:
- gdal
- tippecanoe
- mercantile
- jq
- python

You can install these dependencies yourself, or use the provided Dockerfile to build a container that has them all. When building in Docker, be sure to mount a directory from the host system to `/root/src/build` in the container, as this is where the output tiles will be written.

Running `generate.sh` will produce two tilesets in the working directory called `contours` and `hillshade`, which are directory trees. If desired, these directory trees can be converted to MBTiles or PMTiles archives using a variety of tools, but this is not handled automatically by the scripts in this repository.

Tip: building the tiles creates a lot of intermediate artifacts on disk. These are created in temporary directories and automatically cleaned up afterwards. But you can speed up the process significantly by ensuring that they are written to an in-memory 'ramfs' rather than disk. By default tempdirs are created in `/tmp`, but if that directory isn't a ramfs on your machine (e.g. macOS), you can set the `TMPDIR` environment variable to somewhere else before running `generate.sh`, and tempdirs will be created there instead.

The current tilesets (s3://osmus-tile/hillshade.pmtiles and s3://osmus-tile/contours-feet.pmtiles) were built on 2024-09-07, on a c7g.8xlarge EC2 instance in AWS. The tiled area covers the bbox `[-180, -60, 180, 85]`, which includes all land except Antarctica. The `filter_tiles.py` script was used to additionally exclude tiles in the oceans (i.e. not intersecting `land.geojson`). Hillshade tiles were built for zooms 1-12 and contour lines were built for zooms 8-12.

The build took around 36 hours and cost about $50. It required about 128GB of disk space, though I recommend allocating 256GB or even 512GB since at then end you need to package the tiles into PMTiles, and I found the easiest way to do that was to create MBTiles first, so there were large intermediate artifacts to deal with. Converting the tiles from a directory tree to a PMTiles archive is I/O bound and does not require multiple cores, so you can downsize the EC2 instance to something like a c7g.medium to save some money during this phase.

