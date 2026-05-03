import type {
  ViewportResult, MapStats, SearchResult, Star, Edge, FileContent, StarType, GalaxySummary, ProjectionFile,
  Collection, CollectionSummary, CollectionKind,
} from '@shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = `http://127.0.0.1:${(import.meta as any).env?.VITE_DAEMON_PORT ?? 7373}`

export async function fetchAll(): Promise<ViewportResult> {
  const res = await fetch(`${BASE}/api/map/all`)
  if (!res.ok) throw new Error(`fetchAll: ${res.status}`)
  return res.json()
}

export interface PositionsDeltaResult {
  version: number
  positions: { id: string; x: number; y: number; layoutVersion: number }[]
  clusters: import('@shared/types').Cluster[]
}

export async function fetchPositionsSince(since: number): Promise<PositionsDeltaResult> {
  const params = new URLSearchParams({ since: String(since) })
  const res = await fetch(`${BASE}/api/map/positions?${params}`)
  if (!res.ok) throw new Error(`fetchPositionsSince: ${res.status}`)
  return res.json()
}

export async function fetchViewport(x1: number, y1: number, x2: number, y2: number): Promise<ViewportResult> {
  const params = new URLSearchParams({ x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) })
  const res = await fetch(`${BASE}/api/map/viewport?${params}`)
  if (!res.ok) throw new Error(`fetchViewport: ${res.status}`)
  return res.json()
}

export interface ProjectionPayload {
  componentCount: number
  files: ProjectionFile[]
}

export async function fetchProjection(): Promise<ProjectionPayload> {
  const res = await fetch(`${BASE}/api/map/projection`)
  if (!res.ok) throw new Error(`fetchProjection: ${res.status}`)
  return res.json()
}

export async function fetchStats(): Promise<MapStats> {
  const res = await fetch(`${BASE}/api/map/stats`)
  if (!res.ok) throw new Error(`fetchStats: ${res.status}`)
  return res.json()
}

export async function search(query: string, limit = 30, collectionId?: number): Promise<SearchResult[]> {
  // F5 — when collectionId is supplied, the daemon pre-filters KNN hits to
  // members of that collection before ranking. Optional so the existing call
  // sites (e.g. CollectionsPanel-less code paths) keep working unchanged.
  const body: { query: string; limit: number; collectionId?: number } = { query, limit }
  if (collectionId !== undefined) body.collectionId = collectionId
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`search: ${res.status}`)
  const data = await res.json() as { results: SearchResult[] }
  return data.results
}

export async function fetchFile(id: string): Promise<Star & { isStale?: boolean }> {
  const res = await fetch(`${BASE}/api/file/${id}`)
  if (!res.ok) throw new Error(`fetchFile: ${res.status}`)
  return res.json()
}

export interface NeighborhoodResult {
  file: Star
  neighbors: { file: Star; weight: number }[]
  clusterColor: string | null
}

export async function fetchNeighborhood(id: string): Promise<NeighborhoodResult> {
  const res = await fetch(`${BASE}/api/file/${id}/neighborhood`)
  if (!res.ok) throw new Error(`fetchNeighborhood: ${res.status}`)
  return res.json()
}

export async function openFile(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/file/${id}/open`, { method: 'POST' })
  if (!res.ok) throw new Error(`openFile: ${res.status}`)
}

// F14 — Reveal the file in the OS file explorer (Finder / Explorer / file
// manager). Daemon picks the right shell-out per platform.
export async function revealFile(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/file/${id}/reveal`, { method: 'POST' })
  if (!res.ok) throw new Error(`revealFile: ${res.status}`)
}

export async function fetchContent(id: string): Promise<FileContent> {
  const res = await fetch(`${BASE}/api/file/${id}/content`)
  if (!res.ok) throw new Error(`fetchContent: ${res.status}`)
  return res.json()
}

export function rawUrl(id: string): string {
  return `${BASE}/api/file/${id}/raw`
}

export async function setStarType(id: string, starType: StarType | null): Promise<void> {
  const res = await fetch(`${BASE}/api/file/${id}/star-type`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starType }),
  })
  if (!res.ok) throw new Error(`setStarType: ${res.status}`)
}

// F4 — body x/y are TARGET coordinates in PC space on (axisA, axisB).
// Caller (renderer/usePcDial.pinFile) inverts its own min/max scaling
// before posting so the daemon stays scale-agnostic.
export async function pinStar(
  id: string,
  x: number,
  y: number,
  axisA: number,
  axisB: number,
): Promise<{ alpha: number; beta: number; axisA: number; axisB: number }> {
  const res = await fetch(`${BASE}/api/file/${id}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, axisA, axisB }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`pinStar: ${res.status} ${(body as { error?: string }).error ?? ''}`)
  }
  return res.json()
}

export async function unpinStar(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/file/${id}/unpin`, { method: 'POST' })
  if (!res.ok) throw new Error(`unpinStar: ${res.status}`)
}

export function edgeFromNeighborhood(fileId: string, neighbors: { file: Star; weight: number }[]): Edge[] {
  return neighbors.map(n => ({
    srcId: fileId,
    dstId: n.file.id,
    weight: n.weight,
    engine: 'embedding' as const,
    computedAt: Date.now(),
  }))
}

// F9 — Galaxies

export async function fetchGalaxies(): Promise<GalaxySummary[]> {
  const res = await fetch(`${BASE}/api/galaxies`)
  if (!res.ok) throw new Error(`fetchGalaxies: ${res.status}`)
  const data = await res.json() as { galaxies: GalaxySummary[] }
  return data.galaxies
}

// F17 — `POST /api/index` is now non-blocking; it returns synchronously with
// a `jobId` so the renderer can subscribe to `/api/index/progress?jobId=…`
// before the walker fires its first event. Final stats (scanned/indexed/...)
// arrive on the SSE stream's terminal frame, not the POST response.
export interface IndexJobHandle {
  jobId: string
  galaxyId: number
  galaxyName: string
}

export async function startIndex(path: string, galaxyName?: string): Promise<IndexJobHandle> {
  const res = await fetch(`${BASE}/api/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, galaxyName }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`startIndex: ${res.status} ${text}`)
  }
  return res.json()
}

// F17 — DELETE the live progress entry to cooperatively cancel the walker.
export async function cancelIndex(jobId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/index/progress/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
  // Treat 404 as success — the job already finished or was never created;
  // either way the UI's intent ("stop indexing") is satisfied.
  if (!res.ok && res.status !== 404) {
    throw new Error(`cancelIndex: ${res.status}`)
  }
}

// F17 — SSE event payload mirrors ProgressState in the daemon.
export interface IndexProgressEvent {
  jobId: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  scanned: number
  indexed: number
  skipped: number
  errors: number
  total: number | null
  currentPath: string | null
  startedAt: number
  lastUpdateAt: number
  finishedAt: number | null
  errorMessage: string | null
  galaxyId: number | null
  galaxyName: string | null
}

export function indexProgressUrl(jobId: string): string {
  const params = new URLSearchParams({ jobId })
  return `${BASE}/api/index/progress?${params}`
}

// F5 — Collections

export async function listCollections(): Promise<CollectionSummary[]> {
  const res = await fetch(`${BASE}/api/collections`)
  if (!res.ok) throw new Error(`listCollections: ${res.status}`)
  const data = await res.json() as { collections: CollectionSummary[] }
  return data.collections
}

export interface CreateCollectionInput {
  name: string
  kind: CollectionKind
  query?: string
  similarityFloor?: number
  fileIds?: string[]
  colorIndex?: number
}

// HttpError is thrown by the create path so callers (CollectionsPanel) can
// distinguish the unique-name-conflict case (status 409) and surface a
// specific "name in use" message instead of a generic failure.
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function createCollection(input: CreateCollectionInput): Promise<CollectionSummary> {
  const res = await fetch(`${BASE}/api/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new HttpError(res.status, body.error ?? `createCollection: ${res.status}`)
  }
  return res.json()
}

export async function getCollection(id: number): Promise<Collection & { memberIds: string[]; memberCount: number }> {
  const res = await fetch(`${BASE}/api/collections/${id}`)
  if (!res.ok) throw new Error(`getCollection: ${res.status}`)
  return res.json()
}

export async function addCollectionMembers(id: number, fileIds: string[]): Promise<void> {
  const res = await fetch(`${BASE}/api/collections/${id}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds }),
  })
  if (!res.ok) throw new Error(`addCollectionMembers: ${res.status}`)
}

export async function removeCollectionMember(id: number, fileId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/collections/${id}/members/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`removeCollectionMember: ${res.status}`)
}

export interface RefreshResult {
  added: string[]
  removed: string[]
  memberCount: number
}

export async function refreshCollection(id: number): Promise<RefreshResult> {
  const res = await fetch(`${BASE}/api/collections/${id}/refresh`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new HttpError(res.status, body.error ?? `refreshCollection: ${res.status}`)
  }
  return res.json()
}

export async function deleteCollection(id: number): Promise<void> {
  const res = await fetch(`${BASE}/api/collections/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`deleteCollection: ${res.status}`)
}
