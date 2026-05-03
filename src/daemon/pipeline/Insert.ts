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

  const existing = db.get(node.id)
  if (node.category !== 'media') {
    const text = content.toString('utf8')
    if (text.trim()) {
      const hash = createHash('sha1').update(text).digest('hex')
      if (existing?.contentHash === hash) return
    }
  }

  const embedResult = await embedEngine.embedFile(node, content)

  // ANN search runs against the existing index — the new point is not added
  // until the DB transaction commits, so a tx rollback never leaves an HNSW
  // orphan referencing a missing file row. Self-filtering still handles the
  // re-index case where the old vector is already at this label.
  const neighbors = embedResult
    ? hnsw.searchKNN(embedResult.embedding, K_NEAREST + 1)
        .filter(r => r.id !== node.id)
        .slice(0, K_NEAREST)
    : []

  const pos = embedResult ? relayouter.projectOne(embedResult.embedding) : null

  const writeAll = db.db.transaction(() => {
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
      starType: existing?.starType ?? null,
      // F4 — pin coefficients are managed via dedicated set/clearPin paths;
      // upsert never overwrites them (the SQL ON CONFLICT clause skips these
      // columns entirely), but we have to satisfy the IndexedFile shape.
      pinAlpha: existing?.pinAlpha ?? null,
      pinBeta: existing?.pinBeta ?? null,
      pinAxisA: existing?.pinAxisA ?? null,
      pinAxisB: existing?.pinAxisB ?? null,
      pinnedAt: existing?.pinnedAt ?? null,
    })

    if (!embedResult) return

    db.deleteEdgesFrom(node.id)
    for (const neighbor of neighbors) {
      const similarity = 1 - neighbor.distance
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

    for (const neighbor of neighbors) {
      const similarity = 1 - neighbor.distance
      if (similarity < ISOLATION_THRESHOLD) continue
      const neighborEdges = db.getEdgesFrom(neighbor.id)
      if (neighborEdges.some(e => e.dstId === node.id)) continue
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

    const neighborClusterIds = neighbors.map(n => db.get(n.id)?.clusterId ?? null)
    db.updateCluster(node.id, pluralityVoteCluster(neighborClusterIds))

    if (pos) db.updatePosition(node.id, pos[0], pos[1], relayouter.currentVersion)
  })

  writeAll()

  if (embedResult) hnsw.addPoint(embedResult.embedding, node.id)
}
