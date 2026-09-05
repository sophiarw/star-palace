import type { AtlasFile, AtlasMarker } from '@shared/atlas'
import { project, type Camera } from './scene'

export type ConstellationVisibility = 'all' | 'focus' | 'off'
export interface FolderEdge {
  id: string; folder: string
  a: { id: string; x: number; y: number }
  b: { id: string; x: number; y: number }
}
export const CONSTELLATION_EDGE_BUDGET = 1600
export const folderFor = (file: Pick<AtlasFile, 'path'>): string => file.path.slice(0, file.path.lastIndexOf('/'))

/** Hydration exposes a precomputed graph; it never chooses new neighbors.
 * Require both endpoints in the current scope, so a filtered view cannot draw
 * lines to hidden files. Missing metadata only hides edges, never rewires them.
 */
export function visibleFolderEdges(files: AtlasFile[], markers: AtlasMarker[], selectedId: string | null): FolderEdge[] {
  const points = new Map([...markers, ...files].map(file => [file.id, file]))
  const edges = new Map<string, FolderEdge>()
  const selected = files.find(file => file.id === selectedId), folder = selected ? folderFor(selected) : null
  for (const file of files) for (const link of file.folderLinks ?? []) {
    const other = points.get(link.id)
    if (!other || other.id === file.id) continue
    const [a, b] = file.id < other.id ? [file, other] : [other, file]
    const id = JSON.stringify([a.id, b.id])
    edges.set(id, { id, folder: folderFor(file), a: { id: a.id, x: a.x, y: a.y }, b: { id: b.id, x: b.x, y: b.y } })
  }
  return [...edges.values()].sort((a, b) => Number(b.folder === folder) - Number(a.folder === folder) || a.id.localeCompare(b.id)).slice(0, CONSTELLATION_EDGE_BUDGET)
}

const smooth = (a: number, b: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Static, screen-width strokes behind stars. Only visibility fades animate. */
export class FolderConstellationPainter {
  private states = new Map<string, { edge: FolderEdge; opacity: number }>()
  private lastAt = 0

  draw(ctx: CanvasRenderingContext2D, edges: FolderEdge[], camera: Camera, width: number, height: number,
    options: { visibility: ConstellationVisibility; selectedFolder: string | null; highlights: Set<string>; moving?: { id: string; x: number; y: number }; reducedMotion: boolean },
    now = performance.now()): { count: number; pending: boolean } {
    const step = options.reducedMotion ? 1 : Math.min(1, (now - (this.lastAt || now - 16)) / 160)
    this.lastAt = now
    const current = new Set<string>()
    for (const edge of edges) {
      current.add(edge.id)
      const state = this.states.get(edge.id)
      if (state) state.edge = edge
      else if (this.states.size < CONSTELLATION_EDGE_BUDGET * 2) this.states.set(edge.id, { edge, opacity: 0 })
    }
    const zoomAlpha = smooth(.14, .45, camera.zoom)
    let count = 0, pending = false
    ctx.save(); ctx.strokeStyle = '#c5d9ef'; ctx.lineWidth = .75
    for (const [id, state] of this.states) {
      const edge = state.edge, selected = edge.folder === options.selectedFolder
      const wanted = current.has(id) && options.visibility !== 'off' && (options.visibility === 'all' || selected) ? 1 : 0
      state.opacity = wanted > state.opacity ? Math.min(wanted, state.opacity + step) : Math.max(wanted, state.opacity - step)
      if (Math.abs(state.opacity - wanted) > .001) pending = true
      if (!wanted && state.opacity <= 0) { this.states.delete(id); continue }
      if (zoomAlpha <= 0 || state.opacity <= 0) continue
      const a = options.moving?.id === edge.a.id ? options.moving : edge.a
      const b = options.moving?.id === edge.b.id ? options.moving : edge.b
      const [ax, ay] = project(a.x, a.y, camera, width, height), [bx, by] = project(b.x, b.y, camera, width, height)
      if (Math.max(ax, bx) < 0 || Math.min(ax, bx) > width || Math.max(ay, by) < 0 || Math.min(ay, by) > height) continue
      const length = Math.hypot(bx - ax, by - ay)
      // Fade very short/long screen-space connections continuously at zoom.
      const lengthAlpha = smooth(12, 32, length) * (1 - smooth(420, 720, length))
      const matching = !options.highlights.size || options.highlights.has(a.id) || options.highlights.has(b.id)
      ctx.globalAlpha = state.opacity * zoomAlpha * lengthAlpha * (selected ? .36 : .14) * (matching ? 1 : .25)
      if (ctx.globalAlpha <= .001) continue
      const inset = Math.min(10, length / 3), dx = (bx - ax) / length * inset, dy = (by - ay) / length * inset
      ctx.beginPath(); ctx.moveTo(ax + dx, ay + dy); ctx.lineTo(bx - dx, by - dy); ctx.stroke(); count++
    }
    ctx.restore()
    return { count, pending }
  }
}
