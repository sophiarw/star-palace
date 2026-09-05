import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

export interface LayoutFile { id: string; path: string; x: number | null; y: number | null }
export interface OrganicPoint { x: number; y: number }
export const LEGACY_ATLAS_SCALE = 20
export const hashUnit = (id: string): number => parseInt(createHash('sha1').update(id).digest('hex').slice(0, 8), 16) / 4294967296

/** A stable, non-periodic cloud for files without a projection or known neighbors. */
export function cloudOffset(id: string, radius: number): OrganicPoint {
  const angle = hashUnit(id) * Math.PI * 2
  const distance = Math.sqrt(-2 * Math.log(Math.max(.0001, hashUnit(id + ':radius')))) * radius * .42
  return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance }
}

/** Preserve the original semantic shape; only separate practically coincident files. */
export function organicLayout(files: LayoutFile[], neighbors: Map<string, string[]> = new Map()): Map<string, OrganicPoint> {
  const ordered = [...files].sort((a, b) => a.id.localeCompare(b.id))
  const result = new Map<string, OrganicPoint>(), occupied = new Map<string, OrganicPoint[]>()
  const directories = new Map<string, { x: number; y: number; count: number; samples: OrganicPoint[] }>()
  const projected = new Map<string, OrganicPoint>()
  for (const file of ordered) if (file.x !== null && file.y !== null && Number.isFinite(file.x) && Number.isFinite(file.y)) {
    const point = { x: file.x * LEGACY_ATLAS_SCALE, y: file.y * LEGACY_ATLAS_SCALE }
    projected.set(file.id, point)
    let dir = dirname(file.path)
    for (let depth = 0; depth < 20; depth++) {
      const stats = directories.get(dir) ?? { x: 0, y: 0, count: 0, samples: [] }
      stats.x += point.x; stats.y += point.y; stats.count++
      if (stats.samples.length < 32) stats.samples.push(point)
      directories.set(dir, stats)
      const parent = dirname(dir); if (parent === dir) break; dir = parent
    }
  }
  const gap = 18
  const place = (id: string, anchor: OrganicPoint): void => {
    for (let attempt = 0; ; attempt++) {
      const angle = hashUnit(id) * Math.PI * 2 + attempt * 2.399963229728653
      const radius = attempt ? gap * Math.sqrt(attempt) : 0
      const point = { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius }
      const gx = Math.floor(point.x / gap), gy = Math.floor(point.y / gap)
      let blocked = false
      for (let x = gx - 1; x <= gx + 1 && !blocked; x++) for (let y = gy - 1; y <= gy + 1; y++) {
        if (occupied.get(`${x}:${y}`)?.some(p => Math.hypot(p.x - point.x, p.y - point.y) < gap)) { blocked = true; break }
      }
      if (blocked) continue
      const key = `${gx}:${gy}`, cell = occupied.get(key) ?? []
      cell.push(point); occupied.set(key, cell); result.set(id, point); return
    }
  }
  // Projected files get first claim to their original coordinates.
  for (const file of ordered) { const point = projected.get(file.id); if (point) place(file.id, point) }
  for (const file of ordered) {
    if (result.has(file.id)) continue
    const related = (neighbors.get(file.id) ?? []).map(id => projected.get(id)).filter((p): p is OrganicPoint => !!p)
    let anchor: OrganicPoint | undefined
    if (related.length) anchor = { x: related.reduce((n, p) => n + p.x, 0) / related.length, y: related.reduce((n, p) => n + p.y, 0) / related.length }
    let dir = dirname(file.path)
    if (!anchor) for (let depth = 0; depth < 20; depth++) {
      const stats = directories.get(dir)
      if (stats) {
        const local = stats.samples[Math.floor(hashUnit(file.id) * stats.samples.length)]
        anchor = { x: local.x * .8 + stats.x / stats.count * .2, y: local.y * .8 + stats.y / stats.count * .2 }
        break
      }
      const parent = dirname(dir); if (parent === dir) break; dir = parent
    }
    // A model-free source remains an irregular cloud organized by its folders.
    const center = anchor ?? cloudOffset(dirname(file.path), 3500)
    const offset = cloudOffset(file.id, anchor ? 220 : 550)
    place(file.id, { x: center.x + offset.x, y: center.y + offset.y })
  }
  return result
}
