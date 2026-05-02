import { createHash } from 'crypto'
import type { FileIndex } from '../db/FileIndex'
import type { HnswIndex } from '../ann/HnswIndex'
import type { EmbeddingEngine } from '../embedding/EmbeddingEngine'
import type { Relayouter } from '../layout/Relayouter'
import { pluralityVoteCluster } from '../layout/clustering'
import type { FileNode, WalkStats } from '../../shared/types'
import { K_NEAREST, ISOLATION_THRESHOLD } from '../../shared/types'
import { walkDirectory } from '../index/walker'
import type { WalkOptions } from '../index/walker'

export interface InsertPipelineOptions {
  db: FileIndex
  hnsw: HnswIndex
  embedEngine: EmbeddingEngine
  relayouter: Relayouter
  walkOpts?: WalkOptions
}

export async function indexPath(
  rootPath: string,
  opts: InsertPipelineOptions
): Promise<WalkStats> {
  const { db, hnsw, embedEngine, relayouter } = opts
  const start = Date.now()
  const stats: WalkStats = { scanned: 0, indexed: 0, skipped: 0, errors: 0, durationMs: 0 }

  const walker = await walkDirectory(rootPath, opts.walkOpts)

  for await (const { node, content } of walker) {
    stats.scanned++
    try {
      await insertOne(node, content, { db, hnsw, embedEngine, relayouter })
      stats.indexed++
    } catch (err) {
      stats.errors++
      console.error(`Error indexing ${node.path}:`, err)
    }
  }

  // Check if this batch crossed the layout threshold for the first time
  relayouter.maybeTrainFirst()

  stats.durationMs = Date.now() - start
  return stats
}

export async function insertOne(
  node: FileNode,
  content: Buffer,
  opts: Pick<InsertPipelineOptions, 'db' | 'hnsw' | 'embedEngine' | 'relayouter'>
): Promise<void> {
  const { db, hnsw, embedEngine, relayouter } = opts
  const now = Date.now()

  // 1. Check content hash BEFORE calling embed — skip if unchanged
  const existing = db.get(node.id)
  if (node.category !== 'media') {
    const text = content.toString('utf8')
    if (text.trim()) {
      const hash = createHash('sha1').update(text).digest('hex')
      if (existing?.contentHash === hash) return
    }
  }

  // 2. Get embed result (may be null for media/empty)
  const embedResult = await embedEngine.embedFile(node, content)

  // 3. Upsert the file row (with or without embedding)
  db.upsert({
    id: node.id,
    name: node.name,
    path: node.path,
    platform: node.platform,
    mimeType: node.mimeType,
    category: node.category,
    size: node.size,
    createdAt: node.createdAt,
    modifiedAt: node.modifiedAt,
    embedding: embedResult?.embedding ?? null,
    contentHash: embedResult?.contentHash ?? null,
    x: null,
    y: null,
    z: null,
    clusterId: null,
    layoutVersion: 0,
    firstSeen: existing?.firstSeen ?? now,
    viewCount: existing?.viewCount ?? 0,
    isPinned: existing?.isPinned ?? false,
  })

  if (!embedResult) return  // no embedding — done

  // 4. Add to HNSW
  hnsw.addPoint(embedResult.embedding, node.id)

  // 5. ANN top-K
  const knnResults = hnsw.searchKNN(embedResult.embedding, K_NEAREST + 1)
  const neighbors = knnResults.filter(r => r.id !== node.id).slice(0, K_NEAREST)

  // 6. Write outgoing edges for this file
  db.deleteEdgesFrom(node.id)
  for (const neighbor of neighbors) {
    const similarity = 1 - neighbor.distance  // hnswlib 'ip' distance = 1 - dot
    if (similarity < ISOLATION_THRESHOLD) continue
    db.upsertEdge({
      srcId: node.id,
      dstId: neighbor.id,
      weight: Math.max(0, Math.min(1, similarity)),
      engine: 'embedding',
      computedAt: now,
    })
  }
  db.pruneEdgesFrom(node.id, K_NEAREST)

  // 7. For each neighbor: check if this file should appear in their outgoing edges
  for (const neighbor of neighbors) {
    const similarity = 1 - neighbor.distance
    if (similarity < ISOLATION_THRESHOLD) continue
    const neighborEdges = db.getEdgesFrom(neighbor.id)
    const alreadyLinked = neighborEdges.some(e => e.dstId === node.id)
    if (!alreadyLinked) {
      // Does this file displace the worst neighbor's K-th edge?
      if (neighborEdges.length < K_NEAREST || similarity > neighborEdges[neighborEdges.length - 1].weight) {
        db.upsertEdge({
          srcId: neighbor.id,
          dstId: node.id,
          weight: Math.max(0, Math.min(1, similarity)),
          engine: 'embedding',
          computedAt: now,
        })
        db.pruneEdgesFrom(neighbor.id, K_NEAREST)
      }
    }
  }

  // 8. Cluster assignment: plurality vote among neighbors' cluster_ids
  const neighborClusterIds = neighbors
    .map(n => db.get(n.id)?.clusterId ?? null)
  const clusterId = pluralityVoteCluster(neighborClusterIds)
  db.updateCluster(node.id, clusterId)

  // 9. Project if layout is ready
  const pos = relayouter.projectOne(embedResult.embedding)
  if (pos) {
    db.updatePosition(node.id, pos[0], pos[1], relayouter.currentVersion)
  }
}
