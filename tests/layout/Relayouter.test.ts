import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import type { IndexedFile } from '../../src/daemon/db/FileIndex'
import { Relayouter, SUBSET_PCA_MIN } from '../../src/daemon/layout/Relayouter'
import { EMBED_DIM } from '../../src/shared/types'

function deterministicEmbedding(seed: number): Float32Array {
  // Cheap deterministic vector, then L2-normalised — matches the contract
  // EmbeddingEngine enforces for HNSW's inner-product space.
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

function makeFile(id: string, embedding: Float32Array): Omit<IndexedFile, 'isStale'> {
  return {
    id,
    path: `/tmp/${id}.txt`,
    platform: 'local',
    name: `${id}.txt`,
    mimeType: 'text/plain',
    category: 'document',
    size: 100,
    createdAt: 1000,
    modifiedAt: 2000,
    embedding,
    contentHash: id,
    x: null,
    y: null,
    z: null,
    clusterId: null,
    galaxyId: null,
    layoutVersion: 0,
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
    embeddingStrategy: null,
  }
}

describe('Relayouter.trainSubset', () => {
  let db: FileIndex
  let relayouter: Relayouter

  beforeEach(() => {
    db = new FileIndex({ dbPath: ':memory:' })
    relayouter = new Relayouter(db)
  })

  afterEach(() => {
    db.close()
  })

  it('returns null when subset is below SUBSET_PCA_MIN', () => {
    for (let i = 0; i < SUBSET_PCA_MIN - 1; i++) {
      db.upsert(makeFile(`f${i}`, deterministicEmbedding(i)))
    }
    const ids = Array.from({ length: SUBSET_PCA_MIN - 1 }, (_, i) => `f${i}`)
    expect(relayouter.trainSubset(ids)).toBeNull()
  })

  it('produces non-degenerate (x, y) for every input id', () => {
    const N = SUBSET_PCA_MIN + 5
    for (let i = 0; i < N; i++) {
      db.upsert(makeFile(`f${i}`, deterministicEmbedding(i)))
    }
    const ids = Array.from({ length: N }, (_, i) => `f${i}`)
    const out = relayouter.trainSubset(ids)
    expect(out).not.toBeNull()
    expect(out!.size).toBe(N)
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const id of ids) {
      const pos = out!.get(id)
      expect(pos).toBeDefined()
      expect(Number.isFinite(pos![0])).toBe(true)
      expect(Number.isFinite(pos![1])).toBe(true)
      if (pos![0] < xMin) xMin = pos![0]
      if (pos![0] > xMax) xMax = pos![0]
      if (pos![1] < yMin) yMin = pos![1]
      if (pos![1] > yMax) yMax = pos![1]
    }
    // Non-degenerate: span of x AND span of y both > 0 (jitter alone would
    // give a tiny spread, real PCA over different vectors gives much more).
    expect(xMax - xMin).toBeGreaterThan(1)
    expect(yMax - yMin).toBeGreaterThan(1)
    // And bounded by the [-500, 500] scale window used by scalePositions(1000).
    expect(xMin).toBeGreaterThanOrEqual(-510)
    expect(xMax).toBeLessThanOrEqual(510)
    expect(yMin).toBeGreaterThanOrEqual(-510)
    expect(yMax).toBeLessThanOrEqual(510)
  })

  it('does not mutate the global PCA model or layout_version', () => {
    // Seed the corpus so train() can run, and capture the post-train state.
    const N = 30
    for (let i = 0; i < N; i++) {
      db.upsert(makeFile(`g${i}`, deterministicEmbedding(i + 1000)))
    }
    // Force a global train (LAYOUT_THRESHOLD is 200; we side-step by calling
    // train() directly which checks against the live count).
    // Drop in extra rows to clear the threshold cleanly.
    for (let i = 0; i < 200; i++) {
      db.upsert(makeFile(`pad${i}`, deterministicEmbedding(i + 9000)))
    }
    relayouter.train()
    const versionBefore = relayouter.currentVersion
    const modelBefore = relayouter.getModel()
    expect(modelBefore).not.toBeNull()

    const subsetIds = Array.from({ length: N }, (_, i) => `g${i}`)
    relayouter.trainSubset(subsetIds)

    expect(relayouter.currentVersion).toBe(versionBefore)
    const modelAfter = relayouter.getModel()
    expect(modelAfter).not.toBeNull()
    // Same component count, same first eigenvector (a fresh PCA fit on a
    // different sample would change these).
    expect(modelAfter!.componentCount).toBe(modelBefore!.componentCount)
    for (let j = 0; j < modelBefore!.components[0].length; j++) {
      expect(modelAfter!.components[0][j]).toBeCloseTo(modelBefore!.components[0][j], 12)
    }
  })

  it('skips ids with no embedding and falls back to null when too few remain', () => {
    // Half the requested ids carry no embedding — count after filter is
    // below SUBSET_PCA_MIN, so trainSubset must return null.
    const N = SUBSET_PCA_MIN + 4
    const ids: string[] = []
    for (let i = 0; i < N; i++) {
      if (i % 2 === 0) {
        db.upsert(makeFile(`s${i}`, deterministicEmbedding(i)))
      } else {
        const f = makeFile(`s${i}`, new Float32Array(EMBED_DIM))
        f.embedding = null
        db.upsert(f)
      }
      ids.push(`s${i}`)
    }
    const survivors = ids.filter((_, i) => i % 2 === 0)
    if (survivors.length < SUBSET_PCA_MIN) {
      expect(relayouter.trainSubset(ids)).toBeNull()
    } else {
      // Survivors exceed the floor — should succeed and only cover survivors.
      const out = relayouter.trainSubset(ids)
      expect(out).not.toBeNull()
      expect(out!.size).toBe(survivors.length)
      for (const sid of survivors) {
        expect(out!.has(sid)).toBe(true)
      }
    }
  })
})
