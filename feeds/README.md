# Tileset Feed Worker

Cloudflare Worker that maintains per-tileset Atom feeds. When a new PMTiles file is uploaded to R2, this worker receives a queue event, reads the tileset metadata, and appends a new entry to an Atom XML file.

Each tileset gets its own feed at the same path with a `.atom.xml` extension. For example, `vector/openmaptiles.pmtiles` produces a feed at `vector/openmaptiles.atom.xml`.
