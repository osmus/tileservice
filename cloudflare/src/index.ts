import { Hono, Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  Compression,
  EtagMismatch,
  PMTiles,
  RangeResponse,
  ResolvedValueCache,
  Source,
  TileType,
} from "pmtiles";

interface Env {
  ALLOWED_ORIGINS?: string;
  BUCKET: R2Bucket;
  CACHE_CONTROL?: string;
  FAVORED_ORIGINS?: string;
  PMTILES_PATH?: string;
  PUBLIC_HOSTNAME?: string;
  PER_USER_RATE_LIMITER: any;
  PER_ORIGIN_RATE_LIMITER: any;
}

class KeyNotFoundError extends Error {}

const regexEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const globToRegex = (glob: string): RegExp => {
  return new RegExp("^" + glob.split("*").map(regexEscape).join(".*") + "$");
};

const parseOriginListToRegexes = (origins?: string): RegExp[] => {
  return origins?.split("\n").filter((s) => s.length > 0).map(globToRegex) ?? [];
};

const pmtiles_path = (name: string, setting?: string): string => {
  if (setting) {
    return setting.replaceAll("{name}", name);
  }
  return name + ".pmtiles";
};

async function nativeDecompress(buf: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> {
  if (compression === Compression.None || compression === Compression.Unknown) {
    return buf;
  }
  if (compression === Compression.Gzip) {
    const stream = new Response(buf).body;
    const result = stream?.pipeThrough(new DecompressionStream("gzip"));
    return new Response(result).arrayBuffer();
  }
  throw new Error("Compression method not supported");
}

const CACHE = new ResolvedValueCache(25, undefined, nativeDecompress);

class R2Source implements Source {
  env: Env;
  archiveName: string;

  constructor(env: Env, archiveName: string) {
    this.env = env;
    this.archiveName = archiveName;
  }

  getKey() {
    return this.archiveName;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const resp = await this.env.BUCKET.get(pmtiles_path(this.archiveName, this.env.PMTILES_PATH), {
      range: { offset: offset, length: length },
      onlyIf: { etagMatches: etag },
    });
    if (!resp) {
      throw new KeyNotFoundError("Archive not found");
    }

    const o = resp as R2ObjectBody;

    if (!o.body) {
      throw new EtagMismatch();
    }

    const a = await o.arrayBuffer();
    return {
      data: a,
      etag: o.etag,
      cacheControl: o.httpMetadata?.cacheControl,
      expires: o.httpMetadata?.cacheExpiry?.toISOString(),
    };
  }
}

async function handleTileRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const env = c.env;

  const name = c.req.param("name");
  const z = parseInt(c.req.param("z"));
  const x = parseInt(c.req.param("x"));
  const y_ext = c.req.param("y_ext");

  // Parse y coord and file extension from the combined parameter
  const match = y_ext.match(/^(\d+)\.([a-z]+)$/);
  if (!match) {
    throw new HTTPException(400, { message: "Invalid tile format" });
  }
  const y = parseInt(match[1]);
  const ext = match[2];

  if (isNaN(z) || isNaN(x) || isNaN(y)) {
    throw new HTTPException(400, { message: "Invalid tile coordinates" });
  }

  const tile = [z, x, y];
  const source = new R2Source(env, name);
  const pmtiles = new PMTiles(source, CACHE, nativeDecompress);

  try {
    const pHeader = await pmtiles.getHeader();

    if (tile[0] < pHeader.minZoom || tile[0] > pHeader.maxZoom) {
      throw new HTTPException(404, { message: "Tile zoom level outside archive bounds" });
    }

    for (const pair of [
      [TileType.Mvt, "mvt"],
      [TileType.Png, "png"],
      [TileType.Jpeg, "jpg"],
      [TileType.Webp, "webp"],
      [TileType.Avif, "avif"],
    ]) {
      if (pHeader.tileType === pair[0] && ext !== pair[1]) {
        if (pHeader.tileType === TileType.Mvt && ext === "pbf") {
          continue;
        }
        throw new HTTPException(400, {
          message: `Bad request: requested .${ext} but archive has type .${pair[1]}`,
        });
      }
    }

    const tiledata = await pmtiles.getZxy(tile[0], tile[1], tile[2]);

    c.header("Cache-Control", "public, max-age=86400");

    switch (pHeader.tileType) {
      case TileType.Mvt:
        c.header("Content-Type", "application/x-protobuf");
        break;
      case TileType.Png:
        c.header("Content-Type", "image/png");
        break;
      case TileType.Jpeg:
        c.header("Content-Type", "image/jpeg");
        break;
      case TileType.Webp:
        c.header("Content-Type", "image/webp");
        break;
    }

    if (tiledata) {
      return c.body(tiledata.data);
    }
    return c.body(null, 204);
  } catch (e) {
    if (e instanceof KeyNotFoundError) {
      throw new HTTPException(404, { message: "Archive not found" });
    }
    throw e;
  }
}

async function handleTilesetRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const url = new URL(c.req.url);
  const name = c.req.param("name").split(".")[0];
  const source = new R2Source(c.env, name);
  const pmtiles = new PMTiles(source, CACHE, nativeDecompress);

  try {
    const tilejson = await pmtiles.getTileJson(`https://${url.hostname}/${name}`);
    c.header("Cache-Control", "public, max-age=86400");
    return c.json(tilejson as any);
  } catch (e) {
    if (e instanceof KeyNotFoundError) {
      throw new HTTPException(404, { message: "Archive not found" });
    }
    throw e;
  }
}

async function handleFontRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const fontPath = c.req.path.substring(1); // Remove leading slash

  const fontFile = await c.env.BUCKET.get(fontPath);
  if (!fontFile) {
    throw new HTTPException(404, { message: "Font file not found" });
  }

  const arrayBuffer = await fontFile.arrayBuffer();

  c.header("Cache-Control", "public, max-age=604800"); // 7 days (fonts don't change often)
  c.header("Content-Type", "application/octet-stream");

  return c.body(arrayBuffer);
}

// Check if this request's Origin is in the allowed origins list. If no
// Origin header was provided, the request will be allowed only if the
// allowed list contains an entry "*" (which permits any Origin).
async function originMiddleware(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  const origin = c.req.header("Origin");
  const allowedOrigins = parseOriginListToRegexes(c.env.ALLOWED_ORIGINS);
  const isAllowed = allowedOrigins.some((regex) => regex.test(origin ?? ""));

  if (!isAllowed) {
    throw new HTTPException(403, { message: "Origin not allowed" });
  }

  await next();
}

// Enforce per-user and per-origin rate limits
async function rateLimitMiddleware(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  // NOTE: IP address isn't necessarily unique per user (especially on mobile
  // networks) but it's the best we can do. Per-user limits should be set
  // generously to avoid frustrating users who share their IP with lots of
  // other users.
  const ipAddress = c.req.header("CF-Connecting-IP");
  const userLimiterResult = await c.env.PER_USER_RATE_LIMITER.limit({ key: ipAddress ?? "" });
  if (!userLimiterResult.success) {
    throw new HTTPException(429, { message: `Rate limit exceeded for IP ${ipAddress}` });
  }

  // Check if this request's Origin is favored (not subject to per-Origin
  // rate limiting). Only requests that send an Origin header can be favored;
  // requests that omit the Origin header are rate-limited together in one
  // bucket.
  const origin = c.req.header("Origin");
  const favoredOrigins = parseOriginListToRegexes(c.env.FAVORED_ORIGINS);
  const isFavored = origin && favoredOrigins.some((regex) => regex.test(origin));

  // Only enforce per-origin rate limiting if the Origin isn't on the Favored list
  if (!isFavored) {
    const originLimiterResult = await c.env.PER_ORIGIN_RATE_LIMITER.limit({ key: origin ?? "" });
    if (!originLimiterResult.success) {
      throw new HTTPException(429, { message: `Rate limit exceeded for Origin ${origin}` });
    }
  }

  await next();
}

// Cache responses for requests and reuse them on subsequent requests for the
// same resource. This middleware runs before CORS middleware, so the stored
// response does NOT have the Access-Control-Allow-Origin header which varies
// by request Origin.
async function cacheMiddleware(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  const cached = await caches.default.match(c.req.raw);
  if (cached) {
    return cached;
  }

  await next();
  
  const cacheControl = c.res.headers.get("Cache-Control");
  if (!cacheControl || cacheControl.includes("no-cache") || cacheControl.includes("no-store")) {
    return;
  }

  // Store in cache asynchronously
  c.executionCtx.waitUntil(caches.default.put(c.req.raw, c.res.clone()));
}

// Add CORS headers to responses. This runs after the Origin validation
// middleware, so it can safely assume that all requests it sees are from
// allowed origins. All it needs to do is tell the browser that this site
// permits requests from that origin, and tell any HTTP proxies that the
// response contents will vary by origin.
async function corsMiddleware(c: Context<{ Bindings: Env }>, next: () => Promise<void>) {
  await next();

  const origin = c.req.header("Origin");
  if (origin) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
  }
  c.res.headers.set("Vary", "Origin");
}

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    switch (err.status) {
      case 400:
        c.header("Cache-Control", "public, max-age=3600");
        break;
      case 403:
        c.header("Cache-Control", "public, max-age=300");
        break;
      case 404:
        c.header("Cache-Control", "public, max-age=300");
        break;
      case 429:
        c.header("Cache-Control", "no-cache"); // Never cache rate limits
        break;
      default:
        c.header("Cache-Control", "no-cache"); // Never cache other errors
        break;
    }
    return err.getResponse();
  }

  c.header("Cache-Control", "no-cache"); // Never cache server errors
  return c.text("Internal Server Error", 500);
});

app.use("*", originMiddleware);
app.use("*", rateLimitMiddleware);
app.get("*", cacheMiddleware); // NOTE: only cache GET requests
app.use("*", corsMiddleware);

app.get("/:name/:z/:x/:y_ext", handleTileRequest);
app.get("/:name{(.*)\\.json}", handleTilesetRequest);
app.get("/fonts/:fontName/:range_pbf", handleFontRequest);

export default app;
