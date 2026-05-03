import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import type { IndexedFile } from '../../src/daemon/db/FileIndex'
import {
  createSnapshot,
  listSnapshots,
  getSnapshot,
  getSnapshotFiles,
  deleteSnapshot,
  pruneOldSnapshots,
} from '../../src/daemon/embedding/snapshots'
import { EMBED_DIM } from '../../src/shared/types'

function deterministicEmbedding(seed: number): Float32Array {
  const v = new Float32Array(EMBED_DIM)
  let s = (seed * 2654435761) >>> 0
  for (let i = 0; i < EMBED_DIM; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    v[i] = (s / 2 ** 32) * 2 - 1
  }
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm
  return v
}

function makeFile(
  id: string,
  path: string,
  embedding: Float32Array | null,
  overrides: Partial<IndexedFile> = {}
): Omit<IndexedFile, 'isStale'> {
  return {
    id,
    path,
    platform: 'local',
    name: id,
    mimeType: 'text/plain',
    category: 'document',
    size: 100,
    createdAt: 1000,
    modifiedAt: 2000,
    embedding,
    contentHash: embedding ? `hash-${id}` : null,
    x: embedding ? 1.5 : null,
    y: embedding ? -2.5 : null,
    z: null,
    clusterId: null,
    galaxyId: null,
    layoutVersion: embedding ? 1 : 0,
    firstSeen: 1000,
    viewCount: 0,
    isPinned: false,
    starType: null,
    pinAlpha: null,
    pinBeta: null,
    pinAxisA: null,
    pinAxisB: null,
    pinnedAt: null,
    osUseCount: null,
    osLastUsed: null,
    importanceScore: null,
    tags: null,
    embeddingStrategy: 'content-only',
    ...overrides,
  }
}

describe('snapshots module', () => {
  let db: FileIndex

  beforeEach(() => {
    db = new FileIndex({ dbPath: ':memory:' })
  })

  afterEach(() => {
    db.close()
  })

  it('createSnapshot captures every embedded file under scope', () => {
    db.upsert(makeFile('a', '/scope/a.txt', deterministicEmbedding(1)))
    db.upsert(makeFile('b', '/scope/sub/b.txt', deterministicEmbedding(2)))
    db.upsert(makeFile('c', '/other/c.txt', deterministicEmbedding(3)))
    db.upsert(makeFile('d', '/scope/d.txt', null))  // no embedding → skipped

    const { snapshotId, capturedFileIds } = createSnapshot(db, {
      strategy: 'metadata-only',
      scopePath: '/scope',
      note: 'experiment 1',
    })

    expect(snapshotId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(capturedFileIds.sort()).toEqual(['a', 'b'])

    const meta = getSnapshot(db, snapshotId)
    expect(meta).not.toBeNull()
    expect(meta!.strategy).toBe('metadata-only')
    expect(meta!.scopePath).toBe('/scope')
    expect(meta!.note).toBe('experiment 1')

    const rows = getSnapshotFiles(db, snapshotId)
    expect(rows).toHaveLength(2)
    const byId = new Map(rows.map(r => [r.fileId, r]))
    expect(byId.get('a')!.embedding[0]).toBeCloseTo(deterministicEmbedding(1)[0], 6)
    expect(byId.get('a')!.contentHash).toBe('hash-a')
    expect(byId.get('a')!.x).toBeCloseTo(1.5)
    expect(byId.get('a')!.y).toBeCloseTo(-2.5)
    expect(byId.get('a')!.layoutVersion).toBe(1)
    expect(byId.get('a')!.priorStrategy).toBe('content-only')
  })

  it('createSnapshot with no scope captures every embedded file', () => {
    db.upsert(makeFile('a', '/x/a.txt', deterministicEmbedding(11)))
    db.upsert(makeFile('b', '/y/b.txt', deterministicEmbedding(22)))
    const { capturedFileIds } = createSnapshot(db, { strategy: 'content-only' })
    expect(capturedFileIds.sort()).toEqual(['a', 'b'])
  })

  it('listSnapshots returns rows in created_at DESC order', async () => {
    db.upsert(makeFile('a', '/scope/a.txt', deterministicEmbedding(1)))
    const first = createSnapshot(db, { strategy: 'content-only', scopePath: '/scope' })
    // Tiny delay so created_at differs (Date.now is ms-resolution).
    await new Promise(r => setTimeout(r, 5))
    const second = createSnapshot(db, { strategy: 'metadata-only', scopePath: '/scope' })

    const list = listSnapshots(db)
    expect(list.map(s => s.snapshotId)).toEqual([second.snapshotId, first.snapshotId])
  })

  it('deleteSnapshot drops both meta and per-file rows', () => {
    db.upsert(makeFile('a', '/scope/a.txt', deterministicEmbedding(1)))
    const { snapshotId } = createSnapshot(db, { strategy: 'content-only', scopePath: '/scope' })
    expect(getSnapshotFiles(db, snapshotId)).toHaveLength(1)

    deleteSnapshot(db, snapshotId)
    expect(getSnapshot(db, snapshotId)).toBeNull()
    expect(getSnapshotFiles(db, snapshotId)).toHaveLength(0)
  })

  it('pruneOldSnapshots keeps the N most recent', async () => {
    db.upsert(makeFile('a', '/scope/a.txt', deterministicEmbedding(1)))
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const { snapshotId } = createSnapshot(db, {
        strategy: 'content-only',
        scopePath: '/scope',
        note: `s${i}`,
      })
      ids.push(snapshotId)
      // Tiny gap so created_at differs.
      await new Promise(r => setTimeout(r, 2))
    }

    pruneOldSnapshots(db, 3)
    const remaining = listSnapshots(db).map(s => s.snapshotId)
    expect(remaining).toHaveLength(3)
    // Newest three survive.
    expect(remaining).toEqual([ids[4], ids[3], ids[2]])
    // Per-file rows for the dropped snapshots are gone too.
    expect(getSnapshotFiles(db, ids[0])).toHaveLength(0)
    expect(getSnapshotFiles(db, ids[1])).toHaveLength(0)
  })

  it('pruneOldSnapshots is a noop when count <= keep', () => {
    db.upsert(makeFile('a', '/scope/a.txt', deterministicEmbedding(1)))
    createSnapshot(db, { strategy: 'content-only', scopePath: '/scope' })
    pruneOldSnapshots(db, 10)
    expect(listSnapshots(db)).toHaveLength(1)
  })

  it('listFilesUnderPath escapes LIKE wildcards', () => {
    // Path with a literal underscore must not match a different sibling whose
    // path differs only by that "wildcard" position.
    db.upsert(makeFile('match', '/foo_dir/keep.txt', deterministicEmbedding(1)))
    db.upsert(makeFile('miss', '/fooXdir/keep.txt', deterministicEmbedding(2)))
    const hits = db.listFilesUnderPath('/foo_dir', { embeddedOnly: true })
    expect(hits.map(f => f.id)).toEqual(['match'])
  })
})
