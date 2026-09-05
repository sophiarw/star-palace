import { createHash } from 'crypto'
import type { AtlasNebula } from '../../shared/atlas'

export interface NebulaPoint { id: string; x: number; y: number; contentHash: string | null; size: number }
export interface NebulaEdge { src: string; dst: string; weight: number }
export const NEBULA_GROUP_LIMIT = 128
export const NEBULA_MEMBER_LIMIT = 48
const MAX_SPAN = 2400
const MIN_SIMILARITY = .92
const COLORS = ['#719ed1', '#c08eab', '#cba16f']

/** Evidence-led groups only: identical nonempty bytes or strong indexed semantic
 * edges. Directories alone never imply content similarity. No layout writes. */
export function nebulaGroups(points: NebulaPoint[], edges: NebulaEdge[]): AtlasNebula[] {
  const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(valid.map(p => [p.id, p])), assigned = new Set<string>(), result: AtlasNebula[] = []
  const build = (members: NebulaPoint[], links: NebulaEdge[], kind: AtlasNebula['kind']) => {
    const groups = new Map(members.map(p => [p.id, [p]])), roots = new Map(members.map(p => [p.id, p.id]))
    const root = (id: string): string => { const parent = roots.get(id)!; if (parent === id) return id; const top = root(parent); roots.set(id, top); return top }
    for (const edge of links) {
      if (!roots.has(edge.src) || !roots.has(edge.dst)) continue
      const a = root(edge.src), b = root(edge.dst)
      if (a === b) continue
      const combined = [...groups.get(a)!, ...groups.get(b)!]
      if (combined.length > NEBULA_MEMBER_LIMIT) continue
      const xs = combined.map(p => p.x), ys = combined.map(p => p.y)
      if (Math.max(...xs) - Math.min(...xs) > MAX_SPAN || Math.max(...ys) - Math.min(...ys) > MAX_SPAN) continue
      roots.set(b, a); groups.set(a, combined); groups.delete(b)
    }
    for (const members of groups.values()) {
      if (members.length < 3 || result.length >= NEBULA_GROUP_LIMIT) continue
      members.sort((a, b) => a.id.localeCompare(b.id))
      const hash = createHash('sha1').update(kind + ':' + members[0].id).digest('hex')
      result.push({ id: 'nebula:' + hash.slice(0, 16), kind, color: COLORS[parseInt(hash.slice(0, 4), 16) % COLORS.length], members: members.map(({ id, x, y }) => ({ id, x, y })) })
      for (const member of members) assigned.add(member.id)
    }
  }
  const duplicates = new Map<string, NebulaPoint[]>()
  for (const p of valid) if (p.contentHash && p.size > 0) {
    const key = p.size + ':' + p.contentHash, group = duplicates.get(key) ?? []
    group.push(p); duplicates.set(key, group)
  }
  for (const group of duplicates.values()) {
    if (group.length < 3 || result.length >= NEBULA_GROUP_LIMIT) continue
    // Spatial neighbors keep distant duplicate islands separate without all-pairs work.
    const links: NebulaEdge[] = []
    for (const axis of ['x', 'y'] as const) {
      const ordered = [...group].sort((a, b) => a[axis] - b[axis] || a.id.localeCompare(b.id))
      for (let i = 1; i < ordered.length; i++) links.push({ src: ordered[i - 1].id, dst: ordered[i].id, weight: 1 })
    }
    build(group, links, 'duplicates')
  }
  const links = edges.filter(e => e.weight >= MIN_SIMILARITY && byId.has(e.src) && byId.has(e.dst) && !assigned.has(e.src) && !assigned.has(e.dst))
    .sort((a, b) => b.weight - a.weight || a.src.localeCompare(b.src) || a.dst.localeCompare(b.dst))
  build(valid.filter(p => !assigned.has(p.id)), links, 'related')
  return result
}
