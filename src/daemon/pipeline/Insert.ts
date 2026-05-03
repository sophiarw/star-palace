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
import type { UsageMetadata } from '../index/usageMetadata'
import { computeImportanceScore } from './importanceScore'

// F17 — minimum gap between progress emits. Walker tries to fire after every
// file but coalesces events that land inside the same 100 ms window so a
// 1500-file index doesn't flood the SSE channel. The final-frame emit on
// completion bypasses this.
const PROGRESS_THROTTLE_MS = 100

// F17 — pluggable progress reporter. Pipeline-side stays unaware of SSE /
// transport so unit tests can pass a no-op reporter (or capture calls) and
// the daemon can wire the live progressStore through `index.ts`.
export interface ProgressReporter {
  // Per-file tick. Pipeline emits with the latest counters and the path it's
  // currently working on; reporter decides whether to forward to subscribers.
  tick(payload: {
    scanned: number
    indexed: number
    skipped: number
    errors: number
    currentPath: string
  }): void
  // Cooperative cancel check. Returning true tells the walker to stop after
  // the current file commits (no in-flight rollback).
  shouldCancel(): boolean
}

export interface InsertPipelineOptions {
  db: FileIndex
  hnsw: HnswIndex
  embedEngine: EmbeddingEngine
  relayouter: Relayouter
  walkOpts?: WalkOptions
  // F9: when set, every file inserted by this run is assigned to this galaxy
  // and its file ID is salted with the galaxy id (see fileIdFromPath).
  galaxyId?: number
  // F17: optional progress hook. Unset for legacy callers (CLI script + tests
  // that just want stats). When set, pipeline calls `tick()` per file and
  // honors `shouldCancel()` for early termination.
  progress?: ProgressReporter
}

export async function indexPath(
  rootPath: string,
  opts: InsertPipelineOptions
): Promise<WalkStats> {
  const { db, hnsw, embedEngine, relayouter, galaxyId, progress } = opts
  const start = Date.now()
  const stats: WalkStats = { scanned: 0, indexed: 0, skipped: 0, errors: 0, durationMs: 0 }

  // Thread galaxyId into both the walker (so file IDs are scoped) and the
  // per-file insertOne call (so the row gets galaxy_id).
  const walkOpts: WalkOptions = {
    ...opts.walkOpts,
    galaxyScope: galaxyId ?? opts.walkOpts?.galaxyScope,
  }
  const walker = await walkDirectory(rootPath, walkOpts)

  // F17 — local throttle wrapper. Reporter still runs on every walker step
  // (so cancel checks are responsive) but `tick()` is debounced to ~10 Hz.
  let lastEmitAt = 0
  function maybeEmit(currentPath: string, force = false): void {
    if (!progress) return
    const now = Date.now()
    if (!force && now - lastEmitAt < PROGRESS_THROTTLE_MS) return
    lastEmitAt = now
    progress.tick({
      scanned: stats.scanned,
      indexed: stats.indexed,
      skipped: stats.skipped,
      errors: stats.errors,
      currentPath,
    })
  }

  for await (const { node, content, usage } of walker) {
    if (progress?.shouldCancel()) break
    stats.scanned++
    try {
      await insertOne(node, content, { db, hnsw, embedEngine, relayouter, galaxyId, usage })
      stats.indexed++
    } catch (err) {
      stats.errors++
      console.error(`Error indexing ${node.path}:`, err)
    }
    maybeEmit(node.path)
  }

  // Check if this batch crossed the layout threshold for the first time
  relayouter.maybeTrainFirst()

  stats.durationMs = Date.now() - start
  return stats
}

export async function insertOne(
  node: FileNode,
  content: Buffer,
  opts: Pick<InsertPipelineOptions, 'db' | 'hnsw' | 'embedEngine' | 'relayouter' | 'galaxyId'> & {
    // F10 — usage signals from the walker. Optional so direct insertOne()
    // callers (tests, single-file API endpoints) can omit them; commit 4
    // computes importance_score from this payload.
    usage?: UsageMetadata
  }
): Promise<void> {
  const { db, hnsw, embedEngine, relayouter, galaxyId, usage } = opts
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

  const pos = embedResult ? relayouter.projectOne(embedResult.embedding, node.id) : null

  // F10 — resolve the usage signals once outside the tx so the same values
  // feed both the upsert columns and the importance-score computation.
  // Carry-forward when the walker didn't provide any (direct insertOne()
  // callers like single-file API endpoints) so a re-index doesn't wipe a
  // previously-recorded signal. Use ?? not || so 0 is preserved.
  const effectiveOsUseCount = usage?.osUseCount ?? existing?.osUseCount ?? null
  const effectiveOsLastUsed = usage?.osLastUsed ?? existing?.osLastUsed ?? null

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
      // F9: prefer the explicit per-insert galaxy. Fall back to whatever the
      // row already had (re-index path) so we never silently shift a star to
      // a different galaxy by passing through a null.
      galaxyId: galaxyId ?? existing?.galaxyId ?? null,
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
      // F10 — usage signals from the walker (Spotlight on macOS, atime
      // elsewhere). When the caller didn't provide any (e.g. test paths
      // that build a node by hand), carry forward whatever the existing
      // row had so a re-index doesn't wipe a previously-recorded signal.
      osUseCount: effectiveOsUseCount,
      osLastUsed: effectiveOsLastUsed,
      // F10 — denormalised composite. Recomputed every walker pass (cheap;
      // no embed call) so percentile buckets in the renderer stay current.
      // Cloud-platform stars with no Spotlight + no atime degenerate to
      // viewCount alone.
      importanceScore: computeImportanceScore({
        viewCount: existing?.viewCount ?? 0,
        osUseCount: effectiveOsUseCount,
        osLastUsed: effectiveOsLastUsed,
        now,
      }),
      // B1 — pure preservation in commit 2. Insert never mutates these (the
      // ON CONFLICT clause COALESCEs NULL into whatever the row already has),
      // and commit 4 will replace the literal nulls with the values that
      // actually drove the embed call.
      tags: existing?.tags ?? null,
      embeddingStrategy: existing?.embeddingStrategy ?? null,
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
