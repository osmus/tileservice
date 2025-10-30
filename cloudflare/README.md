This is the code for the [Cloudflare Worker](https://developers.cloudflare.com/workers/) that serves tile requests at tiles.openstreetmap.us. The tile data is uploaded as a PMTiles file to a [Cloudflare R2](https://developers.cloudflare.com/r2/) bucket. The worker's job is to handle HTTP requests for tiles by Z/X/Y ID, retrieve the data for that tile from the PMTiles archive, and return it to the client. It also serves TileJSON to describe each tileset, and enforces per-IP and per-Origin rate limits.

The worker code is adapted from [example code in from the PMTiles project](https://github.com/protomaps/PMTiles/tree/main/serverless/cloudflare). See the LICENSE file for details.

Useful commands:
- `npm run start` - start a local development server
- `npm run typecheck` and `npm run check` - run tsc and biome (respectively) for typechecking and lint/format checking
- `npm run deploy` - deploy to Cloudflare (you shouldn't need this as the worker auto-redeploys when changes are made to the main branch on Github)
