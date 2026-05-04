export type Platform = 'local' | 'google-drive' | 'confluence' | 'dropbox' | 'onedrive'

export type FileCategory = 'document' | 'data' | 'code' | 'media' | 'unknown'

export interface FileNode {
  id: string
  name: string
  path: string
  platform: Platform
  mimeType: string
  category: FileCategory
  size: number
  createdAt: number
  modifiedAt: number
  isStale?: boolean
}

export interface SearchQuery {
  query: string
  limit?: number
}

export interface WalkStats {
  scanned: number
  indexed: number
  skipped: number
  errors: number
  durationMs: number
}

// Star: a file with a persistent 2D position in the sky
export interface Star extends FileNode {
  x: number
  y: number
  clusterId: number | null
  galaxyId: number | null  // F9: parent galaxy; null only on legacy rows pre-migration
  layoutVersion: number
  firstSeen: number
  viewCount: number
  isPinned: boolean
  starType: StarType | null  // manual override; null = default cluster-hue rendering
  // F4 — pin coefficients (embedding-delta). All NULL when not pinned.
  pinAlpha: number | null
  pinBeta: number | null
  pinAxisA: number | null  // PC index 0..7 active at pin time (X)
  pinAxisB: number | null  // PC index 0..7 active at pin time (Y)
  pinnedAt: number | null
  // F10 — usage signals + denormalised composite. NULL until walker pass
  // populates them (Spotlight on macOS, fs.stat atime elsewhere). The
  // renderer reads importanceScore for the usage-mode classifier.
  osUseCount: number | null
  osLastUsed: number | null
  importanceScore: number | null
}

export const STAR_TYPES = [
  'red-giant',
  'blue-supergiant',
  'white-dwarf',
  // F10 — sun-like middle-of-the-lifecycle star, sits between white-dwarf
  // (small/cool) and red-giant (large/warm) in the usage-mode classifier.
  'main-sequence',
  'neutron-star',
  'pulsar',
  'binary',
  'quasar',
  'black-hole',
  'nebula',
] as const
export type StarType = typeof STAR_TYPES[number]

export function isStarType(value: unknown): value is StarType {
  return typeof value === 'string' && (STAR_TYPES as readonly string[]).includes(value)
}

// Edge: persisted top-K nearest-neighbor link
export interface Edge {
  srcId: string
  dstId: string
  weight: number  // cosine similarity in [0,1]
  engine: 'embedding' | 'metadata'
  computedAt: number
}

// Cluster: a constellation of semantically related stars
export interface Cluster {
  id: number
  colorIndex: number
  centroidX: number | null
  centroidY: number | null
  memberCount: number
  label: string | null
}

// Galaxy (F9): a top-level grouping of indexed files. One galaxy per indexed
// root path. Each galaxy has a deterministic origin offset on the map so they
// appear as separate spatial clusters that the user can pan between.
export interface Galaxy {
  id: number
  name: string
  rootPath: string
  originX: number
  originY: number
  createdAt: number
}

export interface GalaxySummary extends Galaxy {
  memberCount: number
}

// F5 — Virtual collections. A Collection is a named, persistent group of files.
// `static` collections store explicit member IDs in `collection_members`;
// `dynamic` collections store a query string + similarity floor and re-evaluate
// membership on demand. Both render as a constellation-style hull in the sky
// with `colorIndex` driving the hue.
export type CollectionKind = 'static' | 'dynamic'

export interface Collection {
  id: number
  name: string
  kind: CollectionKind
  query: string | null            // non-null for dynamic
  similarityFloor: number | null  // non-null for dynamic; default 0.6
  colorIndex: number
  createdAt: number
  updatedAt: number
  evaluatedAt: number | null      // last time membership was re-evaluated (dynamic only)
}

export interface CollectionSummary extends Collection {
  memberCount: number
}

// Default similarity floor for dynamic collections — passes through any
// neighbor whose cosine similarity is at least this. Tuned to admit a useful
// neighborhood without dragging in obvious mismatches.
export const COLLECTION_DEFAULT_SIMILARITY_FLOOR = 0.6
// Local-storage key for the renderer's "active collection" persistence.
export const COLLECTION_ACTIVE_LS_KEY = 'starpalace.activeCollection.v1'

// MapStats: summary from /api/map/stats
export interface MapStats {
  total: number
  indexedWithEmbedding: number
  layoutVersion: number
  lastRefitAt: number | null
  clusterCount: number
}

// Viewport query result
export interface ViewportResult {
  stars: Star[]
  clusters: Cluster[]
}

// Search result: star coordinates + score for camera animation
export interface SearchResult {
  id: string
  x: number
  y: number
  score: number
  name: string
  path: string
  // F9 — galaxy id so non-renderer consumers can apply the per-galaxy
  // origin offset; the renderer also reads this from /api/galaxies and
  // joins on the result list.
  galaxyId: number | null
  // F4 — pin coefficients on the file at search time. The renderer's
  // pcDial re-projects pinned files locally; surfacing the coefficients
  // here lets non-renderer clients reproduce the visual location
  // without a second round-trip. NULL when the file isn't pinned.
  isPinned: boolean
  pinAlpha: number | null
  pinBeta: number | null
  pinAxisA: number | null
  pinAxisB: number | null
}

// F3/F4 — payload of `/api/map/projection`. One entry per file with an
// embedding; `pcs` is its projection onto every PC the trained model
// retains. Pin coefs ride along so the renderer can apply them client-side
// without a second round-trip when the user toggles the PC dial.
export interface ProjectionFile {
  id: string
  pcs: number[]
  isPinned: boolean
  pinAlpha: number | null
  pinBeta: number | null
  pinAxisA: number | null
  pinAxisB: number | null
}

// File content payload for in-app viewer
export interface FileContent {
  content: string | null   // null when binary/media; viewer should fall back to /raw
  mimeType: string
  truncated: boolean       // true if content was capped at VIEW_BYTES
  size: number             // total file size on disk
}

export const VIEW_BYTES = 120 * 1024  // viewer cap; larger than embedding's MAX_TEXT_BYTES

export const CONSTELLATION_PALETTE = [
  '#b388ff', '#80cbc4', '#f48fb1', '#a5d6a7', '#ffcc80', '#ef9a9a',
] as const

export const ISOLATION_THRESHOLD = 0.3
export const K_NEAREST = 20
export const LAYOUT_THRESHOLD = 200  // min embeddings before PCA trains
export const EMBED_DIM = 768
export const OLLAMA_PORT = 11434
export const DAEMON_PORT = 7373
export const MAX_TEXT_BYTES = 8 * 1024  // 8KB safety cap. Prose tokenises ~4 bytes/token (so 8KB ≈ 2k tokens, well under nomic-embed-text num_ctx=8192), but binary/CSV/code is 1-2 bytes/token; the prior 30KB cap blew the context limit on ~29% of Documents (PDFs, CSVs, dense code). When real PDF/DOCX extractors land, this can grow back.
export const MAX_FILE_BYTES = 5 * 1024 * 1024  // 5MB

// F9 galaxies: world-unit spacing for the deterministic spiral that places
// each new galaxy's origin. Local PCA spread is ±500, so 1000 puts adjacent
// galaxies one diameter apart — visibly separated, still in one viewport at
// fit-all zoom.
export const GALAXY_SPIRAL_STEP = 1000
// Default galaxy created on migration to host any legacy files (no galaxy_id).
export const DEFAULT_GALAXY_NAME = 'default'
