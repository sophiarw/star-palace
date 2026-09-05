import type { AtlasMarker, AtlasRegion } from '@shared/atlas'

export interface SkyLabel {
  id: string; title: string; x: number; y: number; level: 'broad' | 'cluster'
  members: AtlasMarker[]; minZoom: number
}
const smooth = (from: number, to: number, value: number): number => {
  if (from === to) return value >= to ? 1 : 0
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** All opacity depends on zoom alone: no hover, viewport, hydration or timers. */
export function skyLabelOpacity(label: Pick<SkyLabel, 'level' | 'minZoom'>, zoom: number): number {
  const separation = smooth(label.minZoom * .7, label.minZoom, zoom)
  return .85 * separation * (label.level === 'broad'
    ? 1 - smooth(.035, .10, zoom)
    : smooth(.045, .12, zoom) * (1 - smooth(.4, .85, zoom)))
}

/** Deterministic spatial groups, named from their dominant folder-derived labels.
 * Constructed from summary positions, never the current viewport or hydrated tiles.
 * The two levels nest; no saved file coordinate or folder membership is changed.
 */
export function skyLabels(markers: AtlasMarker[], regions: AtlasRegion[]): SkyLabel[] {
  const names = new Map(regions.map(r => [r.id, r.label]))
  const group = (points: AtlasMarker[], radius: number): AtlasMarker[][] => {
    const cells = new Map<string, AtlasMarker[][]>(), groups: AtlasMarker[][] = []
    for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
      const x = Math.floor(point.x / radius), y = Math.floor(point.y / radius)
      let closest: AtlasMarker[] | undefined, distance = radius
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const candidate of cells.get(`${x + dx}:${y + dy}`) ?? []) {
          const d = Math.hypot(point.x - candidate[0].x, point.y - candidate[0].y)
          if (d < distance) { closest = candidate; distance = d }
        }
      }
      if (closest) closest.push(point)
      else { const next = [point], key = `${x}:${y}`; groups.push(next); cells.set(key, [...(cells.get(key) ?? []), next]) }
    }
    return groups
  }
  const broad = group(markers, 6000), labels: SkyLabel[] = []
  for (const level of ['broad', 'cluster'] as const) {
    const groups = level === 'broad' ? broad : broad.flatMap(parent => group(parent, 1600))
    const candidates = groups.map(members => {
      const votes = new Map<string, number>()
      for (const file of members) {
        const name = names.get(level === 'broad' ? file.regionId : file.neighborhoodId) ?? names.get(file.regionId)
        if (name) votes.set(name, (votes.get(name) ?? 0) + 1)
      }
      const ranked = [...votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      const title = ranked.slice(0, ranked[0]?.[1] >= members.length * .65 ? 1 : 2).map(([name]) => name).join(' · ') || 'Files'
      return { id: `sky:${level}:${members[0].id}`, title: title.length > 32 ? title.slice(0, 29) + '…' : title,
        x: members[0].x, y: members[0].y, level, members, minZoom: 0 }
    }).sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id)).slice(0, level === 'broad' ? 24 : 96)
    // Lower-priority neighbors fade in only when their fixed anchors have room.
    // Decisions never depend on which labels happened to be visible last frame.
    for (let i = 0; i < candidates.length; i++) {
      const current = candidates[i]
      for (const previous of candidates.slice(0, i)) {
        const dx = Math.abs(current.x - previous.x), dy = Math.abs(current.y - previous.y)
        const required = Math.min((Math.max(current.title.length, previous.title.length) * 8 + 24) / Math.max(.001, dx), 32 / Math.max(.001, dy))
        current.minZoom = Math.max(current.minZoom, required)
      }
    }
    labels.push(...candidates)
  }
  return labels
}
