// B2 — embedding experiment orchestration. The Express handlers in index.ts
// stay thin; the actual work (subset re-embed, snapshot capture, promote /
// revert plumbing) lives here so unit tests can exercise the flows without
// importing the daemon entry point (avoids the hnswlib-node teardown SIGSEGV
// caveat documented in CLAUDE.md).
//
// All functions take their dependencies as plain object args — no module-
// level state, no singletons. The daemon wires `db`, `hnsw`, `embedEngine`,
// and `relayouter` through; tests can pass mocks or real in-memory builds.

import { extractContent } from '../index/extractors/text'
import type { FileIndex, IndexedFile } from '../db/FileIndex'
import type { HnswIndex } from '../ann/HnswIndex'
import type { EmbeddingEngine } from './EmbeddingEngine'
import type { Relayouter } from '../layout/Relayouter'
import { SUBSET_PCA_MIN } from '../layout/Relayouter'
import { STRATEGIES, isStrategyId, DEFAULT_STRATEGY } from './strategies'
import type { StrategyId } from './strategies'
import {
  createSnapshot,
  getSnapshot,
  getSnapshotFiles,
  deleteSnapshot,
  pruneOldSnapshots,
  type Snapshot,
} from './snapshots'
import { K_NEAREST, ISOLATION_THRESHOLD } from '../../shared/types'
import type { FileNode } from '../../shared/types'

// Snapshot retention. Tuneable; we keep this conservative because each
// snapshot row holds an EMBED_DIM-float blob per affected file.
export const SNAPSHOT_RETENTION = 10

// Synthetic-version sentinel for experiment positions. The renderer's
// /api/map/positions?since=N delta returns rows with layout_version > since;
// negative versions trivially satisfy that for any non-negative `since`, so
// the deltas reach the renderer. We derive the value from the snapshot id so
// concurrent experiments don't collide on the same number.
//
// Hash is FNV-1a 32-bit, then negated and clamped above -2^31 so SQLite
// stores it as a regular signed integer. Never returns 0 (which would be
// indistinguishable from the legacy "not yet projected" sentinel).
export function syntheticLayoutVersion(snapshotId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < snapshotId.length; i++) {
    h ^= snapshotId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // Map into [1, 2^31 - 1] then negate so we always return a negative int32.
  const positive = (h >>> 0) % 0x7fffffff
  const v = -(positive || 1)
  return v
}

export interface EmbedFileForExperimentDeps {
  db: FileIndex
  hnsw: HnswIndex
  embedEngine: EmbeddingEngine
}

// Re-embed one file under `strategy` with the same write ordering as
// Insert.insertOne — KNN search uses the existing index BEFORE the SQL tx,
// then `hnsw.addPoint` runs AFTER commit so a tx rollback never leaves an
// HNSW orphan. Skips the file when the strategy declines it (e.g. content-
// only on a never-embedded media file). Returns true when the file was
// re-embedded, false otherwise.
//
// Reads file bytes from disk via fs.readFile (capped at VIEW_BYTES so the
// in-process embed prompt stays bounded). The walker would carry usage
// metadata, but for an experiment re-embed we leave os_use_count /
// os_last_used / importance_score untouched.
async function embedFileForExperiment(
  file: IndexedFile,
  strategy: StrategyId,
  deps: EmbedFileForExperimentDeps
): Promise<boolean> {
  const { db, hnsw, embedEngine } = deps

  // Read file content. Media files contribute zero-byte buffers so strategies
  // that look at content (content-only, sampled-stats) decline; metadata-only
  // still works on a media file.
  let content: Buffer
  if (file.category === 'media') {
    content = Buffer.alloc(0)
  } else {
    try {
      content = await extractContent(file.path, file.category)
    } catch {
      // File deleted out from under us; nothing to re-embed.
      return false
    }
  }

  const node: FileNode = {
    id: file.id,
    name: file.name,
    path: file.path,
    platform: file.platform,
    mimeType: file.mimeType,
    category: file.category,
    size: file.size,
    createdAt: file.createdAt,
    modifiedAt: file.modifiedAt,
  }

  const tags = file.tags
  const result = await embedEngine.embedFile(node, content, strategy, tags)
  if (!result) return false

  // Replicate Insert.insertOne's ordering: HNSW search BEFORE tx, addPoint
  // AFTER commit so a tx rollback can never leave an HNSW orphan.
  const neighbors = hnsw
    .searchKNN(result.embedding, K_NEAREST + 1)
    .filter(r => r.id !== file.id)
    .slice(0, K_NEAREST)

  const writeAll = db.db.transaction(() => {
    db.updateEmbedding(file.id, result.embedding, result.contentHash, result.strategy)

    db.deleteEdgesFrom(file.id)
    const now = Date.now()
    for (const neighbor of neighbors) {
      const sim = 1 - neighbor.distance
      if (sim < ISOLATION_THRESHOLD) continue
      db.upsertEdge({
        srcId: file.id,
        dstId: neighbor.id,
        weight: Math.max(0, Math.min(1, sim)),
        engine: 'embedding',
        computedAt: now,
      })
    }
    db.pruneEdgesFrom(file.id, K_NEAREST)
  })
  writeAll()

  hnsw.addPoint(result.embedding, file.id)
  return true
}

export interface RunExperimentDeps extends EmbedFileForExperimentDeps {
  relayouter: Relayouter
}

export interface RunExperimentOpts {
  scopePath: string
  strategy: StrategyId
  note?: string
}

export type RunExperimentError =
  | { code: 'invalid-strategy'; message: string }
  | { code: 'too-few-files'; message: string; count: number }
  | { code: 'subset-pca-failed'; message: string }

export interface RunExperimentResult {
  ok: true
  snapshotId: string
  affectedIds: string[]
}

// Drive a full experiment end-to-end: filter files, snapshot, re-embed each
// one, fit subset PCA, write experimental positions. Pure async function —
// returns either { ok: true, ... } or a typed error so the Express handler
// just maps codes to HTTP statuses.
export async function runExperiment(
  deps: RunExperimentDeps,
  opts: RunExperimentOpts
): Promise<RunExperimentResult | RunExperimentError> {
  const { db, relayouter } = deps
  if (!isStrategyId(opts.strategy)) {
    return { code: 'invalid-strategy', message: `unknown strategy '${opts.strategy}'` }
  }

  const files = db.listFilesUnderPath(opts.scopePath, { embeddedOnly: true })
  if (files.length < SUBSET_PCA_MIN) {
    return {
      code: 'too-few-files',
      message: `scope contains ${files.length} embedded files; need at least ${SUBSET_PCA_MIN}`,
      count: files.length,
    }
  }

  // Snapshot first so a mid-experiment crash leaves a recoverable record.
  const { snapshotId, capturedFileIds } = createSnapshot(db, {
    strategy: opts.strategy,
    scopePath: opts.scopePath,
    note: opts.note ?? null,
  })

  // Re-embed each file in a stable order. Failures (e.g. file deleted on
  // disk) are tolerated — we just don't count that id as affected.
  const affectedIds: string[] = []
  for (const file of files) {
    if (!capturedFileIds.includes(file.id)) continue
    try {
      const ok = await embedFileForExperiment(file, opts.strategy, deps)
      if (ok) affectedIds.push(file.id)
    } catch (err) {
      // Per-file error logged but the loop continues; a single embedder hiccup
      // shouldn't sink an entire experiment.
      console.warn(`[experiment] re-embed failed for ${file.id}: ${String(err)}`)
    }
  }

  if (affectedIds.length < SUBSET_PCA_MIN) {
    // Too many failures during re-embed — roll back.
    deleteSnapshot(db, snapshotId)
    return {
      code: 'subset-pca-failed',
      message: `only ${affectedIds.length} files survived re-embed; need ${SUBSET_PCA_MIN}`,
    }
  }

  const positions = relayouter.trainSubset(affectedIds)
  if (!positions) {
    deleteSnapshot(db, snapshotId)
    return {
      code: 'subset-pca-failed',
      message: 'subset PCA returned null',
    }
  }

  const layoutVersion = syntheticLayoutVersion(snapshotId)
  const writePositions = db.db.transaction(() => {
    for (const [id, [x, y]] of positions) {
      db.updatePosition(id, x, y, layoutVersion)
    }
  })
  writePositions()

  // Keep the snapshot table bounded.
  pruneOldSnapshots(db, SNAPSHOT_RETENTION)

  return { ok: true, snapshotId, affectedIds }
}

export interface ExperimentPosition {
  id: string
  x: number
  y: number
}

export type ExperimentPositionsError = { code: 'not-found' }

// Fetch the (id, x, y) tuples for a previously-run experiment. Reads the
// snapshot's file_id list, then queries CURRENT files.x/y (which runExperiment
// wrote with the synthetic version). Files deleted since the experiment ran
// or stripped of their position by some later flow are skipped.
export function getExperimentPositions(
  db: FileIndex,
  snapshotId: string
): ExperimentPosition[] | ExperimentPositionsError {
  const snap = getSnapshot(db, snapshotId)
  if (!snap) return { code: 'not-found' }

  const rows = getSnapshotFiles(db, snapshotId)
  const out: ExperimentPosition[] = []
  for (const r of rows) {
    const file = db.get(r.fileId)
    if (!file || file.x === null || file.y === null) continue
    out.push({ id: file.id, x: file.x, y: file.y })
  }
  return out
}

export interface PromoteExperimentResult {
  ok: true
  snapshot: Snapshot
}

export type PromoteExperimentError = { code: 'not-found' }

// Adopt the experiment's strategy as the new app default + drop the snapshot
// rows. Background re-embed of the rest of the corpus is kicked off by the
// caller (Express layer) so this function stays sync-ish + free of progress
// plumbing. Returns the snapshot meta so the caller can reference its
// strategy when scheduling that re-embed.
export function promoteExperiment(
  db: FileIndex,
  snapshotId: string
): PromoteExperimentResult | PromoteExperimentError {
  const snap = getSnapshot(db, snapshotId)
  if (!snap) return { code: 'not-found' }
  db.setDefaultStrategy(snap.strategy)
  deleteSnapshot(db, snapshotId)
  return { ok: true, snapshot: snap }
}

export interface RevertExperimentDeps {
  db: FileIndex
  hnsw: HnswIndex
  relayouter: Relayouter
}

export interface RevertExperimentResult {
  ok: true
  restoredCount: number
  skippedCount: number
}

export type RevertExperimentError = { code: 'not-found' }

// Restore each snapshot row's (embedding, content_hash, prior_strategy, x, y,
// layout_version) tuple back onto the files table, re-add the restored
// embedding into HNSW (the index supports addPoint at an existing label —
// see HnswIndex.addPoint), then optionally re-train the global PCA so the
// rest of the corpus's positions stay coherent with the restored vectors.
//
// Files deleted out from under us are skipped (logged, counted) per the plan's
// "Snapshot revert on deleted files" risk callout.
export async function revertExperiment(
  deps: RevertExperimentDeps,
  snapshotId: string,
  opts: { relayout?: boolean } = {}
): Promise<RevertExperimentResult | RevertExperimentError> {
  const { db, hnsw, relayouter } = deps
  const snap = getSnapshot(db, snapshotId)
  if (!snap) return { code: 'not-found' }

  const rows = getSnapshotFiles(db, snapshotId)
  let restored = 0
  let skipped = 0

  const writeAll = db.db.transaction(() => {
    for (const r of rows) {
      const live = db.get(r.fileId)
      if (!live) {
        // File deleted since snapshot — nothing to restore against. Skip
        // with a warn; the snapshot row itself goes away when we drop the
        // snapshot at the end of this function.
        console.warn(`[experiment] revert skipping deleted file ${r.fileId}`)
        skipped++
        continue
      }
      db.updateEmbedding(r.fileId, r.embedding, r.contentHash ?? '', r.priorStrategy)
      if (r.x !== null && r.y !== null && r.layoutVersion !== null) {
        db.updatePosition(r.fileId, r.x, r.y, r.layoutVersion)
      }
      restored++
    }
  })
  writeAll()

  // Re-add restored embeddings into HNSW (label re-use is intentional —
  // hnswlib marks the old vector and stores the restored one at the same
  // label so future searches return the restored vector).
  for (const r of rows) {
    const live = db.get(r.fileId)
    if (!live) continue
    hnsw.addPoint(r.embedding, r.fileId)
  }

  // Optional global re-layout. Default ON so the rest of the corpus's
  // positions stay coherent with the restored vectors; the caller can flip
  // it off via ?relayout=false when batching multiple reverts.
  const shouldRelayout = opts.relayout !== false
  if (shouldRelayout && relayouter.isReady) {
    try {
      await relayouter.trainAsync()
    } catch (err) {
      console.warn(`[experiment] post-revert relayout failed: ${String(err)}`)
    }
  }

  deleteSnapshot(db, snapshotId)
  return { ok: true, restoredCount: restored, skippedCount: skipped }
}

export interface ReindexFileDeps {
  db: FileIndex
  hnsw: HnswIndex
  embedEngine: EmbeddingEngine
}

export type ReindexFileError = { code: 'not-found' } | { code: 'read-failed'; message: string }

export interface ReindexFileResult {
  ok: true
  embedded: boolean
}

// One-off re-index of a single file under the CURRENT default strategy.
// Used by `POST /api/file/:id/reindex`. Same write ordering as
// embedFileForExperiment; we just resolve the strategy from app_settings
// instead of taking it as an argument.
export async function reindexFile(
  deps: ReindexFileDeps,
  fileId: string
): Promise<ReindexFileResult | ReindexFileError> {
  const file = deps.db.get(fileId)
  if (!file) return { code: 'not-found' }

  const rawStrategy = deps.db.getDefaultStrategy()
  const strategy: StrategyId = isStrategyId(rawStrategy) ? rawStrategy : DEFAULT_STRATEGY

  // Read content. Media files send a zero-length buffer; declines on the
  // strategy still surface as embedded:false rather than an error.
  let content: Buffer
  if (file.category === 'media') {
    content = Buffer.alloc(0)
  } else {
    try {
      content = await extractContent(file.path, file.category)
    } catch (err) {
      return { code: 'read-failed', message: String(err) }
    }
  }

  const node: FileNode = {
    id: file.id,
    name: file.name,
    path: file.path,
    platform: file.platform,
    mimeType: file.mimeType,
    category: file.category,
    size: file.size,
    createdAt: file.createdAt,
    modifiedAt: file.modifiedAt,
  }

  // Use STRATEGIES directly + embed() so we keep the contract-hash invariant.
  const prompt = STRATEGIES[strategy].build({ node, content, tags: file.tags })
  if (!prompt || !prompt.trim()) {
    return { ok: true, embedded: false }
  }

  const result = await deps.embedEngine.embed(prompt)
  // Replicate Insert.insertOne ordering: search BEFORE tx, addPoint AFTER.
  const neighbors = deps.hnsw
    .searchKNN(result.embedding, K_NEAREST + 1)
    .filter(r => r.id !== file.id)
    .slice(0, K_NEAREST)

  const writeAll = deps.db.db.transaction(() => {
    deps.db.updateEmbedding(file.id, result.embedding, result.contentHash, strategy)
    deps.db.deleteEdgesFrom(file.id)
    const now = Date.now()
    for (const neighbor of neighbors) {
      const sim = 1 - neighbor.distance
      if (sim < ISOLATION_THRESHOLD) continue
      deps.db.upsertEdge({
        srcId: file.id,
        dstId: neighbor.id,
        weight: Math.max(0, Math.min(1, sim)),
        engine: 'embedding',
        computedAt: now,
      })
    }
    deps.db.pruneEdgesFrom(file.id, K_NEAREST)
  })
  writeAll()

  deps.hnsw.addPoint(result.embedding, file.id)
  return { ok: true, embedded: true }
}

export interface PromoteRebackgroundDeps extends EmbedFileForExperimentDeps {
  // Files that should NOT be touched by the post-promote sweep — typically
  // the experiment's affected ids (already embedded under the new strategy).
  excludeIds: ReadonlySet<string>
  newStrategy: StrategyId
}

// Re-embed every file whose current embedding_strategy differs from
// `newStrategy` and whose id isn't in `excludeIds`. Sequential; the daemon
// invokes this from a detached `void promote...()` so the response returns
// immediately.
//
// Returns counts so the caller can surface them on the eventual progress
// frame — the Express layer wraps this in a progressStore job (see
// promoteExperiment endpoint in index.ts).
export async function reembedRestOfCorpus(
  deps: PromoteRebackgroundDeps,
  reporter?: { tick(payload: { processed: number; total: number; currentId: string }): void }
): Promise<{ processed: number; total: number; errors: number }> {
  const { db } = deps
  const all = db.listWithEmbeddings()
  const targets = all.filter(f =>
    !deps.excludeIds.has(f.id) && f.embeddingStrategy !== deps.newStrategy
  )
  let processed = 0
  let errors = 0
  for (const file of targets) {
    try {
      await embedFileForExperiment(file, deps.newStrategy, deps)
    } catch (err) {
      errors++
      console.warn(`[experiment] post-promote re-embed failed for ${file.id}: ${String(err)}`)
    }
    processed++
    reporter?.tick({ processed, total: targets.length, currentId: file.id })
  }
  return { processed, total: targets.length, errors }
}
