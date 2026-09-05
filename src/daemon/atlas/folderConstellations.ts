import { dirname, isAbsolute } from 'path'
import type { AtlasFolderLink } from '../../shared/atlas'

export interface FolderPoint { id: string; path: string; x: number; y: number }
export const MAX_FOLDER_LINK_LENGTH = 2400
export const MAX_FOLDER_DEGREE = 3

/** A sparse local forest over complete direct-parent folders. O(n log n),
 * at most four candidate edges and three accepted neighbors per file.
 * The graph is derived only: it never writes or rearranges file positions.
 */
export function folderConstellations(files: FolderPoint[]): Map<string, AtlasFolderLink[]> {
  const folders = new Map<string, FolderPoint[]>(), graph = new Map<string, AtlasFolderLink[]>()
  for (const file of files) {
    if (!file.path || !isAbsolute(file.path) || !Number.isFinite(file.x) || !Number.isFinite(file.y)) continue
    const folder = dirname(file.path), group = folders.get(folder) ?? []
    group.push(file); folders.set(folder, group)
  }
  for (const group of folders.values()) {
    if (group.length < 2) continue
    const candidates = new Map<string, { a: FolderPoint; b: FolderPoint; distance: number }>()
    for (const axis of ['x', 'y'] as const) {
      const ordered = [...group].sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id))
      for (let i = 1; i < ordered.length; i++) {
        let a = ordered[i - 1], b = ordered[i]
        if (a.id > b.id) [a, b] = [b, a]
        const distance = Math.hypot(a.x - b.x, a.y - b.y)
        if (distance > 0 && distance <= MAX_FOLDER_LINK_LENGTH) candidates.set(JSON.stringify([a.id, b.id]), { a, b, distance })
      }
    }
    const roots = new Map(group.map(file => [file.id, file.id]))
    const root = (id: string): string => {
      let top = id
      while (roots.get(top) !== top) top = roots.get(top)!
      while (id !== top) { const next = roots.get(id)!; roots.set(id, top); id = next }
      return top
    }
    const edges = [...candidates.values()].sort((a, b) => a.distance - b.distance || a.a.id.localeCompare(b.a.id) || a.b.id.localeCompare(b.b.id))
    for (const { a, b } of edges) {
      const aLinks = graph.get(a.id) ?? [], bLinks = graph.get(b.id) ?? [], aRoot = root(a.id), bRoot = root(b.id)
      if (aRoot === bRoot || aLinks.length >= MAX_FOLDER_DEGREE || bLinks.length >= MAX_FOLDER_DEGREE) continue
      roots.set(aRoot, bRoot)
      aLinks.push({ id: b.id, x: b.x, y: b.y }); bLinks.push({ id: a.id, x: a.x, y: a.y })
      graph.set(a.id, aLinks); graph.set(b.id, bLinks)
    }
  }
  return graph
}
