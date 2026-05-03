// B2 — embedding-experiment snapshot helpers. Pure functions over a FileIndex
// so the daemon endpoints stay thin and the unit tests can exercise capture /
// restore round-trips without spinning up the Express app.
//
// A "snapshot" is a frozen copy of every embedded file's (embedding,
// content_hash, x, y, layout_version, prior_strategy) tuple inside a given
// `scope_path`. The experiment endpoint creates one BEFORE re-embedding the
// scope under a new strategy so revert can restore the prior state byte-for-
// byte. Promote drops the snapshot rows after adopting the new default; revert
// drops them after writing back.
//
// `embedding_snapshots` and `embedding_snapshot_files` were created in B1's
// migration; this module is the only intended writer/reader.

import { randomUUID } from 'crypto'
import type { FileIndex } from '../db/FileIndex'
import type { StrategyId } from './strategies'

export interface Snapshot {
  snapshotId: string
  createdAt: number
  strategy: StrategyId
  scopePath: string | null
  note: string | null
}

export interface SnapshotFileRow {
  snapshotId: string
  fileId: string
  embedding: Float32Array
  contentHash: string | null
  x: number | null
  y: number | null
  layoutVersion: number | null
  priorStrategy: string | null
}

interface SnapshotRow {
  snapshot_id: string
  created_at: number
  strategy: string
  scope_path: string | null
  note: string | null
}

interface SnapshotFileDbRow {
  snapshot_id: string
  file_id: string
  embedding: Buffer
  content_hash: string | null
  x: number | null
  y: number | null
  layout_version: number | null
  prior_strategy: string | null
}

function rowToSnapshot(row: SnapshotRow): Snapshot {
  return {
    snapshotId: row.snapshot_id,
    createdAt: row.created_at,
    strategy: row.strategy as StrategyId,
    scopePath: row.scope_path,
    note: row.note,
  }
}

function rowToFileRow(row: SnapshotFileDbRow): SnapshotFileRow {
  return {
    snapshotId: row.snapshot_id,
    fileId: row.file_id,
    embedding: new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4
    ),
    contentHash: row.content_hash,
    x: row.x,
    y: row.y,
    layoutVersion: row.layout_version,
    priorStrategy: row.prior_strategy,
  }
}

export interface CreateSnapshotOpts {
  strategy: StrategyId
  scopePath?: string | null
  note?: string | null
}

export interface CreateSnapshotResult {
  snapshotId: string
  capturedFileIds: string[]
}

// Create a fresh snapshot covering every file in `scopePath` that currently
// holds an embedding. Returns the new snapshot id + the list of file ids
// captured (caller uses these as the experiment's "affected ids"). The whole
// operation runs in one SQL transaction so a partial write never leaves a
// snapshots row pointing at zero file rows.
//
// A `scopePath` of null/undefined snapshots every embedded file; this is
// intentionally permitted so future "experiment on whole corpus" flows fit
// without API churn. The experiment endpoint requires a non-null scopePath
// of its own (we don't trip on empty here).
export function createSnapshot(
  db: FileIndex,
  opts: CreateSnapshotOpts
): CreateSnapshotResult {
  const snapshotId = randomUUID()
  const createdAt = Date.now()
  const scope = opts.scopePath ?? null
  const note = opts.note ?? null

  const files = scope
    ? db.listFilesUnderPath(scope, { embeddedOnly: true })
    : db.listWithEmbeddings()

  const insertSnapshot = db.db.prepare(
    `INSERT INTO embedding_snapshots (snapshot_id, created_at, strategy, scope_path, note)
     VALUES (?, ?, ?, ?, ?)`
  )
  const insertFile = db.db.prepare(
    `INSERT INTO embedding_snapshot_files
       (snapshot_id, file_id, embedding, content_hash, x, y, layout_version, prior_strategy)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const capturedFileIds: string[] = []
  const tx = db.db.transaction(() => {
    insertSnapshot.run(snapshotId, createdAt, opts.strategy, scope, note)
    for (const f of files) {
      if (!f.embedding) continue  // defensive: embeddedOnly already filtered
      insertFile.run(
        snapshotId,
        f.id,
        Buffer.from(f.embedding.buffer, f.embedding.byteOffset, f.embedding.byteLength),
        f.contentHash,
        f.x,
        f.y,
        f.layoutVersion,
        f.embeddingStrategy
      )
      capturedFileIds.push(f.id)
    }
  })
  tx()
  return { snapshotId, capturedFileIds }
}

export function listSnapshots(db: FileIndex): Snapshot[] {
  const rows = db.db.prepare(
    `SELECT * FROM embedding_snapshots ORDER BY created_at DESC`
  ).all() as SnapshotRow[]
  return rows.map(rowToSnapshot)
}

export function getSnapshot(db: FileIndex, snapshotId: string): Snapshot | null {
  const row = db.db.prepare(
    `SELECT * FROM embedding_snapshots WHERE snapshot_id = ?`
  ).get(snapshotId) as SnapshotRow | undefined
  return row ? rowToSnapshot(row) : null
}

export function getSnapshotFiles(db: FileIndex, snapshotId: string): SnapshotFileRow[] {
  const rows = db.db.prepare(
    `SELECT * FROM embedding_snapshot_files WHERE snapshot_id = ?`
  ).all(snapshotId) as SnapshotFileDbRow[]
  return rows.map(rowToFileRow)
}

// Drop a snapshot + all its file rows. Single transaction so a half-deleted
// snapshot never leaves orphan rows in embedding_snapshot_files.
export function deleteSnapshot(db: FileIndex, snapshotId: string): void {
  const tx = db.db.transaction(() => {
    db.db.prepare(
      `DELETE FROM embedding_snapshot_files WHERE snapshot_id = ?`
    ).run(snapshotId)
    db.db.prepare(
      `DELETE FROM embedding_snapshots WHERE snapshot_id = ?`
    ).run(snapshotId)
  })
  tx()
}

// Keep the N most recent snapshots; drop everything older. Cheap to run after
// every successful experiment so the table stays bounded.
export function pruneOldSnapshots(db: FileIndex, keep = 10): void {
  if (keep < 0) keep = 0
  const stale = db.db.prepare(
    `SELECT snapshot_id FROM embedding_snapshots
     ORDER BY created_at DESC
     LIMIT -1 OFFSET ?`
  ).all(keep) as { snapshot_id: string }[]
  if (stale.length === 0) return
  const tx = db.db.transaction(() => {
    const dropFiles = db.db.prepare(
      `DELETE FROM embedding_snapshot_files WHERE snapshot_id = ?`
    )
    const dropMeta = db.db.prepare(
      `DELETE FROM embedding_snapshots WHERE snapshot_id = ?`
    )
    for (const { snapshot_id } of stale) {
      dropFiles.run(snapshot_id)
      dropMeta.run(snapshot_id)
    }
  })
  tx()
}
