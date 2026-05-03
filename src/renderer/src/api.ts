import type { ViewportResult, MapStats, SearchResult, Star, Edge, FileContent, StarType, GalaxySummary } from '@shared/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BASE = `http://127.0.0.1:${(import.meta as any).env?.VITE_DAEMON_PORT ?? 7373}`

export async function fetchAll(): Promise<ViewportResult> {
  const res = await fetch(`${BASE}/api/map/all`)
  if (!res.ok) throw new Error(`fetchAll: ${res.status}`)
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
  files: { id: string; pcs: number[] }[]
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

export async function search(query: string, limit = 30): Promise<SearchResult[]> {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit }),
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

export interface IndexResult {
  scanned: number
  indexed: number
  skipped: number
  errors: number
  durationMs: number
  galaxyId?: number
  galaxyName?: string
}

export async function indexPath(path: string, galaxyName?: string): Promise<IndexResult> {
  const res = await fetch(`${BASE}/api/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, galaxyName }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`indexPath: ${res.status} ${text}`)
  }
  return res.json()
}
