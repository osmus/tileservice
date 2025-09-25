import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { accepts } from "hono/accepts";
import {
  Compression,
  EtagMismatch,
  PMTiles,
  type RangeResponse,
  ResolvedValueCache,
  type Source,
  TileType,
} from "pmtiles";

interface Env {
  ALLOWED_ORIGINS?: string;
  BUCKET: R2Bucket;
  CACHE_CONTROL?: string;
  FAVORED_ORIGINS?: string;
  PMTILES_PATH?: string;
  PUBLIC_HOSTNAME?: string;
  PER_USER_RATE_LIMITER: RateLimit;
  PER_ORIGIN_RATE_LIMITER: RateLimit;
}

class KeyNotFoundError extends Error {}

const regexEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const globToRegex = (glob: string): RegExp => {
  return new RegExp(`^${glob.split("*").map(regexEscape).join(".*")}$`);
};

const parseOriginListToRegexes = (origins?: string): RegExp[] => {
  return (
    origins
      ?.split("\n")
      .filter((s) => s.length > 0)
      .map(globToRegex) ?? []
  );
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
  archivePath: string;

  constructor(env: Env, archivePath: string) {
    this.env = env;
    this.archivePath = archivePath;
  }

  getKey() {
    return this.archivePath;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const resp = await this.env.BUCKET.get(this.archivePath, {
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
  const subdirectory = c.req.param("subdirectory"); // "vector" or "raster" or undefined
  const name = c.req.param("name");
  const z = Number.parseInt(c.req.param("z"), 10);
  const x = Number.parseInt(c.req.param("x"), 10);
  const y_ext = c.req.param("y_ext");

  // Parse y coord and file extension from the combined parameter
  const match = y_ext.match(/^(\d+)\.([a-z]+)$/);
  if (!match) {
    throw new HTTPException(400, { message: "Invalid tile format" });
  }
  const y = Number.parseInt(match[1], 10);
  const ext = match[2];

  if (Number.isNaN(z) || Number.isNaN(x) || Number.isNaN(y)) {
    throw new HTTPException(400, { message: "Invalid tile coordinates" });
  }

  const tile = [z, x, y];

  // Construct the archive path based on URL structure
  const filename = `${name}.pmtiles`;
  const archivePath = subdirectory ? `${subdirectory}/${filename}` : filename;

  const source = new R2Source(c.env, archivePath);
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
  const subdirectory = c.req.param("subdirectory"); // "vector" or "raster" or undefined
  const name = c.req.param("name").split(".")[0];

  // Construct the archive path based on URL structure
  const filename = `${name}.pmtiles`;
  const archivePath = subdirectory ? `${subdirectory}/${filename}` : filename;

  const source = new R2Source(c.env, archivePath);
  const pmtiles = new PMTiles(source, CACHE, nativeDecompress);

  try {
    const baseUrl = subdirectory
      ? `https://${url.hostname}/${subdirectory}/${name}`
      : `https://${url.hostname}/${name}`;
    const tilejson = await pmtiles.getTileJson(baseUrl);
    c.header("Cache-Control", "public, max-age=86400");
    // biome-ignore lint/suspicious/noExplicitAny: tilejson is a JSONValue, but that type is recursive and tsc can't deal with it in this context
    return c.json(tilejson as any);
  } catch (e) {
    if (e instanceof KeyNotFoundError) {
      throw new HTTPException(404, { message: "Archive not found" });
    }
    throw e;
  }
}

async function handleFontRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Clients can request a comma-separated list of fonts, which we should
  // try to retrieve in order.
  const fontNames = c.req.param("fontName").split(",").filter(Boolean);
  const range = c.req.param("range_pbf");

  // Sanity check (mostly to avoid a DOS vector where a client could request hundreds
  // of nonexistent fonts, each one triggering an R2 read operation)
  if (fontNames.length > 10) {
    throw new HTTPException(400, { message: "Too many fonts requested (max 10)" });
  }

  for (let fontName of fontNames) {
    const fontPath = `fonts/${fontName}/${range}`;
    const fontFile = await c.env.BUCKET.get(fontPath);
    if (!fontFile) {
      continue;
    }
    const arrayBuffer = await fontFile.arrayBuffer();

    c.header("Cache-Control", "public, max-age=604800"); // 7 days (fonts don't change often)
    c.header("Content-Type", "application/octet-stream");

    return c.body(arrayBuffer);
  }

  // If we get here, then none of the specified font files were found
  throw new HTTPException(404, { message: "Font file(s) not found" });
}

async function handleStaticFileRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  let path = c.req.path;
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.endsWith("/")) path += "index.html";

  const objectKey = new URL(`.${path}`, "file:///www/").pathname.slice(1); // Remove leading slash
  const staticFile = await c.env.BUCKET.get(objectKey);
  if (!staticFile) {
    throw new HTTPException(404, { message: "File not found" });
  }

  c.header("Cache-Control", "public, max-age=3600"); // 1 hour for static files
  c.header("Content-Type", staticFile.httpMetadata?.contentType);

  return c.body(await staticFile.arrayBuffer());
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

app.onError(async (err, c) => {
  if (err instanceof HTTPException) {
    // For 404 errors, serve the 404.html error page if the Accept: header
    // states that the client will accept HTML; otherwise serve plaintext
    if (err.status === 404) {
      const accept = accepts(c, {
        header: "Accept",
        supports: ["text/html", "text/plain"],
        default: "text/plain",
      });
      if (accept === "text/html") {
        const notFoundFile = await c.env.BUCKET.get("www/404.html");
        if (notFoundFile) {
          return new Response(await notFoundFile.arrayBuffer(), {
            status: 404,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "public, max-age=300",
            },
          });
        }
      }
    }
    // if we didn't reach the return above due to one of the conditionals
    // being false, we'll fall through to the normal error handling (which
    // returns plaintext)

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

// New routes with subdirectory support
app.get("/:subdirectory{(vector|raster)}/:name/:z/:x/:y_ext", handleTileRequest);
app.get("/:subdirectory{(vector|raster)}/:name{(.*)\\.json}", handleTilesetRequest);

// Backward compatibility routes (existing structure)
app.get("/:name/:z/:x/:y_ext", handleTileRequest);
app.get("/:name{(.*)\\.json}", handleTilesetRequest);

app.get("/fonts/:fontName/:range_pbf", handleFontRequest);

// Catch-all route for static file serving - must come last
app.get("*", handleStaticFileRequest);

export default app;
