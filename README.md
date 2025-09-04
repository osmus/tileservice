# OpenStreetMap US Tileservice

This repository contains the source code for the [OpenStreetMap US Tileservice](https://tiles.openstreetmap.us/).

## Overview

This repo contains several loosely related components:

- **`cloudflare/`** - Cloudflare Worker code that serves tile requests at tiles.openstreetmap.us
- **`renderer/`** - Planetiler configs and other scripts for creating vector tiles from OSM data
- **`terrain/`** - Scripts for generating hillshade raster tiles and contour vector tiles from DEM data
- **`website/`** - [tiles.openstreetmap.us](https://tiles.openstreetmap.us/) static website
- **`static/`** - [tile.ourmap.us](https://tile.ourmap.us/) static website

## Quick Start

For most users, the easiest way to use OpenStreetMap US tiles is through our hosted service at `https://tiles.openstreetmap.us/`. See the [website documentation](https://tiles.openstreetmap.us/) for usage examples and API documentation. All usage must comply with our [usage policy](https://tiles.openstreetmap.us/usage-policy/).

## Self-Hosting Options

### Custom Server (AWS)

Anyone can access the OSM US-generated tilesets without restrictions by setting up their own [custom server](./CUSTOM_SERVER.md) using our requester-pays S3 bucket.

### Running Your Own Stack

Alternately, you can use the components in this repository to generate and serve your own tiles.

1. Use the renderer scripts to generate PMTiles from OSM data
2. Deploy your own copy of the Cloudflare Worker code, or adapt it for another edge computing platform like AWS Lambda.

See individual directory READMEs for detailed setup instructions.

## License

The code in this repository is dedicated to the public domain via the CC0 license. You may use it for any purpose, without restriction. See [LICENSE](./LICENSE) for details.
