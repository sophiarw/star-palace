// Tests cover the experiment helper module directly (NOT the Express app)
// to avoid the hnswlib-node teardown SIGSEGV documented in CLAUDE.md and
// vitest.config.ts. The endpoint handlers in src/daemon/index.ts are thin
// wrappers around runExperiment / promoteExperiment / revertExperiment /
// reindexFile, so exercising the helpers covers the actual flow.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import type { IndexedFile } from '../../src/daemon/db/FileIndex'
import { HnswIndex } from '../../src/daemon/ann/HnswIndex'
import { OllamaClient } from '../../src/daemon/embedding/OllamaClient'
import { EmbeddingEngine } from '../../src/daemon/embedding/EmbeddingEngine'
import { Relayouter } from '../../src/daemon/layout/Relayouter'
import {
  runExperiment,
  getExperimentPositions,
  promoteExperiment,
  revertExperiment,
  reindexFile,
  reembedRestOfCorpus,
  syntheticLayoutVersion,
  SNAPSHOT_RETENTION,
} from '../../src/daemon/embedding/experiments'
import {
  listSnapshots,
  getSnapshot,
  getSnapshotFiles,
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

interface Harness {
  db: FileIndex
  hnsw: HnswIndex
  embedEngine: EmbeddingEngine
  relayouter: Relayouter
  scopeDir: string
}

function makeHarness(): Harness {
  // Stub fetch (Ollama HTTP) BEFORE building the embed engine so any
  // accidental real network call surfaces as a vitest assertion failure
  // rather than a long timeout.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string) as { prompt: string }
    let h = 0x811c9dc5
    for (let i = 0; i < body.prompt.length; i++) {
      h ^= body.prompt.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    const seed = h >>> 0
    return {
      ok: true,
      json: async () => ({ embedding: Array.from(deterministicEmbedding(seed)) }),
    } as Response
  }))

  const db = new FileIndex({ dbPath: ':memory:' })
  const hnsw = new HnswIndex({ dim: EMBED_DIM })
  const embedEngine = new EmbeddingEngine(new OllamaClient())
  const relayouter = new Relayouter(db)

  // Make a real on-disk scope so embedFileForExperiment's fs.readFile works.
  const scopeDir = mkdtempSync(join(tmpdir(), 'sp-experiment-'))
  return { db, hnsw, embedEngine, relayouter, scopeDir }
}

function seedScope(h: Harness, count: number, prefix = 'f'): string[] {
  const ids: string[] = []
  mkdirSync(h.scopeDir, { recursive: true })
  for (let i = 0; i < count; i++) {
    const id = `${prefix}${i}`
    const path = join(h.scopeDir, `${id}.txt`)
    writeFileSync(path, `content for file ${id}\n`.repeat(10))
    const emb = deterministicEmbedding(i)
    h.db.upsert(makeFile(id, path, emb))
    h.hnsw.addPoint(emb, id)
    ids.push(id)
  }
  return ids
}

describe('runExperiment', () => {
  let h: Harness

  beforeEach(() => {
    h = makeHarness()
  })

  afterEach(() => {
    h.db.close()
    rmSync(h.scopeDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('returns too-few-files when scope has fewer than 10 embedded files', async () => {
    seedScope(h, 5)
    const result = await runExperiment(h, {
      scopePath: h.scopeDir,
      strategy: 'metadata-only',
    })
    expect('code' in result).toBe(true)
    if ('code' in result && result.code === 'too-few-files') {
      expect(result.count).toBe(5)
    } else {
      throw new Error(`expected too-few-files, got ${JSON.stringify(result)}`)
    }
  })

  it('happy path: snapshots, re-embeds, returns affectedIds + positions', async () => {
    const ids = seedScope(h, 12)
    const result = await runExperiment(h, {
      scopePath: h.scopeDir,
      strategy: 'metadata-only',
      note: 'sweep 1',
    })
    expect('ok' in result).toBe(true)
    if (!('ok' in result)) return  // narrow

    expect(result.affectedIds.sort()).toEqual([...ids].sort())

    // Snapshot was persisted with prior strategy captured.
    const snap = getSnapshot(h.db, result.snapshotId)
    expect(snap).not.toBeNull()
    expect(snap!.strategy).toBe('metadata-only')
    expect(snap!.scopePath).toBe(h.scopeDir)
    expect(snap!.note).toBe('sweep 1')
    const captured = getSnapshotFiles(h.db, result.snapshotId)
    expect(captured).toHaveLength(ids.length)
    for (const row of captured) {
      expect(row.priorStrategy).toBe('content-only')
      // Embedding bytes equal the pre-experiment vector.
      const seed = Number(row.fileId.replace('f', ''))
      const expected = deterministicEmbedding(seed)
      expect(row.embedding[0]).toBeCloseTo(expected[0], 6)
    }

    // Files now carry the new strategy + an experimental position.
    const expectedVersion = syntheticLayoutVersion(result.snapshotId)
    expect(expectedVersion).toBeLessThan(0)
    for (const id of ids) {
      const live = h.db.get(id)
      expect(live).not.toBeNull()
      expect(live!.embeddingStrategy).toBe('metadata-only')
      expect(live!.x).not.toBeNull()
      expect(live!.y).not.toBeNull()
      expect(live!.layoutVersion).toBe(expectedVersion)
    }

    // getExperimentPositions returns one row per affected id with current x/y.
    const positions = getExperimentPositions(h.db, result.snapshotId)
    expect(Array.isArray(positions)).toBe(true)
    if (Array.isArray(positions)) {
      expect(positions.length).toBe(ids.length)
      for (const p of positions) {
        expect(typeof p.x).toBe('number')
        expect(typeof p.y).toBe('number')
        expect(Number.isFinite(p.x)).toBe(true)
        expect(Number.isFinite(p.y)).toBe(true)
      }
    }
  })

  it('rejects an invalid strategy id', async () => {
    seedScope(h, 12)
    const result = await runExperiment(h, {
      scopePath: h.scopeDir,
      strategy: 'no-such-strategy' as never,
    })
    expect('code' in result).toBe(true)
    if ('code' in result) expect(result.code).toBe('invalid-strategy')
  })
})

describe('promoteExperiment', () => {
  let h: Harness

  beforeEach(() => { h = makeHarness() })

  afterEach(() => {
    h.db.close()
    rmSync(h.scopeDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('updates default strategy + drops the snapshot', async () => {
    seedScope(h, 12)
    const exp = await runExperiment(h, {
      scopePath: h.scopeDir,
      strategy: 'metadata-only',
    })
    if (!('ok' in exp)) throw new Error('experiment did not succeed')

    expect(h.db.getDefaultStrategy()).toBe('content-only')
    const result = promoteExperiment(h.db, exp.snapshotId)
    expect('ok' in result).toBe(true)
    if (!('ok' in result)) return

    expect(h.db.getDefaultStrategy()).toBe('metadata-only')
    expect(getSnapshot(h.db, exp.snapshotId)).toBeNull()
  })

  it('returns not-found for an unknown snapshot id', async () => {
    const r = promoteExperiment(h.db, 'no-such-id')
    expect('code' in r).toBe(true)
    if ('code' in r) expect(r.code).toBe('not-found')
  })

  it('reembedRestOfCorpus skips ids in excludeIds and ids already at new strategy', async () => {
    const ids = seedScope(h, 12)
    // Pretend half the corpus was already embedded under metadata-only.
    for (let i = 0; i < 6; i++) {
      const f = h.db.get(ids[i])!
      h.db.updateEmbedding(f.id, f.embedding!, f.contentHash!, 'metadata-only')
    }
    const excludeIds = new Set([ids[6]])  // also exclude one explicitly
    const out = await reembedRestOfCorpus({
      db: h.db,
      hnsw: h.hnsw,
      embedEngine: h.embedEngine,
      excludeIds,
      newStrategy: 'metadata-only',
    })
    // 12 total - 6 already there - 1 excluded = 5 to process.
    expect(out.total).toBe(5)
    expect(out.processed).toBe(5)
    expect(out.errors).toBe(0)
  })
})

describe('revertExperiment', () => {
  let h: Harness

  beforeEach(() => { h = makeHarness() })

  afterEach(() => {
    h.db.close()
    rmSync(h.scopeDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('restores embeddings, content_hash, prior strategy, and positions', async () => {
    const ids = seedScope(h, 12)
    // Capture pre-experiment state for one id.
    const sample = ids[3]
    const pre = h.db.get(sample)!
    expect(pre.embeddingStrategy).toBe('content-only')
    const preEmbed0 = pre.embedding![0]
    const preX = pre.x
    const preY = pre.y
    const preVersion = pre.layoutVersion

    const exp = await runExperiment(h, {
      scopePath: h.scopeDir,
      strategy: 'metadata-only',
    })
    if (!('ok' in exp)) throw new Error('experiment did not succeed')

    // Mid-state assertion: file is now at the experiment strategy.
    const mid = h.db.get(sample)!
    expect(mid.embeddingStrategy).toBe('metadata-only')
    expect(mid.embedding![0]).not.toBeCloseTo(preEmbed0, 6)

    const r = await revertExperiment(
      { db: h.db, hnsw: h.hnsw, relayouter: h.relayouter },
      exp.snapshotId,
      { relayout: false }
    )
    expect('ok' in r).toBe(true)
    if (!('ok' in r)) return
    expect(r.restoredCount).toBe(ids.length)
    expect(r.skippedCount).toBe(0)

    const post = h.db.get(sample)!
    expect(post.embeddingStrategy).toBe('content-only')
    expect(post.embedding![0]).toBeCloseTo(preEmbed0, 6)
    expect(post.x).toBeCloseTo(preX!, 6)
    expect(post.y).toBeCloseTo(preY!, 6)
    expect(post.layoutVersion).toBe(preVersion)

    expect(getSnapshot(h.db, exp.snapshotId)).toBeNull()
  })

  it('skips deleted files and reports the count', async () => {
    const ids = seedScope(h, 12)
    const exp = await runExperiment(h, {
      scopePath: h.scopeDir,
      strategy: 'metadata-only',
    })
    if (!('ok' in exp)) throw new Error('experiment did not succeed')

    // Delete one file out of band — simulates the user removing a row
    // between experiment + revert.
    h.db.delete(ids[0])

    const r = await revertExperiment(
      { db: h.db, hnsw: h.hnsw, relayouter: h.relayouter },
      exp.snapshotId,
      { relayout: false }
    )
    expect('ok' in r).toBe(true)
    if (!('ok' in r)) return
    expect(r.restoredCount).toBe(ids.length - 1)
    expect(r.skippedCount).toBe(1)
  })

  it('returns not-found for an unknown snapshot id', async () => {
    const r = await revertExperiment(
      { db: h.db, hnsw: h.hnsw, relayouter: h.relayouter },
      'no-such-id'
    )
    expect('code' in r).toBe(true)
    if ('code' in r) expect(r.code).toBe('not-found')
  })
})

describe('snapshot retention', () => {
  let h: Harness

  beforeEach(() => { h = makeHarness() })

  afterEach(() => {
    h.db.close()
    rmSync(h.scopeDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('runExperiment auto-prunes to SNAPSHOT_RETENTION', async () => {
    // Run more experiments than retention, each on a distinct corpus so the
    // re-embed loop actually does work. We reuse the same scope dir + ids
    // because the helper handles re-embed-in-place.
    seedScope(h, 12)
    for (let i = 0; i < SNAPSHOT_RETENTION + 3; i++) {
      const r = await runExperiment(h, {
        scopePath: h.scopeDir,
        strategy: i % 2 === 0 ? 'metadata-only' : 'content-only',
        note: `run-${i}`,
      })
      expect('ok' in r).toBe(true)
    }
    const all = listSnapshots(h.db)
    expect(all.length).toBe(SNAPSHOT_RETENTION)
  })
})

describe('reindexFile', () => {
  let h: Harness

  beforeEach(() => { h = makeHarness() })

  afterEach(() => {
    h.db.close()
    rmSync(h.scopeDir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  it('returns not-found for an unknown id', async () => {
    const r = await reindexFile({ db: h.db, hnsw: h.hnsw, embedEngine: h.embedEngine }, 'nope')
    expect('code' in r).toBe(true)
    if ('code' in r) expect(r.code).toBe('not-found')
  })

  it('re-embeds the file under the current default strategy', async () => {
    const ids = seedScope(h, 1)
    const sample = ids[0]
    h.db.setDefaultStrategy('metadata-only')
    const r = await reindexFile({ db: h.db, hnsw: h.hnsw, embedEngine: h.embedEngine }, sample)
    expect('ok' in r).toBe(true)
    if (!('ok' in r)) return
    expect(r.embedded).toBe(true)
    const live = h.db.get(sample)!
    expect(live.embeddingStrategy).toBe('metadata-only')
  })
})
