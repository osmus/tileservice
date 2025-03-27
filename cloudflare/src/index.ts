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

const regexEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const globToRegex = (glob: string): RegExp => {
  return new RegExp("^" + glob.split("*").map(regexEscape).join(".*") + "$");
}

const pmtiles_path = (name: string, setting?: string): string => {
  if (setting) {
    return setting.replaceAll("{name}", name);
  }
  return name + ".pmtiles";
};

const TILE_PATTERN = /^\/(?<NAME>[0-9a-zA-Z\/!\-_\.\*\'\(\)]+)\/(?<Z>\d+)\/(?<X>\d+)\/(?<Y>\d+).(?<EXT>[a-z]+)$/;
const TILESET_PATTERN = /^\/(?<NAME>[0-9a-zA-Z\/!\-_\.\*\'\(\)]+).json$/;
const FONT_PATTERN = /^\/fonts\/(?<FONT_NAME>[^\/]+)\/(?<RANGE>\d+-\d+).pbf$/;

const tile_path = (
  path: string,
): {
  ok: boolean;
  name: string;
  tile?: [number, number, number];
  ext: string;
} => {
  const tile_match = path.match(TILE_PATTERN);

  if (tile_match) {
    const g = tile_match.groups!;
    return { ok: true, name: g.NAME, tile: [+g.Z, +g.X, +g.Y], ext: g.EXT };
  }

  const tileset_match = path.match(TILESET_PATTERN);

  if (tileset_match) {
    const g = tileset_match.groups!;
    return { ok: true, name: g.NAME, ext: "json" };
  }

  return { ok: false, name: "", tile: [0, 0, 0], ext: "" };
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

interface RouteHandler {
  pattern: RegExp;
  handler: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
}

async function handleTileRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(TILE_PATTERN);
  if (!match) {
    return new Response("Invalid tile URL", { status: 404 });
  }

  const { NAME, Z, X, Y, EXT } = match.groups!;
  const tile = [+Z, +X, +Y];

  const cache = caches.default;
  const cached = await cache.match(request.url);
  if (cached) {
    return handleCachedResponse(cached, request.headers.get("Origin"));
  }

  const cacheableHeaders = new Headers();
  const source = new R2Source(env, NAME);
  const p = new PMTiles(source, CACHE, nativeDecompress);
  
  try {
    const pHeader = await p.getHeader();
    
    if (tile[0] < pHeader.minZoom || tile[0] > pHeader.maxZoom) {
      return cacheableResponse(undefined, cacheableHeaders, 404, request, ctx, env);
    }

    for (const pair of [
      [TileType.Mvt, "mvt"],
      [TileType.Png, "png"],
      [TileType.Jpeg, "jpg"],
      [TileType.Webp, "webp"],
      [TileType.Avif, "avif"],
    ]) {
      if (pHeader.tileType === pair[0] && EXT !== pair[1]) {
        if (pHeader.tileType === TileType.Mvt && EXT === "pbf") {
          continue;
        }
        return cacheableResponse(
          `Bad request: requested .${EXT} but archive has type .${pair[1]}`,
          cacheableHeaders,
          400,
          request,
          ctx,
          env
        );
      }
    }

    const tiledata = await p.getZxy(tile[0], tile[1], tile[2]);

    switch (pHeader.tileType) {
      case TileType.Mvt:
        cacheableHeaders.set("Content-Type", "application/x-protobuf");
        break;
      case TileType.Png:
        cacheableHeaders.set("Content-Type", "image/png");
        break;
      case TileType.Jpeg:
        cacheableHeaders.set("Content-Type", "image/jpeg");
        break;
      case TileType.Webp:
        cacheableHeaders.set("Content-Type", "image/webp");
        break;
    }

    if (tiledata) {
      return cacheableResponse(tiledata.data, cacheableHeaders, 200, request, ctx, env);
    }
    return cacheableResponse(undefined, cacheableHeaders, 204, request, ctx, env);
  } catch (e) {
    if (e instanceof KeyNotFoundError) {
      return cacheableResponse("Archive not found", cacheableHeaders, 404, request, ctx, env);
    }
    throw e;
  }
}

async function handleTilesetRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = url.pathname.match(TILESET_PATTERN);
  if (!match) {
    return new Response("Invalid tileset URL", { status: 404 });
  }

  const { NAME } = match.groups!;
  const cache = caches.default;
  const cached = await cache.match(request.url);
  if (cached) {
    return handleCachedResponse(cached, request.headers.get("Origin"));
  }

  const cacheableHeaders = new Headers();
  cacheableHeaders.set("Content-Type", "application/json");
  
  const source = new R2Source(env, NAME);
  const p = new PMTiles(source, CACHE, nativeDecompress);
  
  try {
    const t = await p.getTileJson(`https://${env.PUBLIC_HOSTNAME || url.hostname}/${NAME}`);
    return cacheableResponse(JSON.stringify(t), cacheableHeaders, 200, request, ctx, env);
  } catch (e) {
    if (e instanceof KeyNotFoundError) {
      return cacheableResponse("Archive not found", cacheableHeaders, 404, request, ctx, env);
    }
    throw e;
  }
}

async function handleFontRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const match = decodeURIComponent(url.pathname).match(FONT_PATTERN);
  if (!match) {
    return new Response("Invalid font URL", { status: 404 });
  }

  const { FONT_NAME, RANGE } = match.groups!;
  const fontPath = `fonts/${FONT_NAME}/${RANGE}.pbf`;

  const cache = caches.default;
  const cached = await cache.match(request.url);
  if (cached) {
    return handleCachedResponse(cached, request.headers.get("Origin"));
  }

  const cacheableHeaders = new Headers();
  cacheableHeaders.set("Content-Type", "application/octet-stream");

  console.log(fontPath);

  try {
    const fontFile = await env.BUCKET.get(fontPath);
    if (!fontFile) {
      return cacheableResponse("Font file not found", cacheableHeaders, 404, request, ctx, env);
    }

    const arrayBuffer = await fontFile.arrayBuffer();
    return cacheableResponse(arrayBuffer, cacheableHeaders, 200, request, ctx, env);
  } catch (e) {
    return cacheableResponse("Error fetching font file", cacheableHeaders, 500, request, ctx, env);
  }
}

function handleCachedResponse(cached: Response, origin: string | null): Response {
  const respHeaders = new Headers(cached.headers);
  if (origin) {
    respHeaders.set("Access-Control-Allow-Origin", origin);
  }
  respHeaders.set("Vary", "Origin");

  return new Response(cached.body, {
    headers: respHeaders,
    status: cached.status,
  });
}

function cacheableResponse(
  body: ArrayBuffer | string | undefined,
  cacheableHeaders: Headers,
  status: number,
  request: Request,
  ctx: ExecutionContext,
  env: Env,
): Response {
  cacheableHeaders.set("Cache-Control", env.CACHE_CONTROL || "public, max-age=86400");

  const cacheable = new Response(body, {
    headers: cacheableHeaders,
    status: status,
  });

  ctx.waitUntil(caches.default.put(request.url, cacheable));

  const respHeaders = new Headers(cacheableHeaders);
  const origin = request.headers.get("Origin");
  if (origin) {
    respHeaders.set("Access-Control-Allow-Origin", origin);
  }
  respHeaders.set("Vary", "Origin");
  return new Response(body, { headers: respHeaders, status: status });
}

const routes: RouteHandler[] = [
  {
    pattern: TILE_PATTERN,
    handler: handleTileRequest,
  },
  {
    pattern: TILESET_PATTERN,
    handler: handleTilesetRequest,
  },
  {
    pattern: FONT_PATTERN,
    handler: handleFontRequest,
  },
];

async function router(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method.toUpperCase() === "POST") {
    return new Response(undefined, { status: 405 });
  }

  const url = new URL(request.url);
  
  // Check if this request's Origin is in the allowed origins list. If no
  // Origin header was provided, the request will be allowed only if the
  // allowed list contains an entry "*" (which permits any Origin).
  const origin = request.headers.get("Origin");
  const allowedOrigins = env.ALLOWED_ORIGINS?.split("\n").filter(s => s.length > 0).map(globToRegex) ?? [];
  const isAllowed = allowedOrigins.some(regex => regex.test(origin ?? ""));

  if (!isAllowed) {
    return new Response("Origin not allowed", { status: 403 });
  }

  // Enforce per-user and per-origin rate limits

  // NOTE: IP address isn't necessarily unique per user (especially on mobile
  // networks) but it's the best we can do. Per-user limits should be set
  // generously to avoid frustrating users who share their IP with lots of
  // other users.
  const ipAddress = request.headers.get("cf-connecting-ip");
  const userLimiterResult = await env.PER_USER_RATE_LIMITER.limit({ key: ipAddress ?? "" });
  if (!userLimiterResult.success) {
    return new Response(`Rate limit exceeded for IP ${ipAddress}`, { status: 429 });
  }

  // Check if this request's Origin is favored (not subject to per-Origin
  // rate limiting). Only requests that send an Origin header can be favored;
  // requests that omit the Origin header are rate-limited together in one
  // bucket.
  const favoredOrigins = env.FAVORED_ORIGINS?.split("\n").filter(s => s.length > 0).map(globToRegex) ?? [];
  const isFavored = origin && favoredOrigins.some(regex => regex.test(origin));

  // Only enforce per-origin rate limiting if the Origin isn't on the Favored list
  if (!isFavored) {
    const originLimiterResult = await env.PER_ORIGIN_RATE_LIMITER.limit({ key: origin ?? "" });
    if (!originLimiterResult.success) {
      return new Response(`Rate limit exceeded for Origin ${origin}`, { status: 429 });
    }
  }

  // Match URL against routes
  for (const route of routes) {
    if (route.pattern.test(decodeURIComponent(url.pathname))) {
      return route.handler(request, env, ctx);
    }
  }

  return new Response("Not found", { status: 404 });
}

export default {
  fetch: router,
};
