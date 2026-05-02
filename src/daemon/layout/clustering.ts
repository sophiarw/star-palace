import type { FileIndex } from '../db/FileIndex'
import { ISOLATION_THRESHOLD, CONSTELLATION_PALETTE } from '../../shared/types'

// Connected-components clustering on the persistent edge graph.
// For MVP: runs during full re-fit. Per-insert uses plurality-vote (in Insert.ts).
export function recomputeClusters(db: FileIndex): void {
  const files = db.listWithEmbeddings()
  if (files.length === 0) return

  // Build adjacency: only edges with weight >= threshold
  const adj: Map<string, string[]> = new Map()
  for (const f of files) {
    const edges = db.getEdgesFrom(f.id)
    for (const e of edges) {
      if (e.weight < ISOLATION_THRESHOLD) continue
      if (!adj.has(e.srcId)) adj.set(e.srcId, [])
      if (!adj.has(e.dstId)) adj.set(e.dstId, [])
      adj.get(e.srcId)!.push(e.dstId)
      adj.get(e.dstId)!.push(e.srcId)
    }
  }

  // Union-find
  const parent: Map<string, string> = new Map()
  for (const f of files) parent.set(f.id, f.id)

  function find(id: string): string {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!))
    return parent.get(id)!
  }
  function union(a: string, b: string): void {
    parent.set(find(a), find(b))
  }

  for (const [src, dsts] of adj) {
    for (const dst of dsts) union(src, dst)
  }

  // Group by root
  const components: Map<string, string[]> = new Map()
  for (const f of files) {
    const root = find(f.id)
    if (!components.has(root)) components.set(root, [])
    components.get(root)!.push(f.id)
  }

  // Assign clusters (only components with >= 2 members)
  db.clearClusters()
  let colorIndex = 0
  const rootToClusterId: Map<string, number> = new Map()

  for (const [root, members] of components) {
    if (members.length < 2) continue  // isolated stars get cluster_id = NULL
    const clusterId = db.upsertCluster({
      colorIndex: colorIndex % CONSTELLATION_PALETTE.length,
      centroidX: null,
      centroidY: null,
      memberCount: members.length,
      label: null,
    })
    rootToClusterId.set(root, clusterId)
    colorIndex++
  }

  // Assign cluster_id per file
  for (const f of files) {
    const root = find(f.id)
    const clusterId = rootToClusterId.get(root) ?? null
    db.updateCluster(f.id, clusterId)
  }

  // Recompute centroids for positioned files
  updateClusterCentroids(db)
}

export function updateClusterCentroids(db: FileIndex): void {
  const clusters = db.getClusters()
  for (const c of clusters) {
    const rows = db.db.prepare(`
      SELECT x, y FROM files WHERE cluster_id = ? AND x IS NOT NULL AND y IS NOT NULL
    `).all(c.id) as { x: number; y: number }[]
    if (rows.length === 0) continue
    const cx = rows.reduce((s, r) => s + r.x, 0) / rows.length
    const cy = rows.reduce((s, r) => s + r.y, 0) / rows.length
    db.upsertCluster({ id: c.id, colorIndex: c.colorIndex, centroidX: cx, centroidY: cy, memberCount: rows.length, label: c.label })
  }
}

// Per-insert plurality vote: assign cluster from neighbors
export function pluralityVoteCluster(neighborClusterIds: (number | null)[]): number | null {
  const counts: Map<number, number> = new Map()
  for (const id of neighborClusterIds) {
    if (id === null) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let best: number | null = null
  let bestCount = 0
  for (const [id, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && id < best)) {
      best = id
      bestCount = count
    }
  }
  return best
}
