import {
  Compression,
  EtagMismatch,
  PMTiles,
  type RangeResponse,
  type Source,
  TileType,
} from "pmtiles";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

interface R2EventMessage {
  account: string;
  bucket: string;
  object: {
    key: string;
    size: number;
    eTag: string;
  };
  action: string;
  eventTime: string;
}

const MAX_ENTRIES = 20;

// R2Source and friends borrowed from adapted from cloudflare/src/index.ts
// TODO: maybe move this to a shared module

class KeyNotFoundError extends Error {}

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
      range: { offset, length },
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

const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
};

const xmlBuilderOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  format: true,
  suppressEmptyNode: true,
};

function parseAtomFeed(xml: string): unknown[] | null {
  try {
    const parser = new XMLParser(xmlParserOptions);
    const doc = parser.parse(xml) as Record<string, unknown>[];
    // Strip the parsed <?xml?> declaration node so we don't emit a duplicate
    return doc.filter((node) => !("?xml" in node));
  } catch (e) {
    console.warn("Failed to parse existing feed XML, will regenerate:", e);
    return null;
  }
}

function buildAtomXml(doc: unknown[]): string {
  const builder = new XMLBuilder(xmlBuilderOptions);
  return `<?xml version="1.0" encoding="utf-8"?>\n${builder.build(doc)}`;
}

interface EntryData {
  key: string;
  metadata: Record<string, unknown>;
  minZoom: number;
  maxZoom: number;
  tileType: TileType;
  size: number;
  timestamp: string;
  hostname: string;
}

function tileTypeName(t: TileType): string {
  switch (t) {
    case TileType.Mvt:
      return "MVT";
    case TileType.Png:
      return "PNG";
    case TileType.Jpeg:
      return "JPEG";
    case TileType.Webp:
      return "WebP";
    case TileType.Avif:
      return "AVIF";
    default:
      return "Unknown";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function tilesetName(key: string, metadata: Record<string, unknown>): string {
  if (typeof metadata.name === "string" && metadata.name.length > 0) {
    return metadata.name;
  }
  // Fall back to filename without extension
  return key.replace(/\.pmtiles$/, "").split("/").pop() ?? key;
}

function tilesetUrn(key: string): string {
  return `urn:osmus:tileset:${key.replace(/\.pmtiles$/, "")}`;
}

function str(metadata: Record<string, unknown>, key: string): string | null {
  const v = metadata[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function dlItem(label: string, value: string): unknown[] {
  return [{ dt: [{ "#text": label }] }, { dd: [{ "#text": value }] }];
}

function makeEntry(data: EntryData): unknown[] {
  const name = tilesetName(data.key, data.metadata);
  const typeName = tileTypeName(data.tileType);
  const sizeStr = formatBytes(data.size);
  const version = str(data.metadata, "version");
  const description = str(data.metadata, "description");
  const osmTimestamp = str(data.metadata, "planetiler:osm:osmosisreplicationtime");
  const planetilerVersion = str(data.metadata, "planetiler:version");

  const summaryParts = [`Zoom ${data.minZoom}-${data.maxZoom}`, typeName, sizeStr];
  if (version) summaryParts.push(`v${version}`);

  const dlItems: unknown[] = [
    ...dlItem("Tile type", typeName),
    ...dlItem("Zoom range", `${data.minZoom} - ${data.maxZoom}`),
    ...dlItem("File size", sizeStr),
  ];

  if (version) dlItems.push(...dlItem("Schema version", version));
  if (osmTimestamp) dlItems.push(...dlItem("OSM data timestamp", osmTimestamp));
  if (planetilerVersion) dlItems.push(...dlItem("Planetiler version", planetilerVersion));
  if (description) dlItems.push(...dlItem("Description", description));

  return [
    {
      entry: [
        { title: [{ "#text": `${name} updated` }] },
        {
          ":@": { "@_href": `https://${data.hostname}/${data.key.replace(/\.pmtiles$/, "/")}`, "@_rel": "alternate" },
          link: [],
        },
        { id: [{ "#text": `${tilesetUrn(data.key)}:${data.timestamp}` }] },
        { updated: [{ "#text": data.timestamp }] },
        { summary: [{ "#text": summaryParts.join(", ") }] },
        {
          ":@": { "@_type": "xhtml" },
          content: [
            {
              ":@": { "@_xmlns": "http://www.w3.org/1999/xhtml" },
              div: dlItems.map((item) => ({ dl: [item] })),
            },
          ],
        },
      ],
    },
  ];
}

function makeFeedSkeleton(data: EntryData): unknown[] {
  const name = tilesetName(data.key, data.metadata);
  const feedKey = data.key.replace(/\.pmtiles$/, ".atom.xml");

  return [
    {
      ":@": { "@_xmlns": "http://www.w3.org/2005/Atom" },
      feed: [
        { title: [{ "#text": `${name} Tileset Updates` }] },
        {
          ":@": {
            "@_href": `https://${data.hostname}/${feedKey}`,
            "@_rel": "self",
            "@_type": "application/atom+xml",
          },
          link: [],
        },
        { id: [{ "#text": tilesetUrn(data.key) }] },
        { updated: [{ "#text": data.timestamp }] },
      ],
    },
  ];
}

function updateFeed(existingXml: string | null, data: EntryData): string {
  const newEntry = makeEntry(data);
  let doc = existingXml ? parseAtomFeed(existingXml) : null;

  if (!doc) {
    doc = makeFeedSkeleton(data);
  }

  // Find the feed element
  const feedNode = (doc as Record<string, unknown>[]).find((node) => "feed" in node);
  if (!feedNode) {
    doc = makeFeedSkeleton(data);
    return updateFeed(null, data);
  }

  const feedChildren = (feedNode as Record<string, unknown[]>).feed;

  // Update the feed-level <updated> timestamp
  const updatedNode = feedChildren.find(
    (child) => typeof child === "object" && child !== null && "updated" in child,
  );
  if (updatedNode) {
    (updatedNode as Record<string, unknown[]>).updated = [{ "#text": data.timestamp }];
  }

  // Separate existing entries from feed metadata
  const metadataNodes = feedChildren.filter(
    (child) => !(typeof child === "object" && child !== null && "entry" in child),
  );
  const existingEntries = feedChildren.filter(
    (child) => typeof child === "object" && child !== null && "entry" in child,
  );

  // Prepend new entry, truncate to MAX_ENTRIES
  const allEntries = [...newEntry, ...existingEntries].slice(0, MAX_ENTRIES);

  // Reassemble: metadata nodes first, then entries
  (feedNode as Record<string, unknown[]>).feed = [...metadataNodes, ...allEntries];

  return buildAtomXml(doc);
}

async function processEvent(event: R2EventMessage, env: Env): Promise<void> {
  const key = event.object.key;
  if (!key.endsWith(".pmtiles")) return;

  const feedKey = key.replace(/\.pmtiles$/, ".atom.xml");

  const source = new R2Source(env, key);
  const pmtiles = new PMTiles(source, undefined, nativeDecompress);
  const header = await pmtiles.getHeader();
  const metadata = (await pmtiles.getMetadata()) as Record<string, unknown>;

  const existingFeed = await env.BUCKET.get(feedKey);
  const existingXml = existingFeed ? await existingFeed.text() : null;

  const updatedXml = updateFeed(existingXml, {
    key,
    metadata,
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    tileType: header.tileType,
    size: event.object.size,
    timestamp: event.eventTime,
    hostname: env.PUBLIC_HOSTNAME,
  });

  await env.BUCKET.put(feedKey, updatedXml, {
    httpMetadata: { contentType: "application/atom+xml" },
  });

  console.log(`Updated feed: ${feedKey}`);
}

export default {
  async queue(batch: MessageBatch<R2EventMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processEvent(message.body, env);
        message.ack();
      } catch (e) {
        console.error(`Failed to process ${message.body.object.key}:`, e);
        message.retry();
      }
    }
  },
};
