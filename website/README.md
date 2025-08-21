# OpenStreetMap US Tileservice Website

This is the website for the OpenStreetMap US Tileservice. It provides documentation on how to use the Tileservice, and also an interactive preview of each of the tilesets we offer.

The website is built using Jekyll. The tileset viewer is built using ESBuild (it depends on MapLibre and a few other npm packages).

To build the site, run `make`, which will compile both the Jekyll site and the JS viewer.

The website is served from [https://tiles.openstreetmap.us/](https://tiles.openstreetmap.us/). To deploy the site, upload the `_site/` directory (Jekyll's output) to the `www/` directory in the Cloudflare R2 bucket. The Cloudflare worker that serves tile and asset data will also serve the website.

