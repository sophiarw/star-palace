import type { AtlasFile, AtlasPage, AtlasScope, AtlasSearchResponse, AtlasSnapshot, AtlasSummary } from '@shared/atlas'
import type { FavoriteAppearance, FileContent } from '@shared/types'
import type { TextHistoryStatus, TextHistoryFile, TextHistoryVersion } from '@shared/history'
import type { UpdateStatus } from '@shared/update'

const BASE = `http://127.0.0.1:${(import.meta as ImportMeta & { env: { VITE_DAEMON_PORT?: string } }).env.VITE_DAEMON_PORT ?? 7373}/api/atlas`

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + path, init)
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}
function params(scope: AtlasScope, extra: Record<string, string> = {}): string {
  const values = new URLSearchParams(extra)
  for (const [key, value] of Object.entries(scope)) if (value !== undefined) values.set(key, Array.isArray(value) ? value.join(',') : String(value))
  return '?' + values.toString()
}
const body = (data: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

export const atlasApi = {
  updateStatus: () => request<UpdateStatus>('/update'),
  update: () => request<UpdateStatus>('/update', body({})),
  historyStatus: () => request<TextHistoryStatus>('/history'),
  historyEnable: (id: number, enabled: boolean) => request<TextHistoryStatus>('/history/source/' + id, body({ enabled })),
  history: (id: string) => request<TextHistoryFile>('/history/file/' + encodeURIComponent(id)),
  version: (id: string, version: string, signal?: AbortSignal) => request<TextHistoryVersion>('/history/file/' + encodeURIComponent(id) + '/' + version, { signal }),
  recover: (id: string, version: string) => request<{ path: string }>('/history/file/' + encodeURIComponent(id) + '/' + version + '/copy', body({})),
  summary: (scope: AtlasScope = {}, signal?: AbortSignal) => request<AtlasSummary>('/summary' + params(scope), { signal }),
  files: (scope: AtlasScope = {}, offset = 0, limit = 100, signal?: AbortSignal) => request<AtlasPage>('/files' + params(scope, { offset: String(offset), limit: String(limit) }), { signal }),
  viewport: (scope: AtlasScope, bounds: { minX: number; minY: number; maxX: number; maxY: number }, signal?: AbortSignal) => request<{ files: AtlasFile[]; revision: number }>('/viewport' + params(scope, Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, String(v)]))), { signal }),
  file: (id: string, signal?: AbortSignal) => request<AtlasFile>('/file/' + encodeURIComponent(id), { signal }),
  text: (id: string, signal?: AbortSignal) => request<FileContent & { status: string; error: string | null }>('/file/' + encodeURIComponent(id) + '/text', { signal }),
  search: (query: string, scope: AtlasScope, mode: 'exact' | 'related', signal?: AbortSignal) => request<AtlasSearchResponse>('/search', { ...body({ query, ...scope, mode, limit: 60 }), signal }),
  edit: (id: string) => request<{ editor: 'nvim' | 'vim' }>('/file/' + encodeURIComponent(id) + '/edit', body({})),
  favorite: (id: string, isFavorite: boolean, favoriteAppearance?: FavoriteAppearance) => request<{ file: AtlasFile; revision: number }>('/file/' + encodeURIComponent(id) + '/favorite', body({ isFavorite, favoriteAppearance })),
  pin: (id: string, x: number | null, y: number | null) => request<{ file: AtlasFile }>('/file/' + encodeURIComponent(id) + '/pin', body({ x, y })),
  rename: (id: string, label: string) => request('/region/' + encodeURIComponent(id), { ...body({ label }), method: 'PATCH' }),
  snapshots: () => request<AtlasSnapshot[]>('/snapshots'),
  snapshot: (name: string) => request<{ id: number }>('/snapshots', body({ name })),
  restore: (id: number) => request('/snapshots/' + id + '/restore', body({})),
}
