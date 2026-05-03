import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'path'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import { HnswIndex } from '../../src/daemon/ann/HnswIndex'
import { OllamaClient } from '../../src/daemon/embedding/OllamaClient'
import { EmbeddingEngine } from '../../src/daemon/embedding/EmbeddingEngine'
import { Relayouter } from '../../src/daemon/layout/Relayouter'
import { indexPath, insertOne } from '../../src/daemon/pipeline/Insert'
import { EMBED_DIM, K_NEAREST, LAYOUT_THRESHOLD } from '../../src/shared/types'
import type { FileNode } from '../../src/shared/types'

const FIXTURES = resolve(__dirname, '../fixtures/sample')

function deterministicEmbedding(text: string): Float32Array {
  // Deterministic pseudo-embedding based on text content — different text → different vector
  const v = new Float32Array(EMBED_DIM)
  let hash = 5381
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0
  }
  for (let i = 0; i < EMBED_DIM; i++) {
    hash = ((hash * 1664525) + 1013904223) >>> 0
    v[i] = (hash / 2 ** 32) * 2 - 1
  }
  // normalize
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm
  return v
}

describe('Insert pipeline (mocked Ollama)', () => {
  let db: FileIndex
  let hnsw: HnswIndex
  let engine: EmbeddingEngine
  let relayouter: Relayouter

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { prompt: string }
      const embedding = deterministicEmbedding(body.prompt)
      return {
        ok: true,
        json: async () => ({ embedding: Array.from(embedding) }),
      } as Response
    })

    db = new FileIndex({ dbPath: ':memory:' })
    hnsw = new HnswIndex({ dim: EMBED_DIM })
    const client = new OllamaClient()
    engine = new EmbeddingEngine(client)
    relayouter = new Relayouter(db)
  })

  afterEach(() => {
    db.close()
    vi.unstubAllGlobals()
  })

  it('indexes fixture files without errors', async () => {
    const stats = await indexPath(FIXTURES, { db, hnsw, embedEngine: engine, relayouter })
    expect(stats.errors).toBe(0)
    expect(stats.indexed).toBeGreaterThan(0)
    expect(db.count()).toBeGreaterThan(0)
  })

  it('skips media files (no embedding)', async () => {
    await indexPath(FIXTURES, { db, hnsw, embedEngine: engine, relayouter })
    const files = db.listWithEmbeddings()
    for (const f of files) {
      expect(f.category).not.toBe('media')
    }
  })

  it('no duplicate edges for same src_id', async () => {
    await indexPath(FIXTURES, { db, hnsw, embedEngine: engine, relayouter })
    const files = db.listWithEmbeddings()
    for (const f of files) {
      const edges = db.getEdgesFrom(f.id)
      const dstIds = edges.map(e => e.dstId)
      const uniqueDsts = new Set(dstIds)
      expect(uniqueDsts.size).toBe(dstIds.length)
    }
  })

  it('edges per file capped at K_NEAREST', async () => {
    await indexPath(FIXTURES, { db, hnsw, embedEngine: engine, relayouter })
    const files = db.listWithEmbeddings()
    for (const f of files) {
      const edges = db.getEdgesFrom(f.id)
      expect(edges.length).toBeLessThanOrEqual(K_NEAREST)
    }
  })

  it('idempotent re-index (same content hash = skip)', async () => {
    await indexPath(FIXTURES, { db, hnsw, embedEngine: engine, relayouter })
    const count1 = vi.mocked(fetch).mock.calls.length
    await indexPath(FIXTURES, { db, hnsw, embedEngine: engine, relayouter })
    const count2 = vi.mocked(fetch).mock.calls.length
    // Second run should not call embed API again (same content hash)
    expect(count2).toBe(count1)
  })

  it('concurrent inserts produce a consistent K-NN graph (no orphans, no dupes, K cap holds)', async () => {
    const N = 25
    const nodes: { node: FileNode; content: Buffer }[] = []
    for (let i = 0; i < N; i++) {
      const text = `concurrent insert content number ${i} unique ${i * 7}`
      nodes.push({
        node: {
          id: `cc${i}`,
          name: `cc${i}.txt`,
          path: `/tmp/cc${i}.txt`,
          platform: 'local',
          mimeType: 'text/plain',
          category: 'document',
          size: text.length,
          createdAt: 0,
          modifiedAt: 0,
        },
        content: Buffer.from(text),
      })
    }

    await Promise.all(
      nodes.map(({ node, content }) =>
        insertOne(node, content, { db, hnsw, embedEngine: engine, relayouter })
      )
    )

    const ids = new Set(nodes.map(n => n.node.id))
    const allFiles = db.listWithEmbeddings().map(f => f.id)
    expect(allFiles.length).toBe(N)
    for (const id of ids) expect(allFiles).toContain(id)

    for (const id of allFiles) {
      const edges = db.getEdgesFrom(id)
      expect(edges.length).toBeLessThanOrEqual(K_NEAREST)
      const dsts = new Set(edges.map(e => e.dstId))
      expect(dsts.size).toBe(edges.length)
      for (const e of edges) {
        expect(ids.has(e.dstId)).toBe(true)
        expect(e.dstId).not.toBe(id)
      }
    }
  })

  it('layout trains when threshold reached', async () => {
    // Insert LAYOUT_THRESHOLD deterministic files directly
    const client = new OllamaClient()
    const eng = new EmbeddingEngine(client)
    const relay = new Relayouter(db)

    for (let i = 0; i < LAYOUT_THRESHOLD + 10; i++) {
      const text = `file content number ${i} unique text here`.repeat(5)
      const result = await eng.embed(text)
      db.upsert({
        id: `syn${i}`,
        name: `file${i}.txt`,
        path: `/tmp/file${i}.txt`,
        platform: 'local',
        mimeType: 'text/plain',
        category: 'document',
        size: text.length,
        createdAt: 0,
        modifiedAt: 0,
        embedding: result.embedding,
        contentHash: result.contentHash,
        x: null, y: null, z: null,
        clusterId: null, layoutVersion: 0,
        firstSeen: 0, viewCount: 0, isPinned: false,
        starType: null,
      })
      hnsw.addPoint(result.embedding, `syn${i}`)
    }

    expect(relay.isReady).toBe(false)
    relay.maybeTrainFirst()
    expect(relay.isReady).toBe(true)

    // Check that projecting works
    const [x, y] = relay.projectOne(new Float32Array(EMBED_DIM).fill(0.1))!
    expect(isFinite(x)).toBe(true)
    expect(isFinite(y)).toBe(true)
  })
})
