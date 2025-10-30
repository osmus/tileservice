This is a [Cloudflare Tail Worker](https://developers.cloudflare.com/workers/observability/logs/tail-workers/) that collects logs from the main tile service worker and sends them to a Loki instance for centralized logging. It captures request logs, console output, and exceptions, formatting them as JSON and forwarding them to the Loki API.

Useful commands:
- `npm run start` - start a local development server. note: you'll need to set the `LOKI_API_URL` and `LOKI_CREDENTIALS` env vars
- `npm run typecheck` and `npm run check` - run tsc and biome (respectively) for typechecking and lint/format checking
- `npm run types` - update the generated worker-configuration.d.ts file (typescript types for Cloudflare API)
- `npm run deploy` - deploy to Cloudflare (you shouldn't need this as the worker auto-redeploys when changes are made to the main branch on Github)
