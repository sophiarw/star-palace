import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import type { IndexedFile } from '../../src/daemon/db/FileIndex'

function makeFile(overrides: Partial<IndexedFile> = {}): Omit<IndexedFile, 'isStale'> {
  return {
    id: 'test001',
    path: '/tmp/test.md',
    platform: 'local',
    name: 'test.md',
    mimeType: 'text/markdown',
    category: 'document',
    size: 100,
    createdAt: 1000,
    modifiedAt: 2000,
    embedding: null,
    contentHash: null,
    x: null,
    y: null,
    z: null,
    clusterId: null,
    layoutVersion: 0,
    firstSeen: 1000,
    viewCount: 0,
    isPinned: false,
    ...overrides,
  }
}

describe('FileIndex', () => {
  let idx: FileIndex

  beforeEach(() => {
    idx = new FileIndex({ dbPath: ':memory:' })
  })

  afterEach(() => {
    idx.close()
  })

  it('upserts and retrieves a file', () => {
    idx.upsert(makeFile())
    const f = idx.get('test001')
    expect(f).not.toBeNull()
    expect(f!.name).toBe('test.md')
    expect(f!.embedding).toBeNull()
  })

  it('updates embedding', () => {
    idx.upsert(makeFile())
    const emb = new Float32Array(768).fill(0.1)
    idx.updateEmbedding('test001', emb, 'abc123')
    const f = idx.get('test001')!
    expect(f.contentHash).toBe('abc123')
    expect(f.embedding).not.toBeNull()
    expect(f.embedding![0]).toBeCloseTo(0.1)
  })

  it('updates position', () => {
    idx.upsert(makeFile())
    idx.updatePosition('test001', 1.5, -2.3, 1)
    const f = idx.get('test001')!
    expect(f.x).toBeCloseTo(1.5)
    expect(f.y).toBeCloseTo(-2.3)
    expect(f.layoutVersion).toBe(1)
  })

  it('counts with embeddings', () => {
    idx.upsert(makeFile({ id: 'a', path: '/a' }))
    idx.upsert(makeFile({ id: 'b', path: '/b' }))
    expect(idx.countWithEmbeddings()).toBe(0)
    idx.updateEmbedding('a', new Float32Array(768), 'hash_a')
    expect(idx.countWithEmbeddings()).toBe(1)
  })

  it('upserts and retrieves edges', () => {
    idx.upsertEdge({ srcId: 'a', dstId: 'b', weight: 0.9, engine: 'embedding', computedAt: 1000 })
    idx.upsertEdge({ srcId: 'a', dstId: 'c', weight: 0.7, engine: 'embedding', computedAt: 1000 })
    const edges = idx.getEdgesFrom('a')
    expect(edges).toHaveLength(2)
    expect(edges[0].weight).toBeGreaterThanOrEqual(edges[1].weight)
  })

  it('prunes edges above K', () => {
    for (let i = 0; i < 5; i++) {
      idx.upsertEdge({ srcId: 'a', dstId: `n${i}`, weight: i / 10, engine: 'embedding', computedAt: 1000 })
    }
    idx.pruneEdgesFrom('a', 3)
    expect(idx.getEdgesFrom('a')).toHaveLength(3)
  })

  it('creates and retrieves clusters', () => {
    const id = idx.upsertCluster({ colorIndex: 0, centroidX: 1, centroidY: 2, memberCount: 5, label: null })
    const c = idx.getCluster(id)
    expect(c).not.toBeNull()
    expect(c!.memberCount).toBe(5)
  })

  it('saves and retrieves layout meta', () => {
    idx.saveLayoutMeta(1, 'pca', Buffer.from('{"components":[]}'), 100)
    const meta = idx.getLatestLayoutMeta()
    expect(meta).not.toBeNull()
    expect(meta!.algorithm).toBe('pca')
    expect(meta!.node_count).toBe(100)
  })

  it('returns viewport stars', () => {
    idx.upsert(makeFile({ id: 'star1', path: '/s1', x: 5, y: 5, layoutVersion: 1 }))
    idx.upsert(makeFile({ id: 'star2', path: '/s2', x: 50, y: 50, layoutVersion: 1 }))
    const stars = idx.listInViewport(0, 0, 10, 10)
    expect(stars).toHaveLength(1)
    expect(stars[0].id).toBe('star1')
  })
})
