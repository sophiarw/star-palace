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
}

export const STAR_TYPES = [
  'red-giant',
  'blue-supergiant',
  'white-dwarf',
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
export const MAX_TEXT_BYTES = 30 * 1024  // 30KB ≈ 7500 tokens; stays under nomic-embed-text num_ctx=8192
export const MAX_FILE_BYTES = 5 * 1024 * 1024  // 5MB

// F9 galaxies: world-unit spacing for the deterministic spiral that places
// each new galaxy's origin. Local PCA spread is ±500, so 4000 keeps galaxies
// visually separated with comfortable empty-space buffer.
export const GALAXY_SPIRAL_STEP = 4000
// Default galaxy created on migration to host any legacy files (no galaxy_id).
export const DEFAULT_GALAXY_NAME = 'default'
