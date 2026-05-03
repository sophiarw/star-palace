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
    starType: null,
    pinAlpha: null,
    pinBeta: null,
    pinAxisA: null,
    pinAxisB: null,
    pinnedAt: null,
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

  it('round-trips star_type tagging', () => {
    idx.upsert(makeFile({ id: 'tag1', path: '/t1' }))
    expect(idx.get('tag1')!.starType).toBeNull()

    idx.setStarType('tag1', 'pulsar')
    expect(idx.get('tag1')!.starType).toBe('pulsar')

    idx.setStarType('tag1', 'red-giant')
    expect(idx.get('tag1')!.starType).toBe('red-giant')

    idx.setStarType('tag1', null)
    expect(idx.get('tag1')!.starType).toBeNull()
  })

  it('preserves star_type across upsert', () => {
    idx.upsert(makeFile({ id: 'tag2', path: '/t2' }))
    idx.setStarType('tag2', 'quasar')
    // Re-upsert as if a re-index happened
    idx.upsert(makeFile({ id: 'tag2', path: '/t2', size: 200 }))
    expect(idx.get('tag2')!.starType).toBe('quasar')
  })

  it('round-trips pin coefficients via setPin/clearPin', () => {
    idx.upsert(makeFile({ id: 'pin1', path: '/p1' }))
    expect(idx.get('pin1')!.isPinned).toBe(false)
    expect(idx.get('pin1')!.pinAlpha).toBeNull()

    idx.setPin('pin1', 1.5, -2.3, 0, 1, 1234)
    const pinned = idx.get('pin1')!
    expect(pinned.isPinned).toBe(true)
    expect(pinned.pinAlpha).toBeCloseTo(1.5)
    expect(pinned.pinBeta).toBeCloseTo(-2.3)
    expect(pinned.pinAxisA).toBe(0)
    expect(pinned.pinAxisB).toBe(1)
    expect(pinned.pinnedAt).toBe(1234)

    idx.clearPin('pin1')
    const unpinned = idx.get('pin1')!
    expect(unpinned.isPinned).toBe(false)
    expect(unpinned.pinAlpha).toBeNull()
    expect(unpinned.pinBeta).toBeNull()
    expect(unpinned.pinAxisA).toBeNull()
    expect(unpinned.pinAxisB).toBeNull()
    expect(unpinned.pinnedAt).toBeNull()
  })

  it('overwrites prior pin coefficients on re-pin', () => {
    idx.upsert(makeFile({ id: 'pin2', path: '/p2' }))
    idx.setPin('pin2', 1, 2, 0, 1, 100)
    idx.setPin('pin2', 7, 8, 2, 3, 200)
    const re = idx.get('pin2')!
    expect(re.pinAlpha).toBeCloseTo(7)
    expect(re.pinBeta).toBeCloseTo(8)
    expect(re.pinAxisA).toBe(2)
    expect(re.pinAxisB).toBe(3)
    expect(re.pinnedAt).toBe(200)
  })

  it('listPinned returns only pinned files', () => {
    idx.upsert(makeFile({ id: 'a', path: '/a' }))
    idx.upsert(makeFile({ id: 'b', path: '/b' }))
    idx.upsert(makeFile({ id: 'c', path: '/c' }))
    idx.setPin('a', 1, 0, 0, 1, 1)
    idx.setPin('c', 0, 1, 0, 1, 2)
    const pinned = idx.listPinned()
    expect(pinned).toHaveLength(2)
    expect(pinned.map(f => f.id).sort()).toEqual(['a', 'c'])
  })

  it('applyPinSignFlips negates α/β when its axis flipped sign', () => {
    idx.upsert(makeFile({ id: 'a', path: '/a' }))
    idx.upsert(makeFile({ id: 'b', path: '/b' }))
    idx.setPin('a', 3, 5, 0, 1, 1)  // α on axis 0, β on axis 1
    idx.setPin('b', 7, 9, 2, 3, 2)  // α on axis 2, β on axis 3

    // Flip axes 0 and 3; leave 1 and 2 alone
    idx.applyPinSignFlips([-1, 1, 1, -1])

    const fa = idx.get('a')!
    expect(fa.pinAlpha).toBeCloseTo(-3)  // axis 0 flipped
    expect(fa.pinBeta).toBeCloseTo(5)    // axis 1 stable

    const fb = idx.get('b')!
    expect(fb.pinAlpha).toBeCloseTo(7)   // axis 2 stable
    expect(fb.pinBeta).toBeCloseTo(-9)   // axis 3 flipped
  })

  it('applyPinSignFlips skips unstable axes (flip == 0)', () => {
    idx.upsert(makeFile({ id: 'u', path: '/u' }))
    idx.setPin('u', 4, 6, 0, 1, 1)
    // Axis 0 marked unstable; offsets must NOT be touched (best-effort policy)
    idx.applyPinSignFlips([0, -1])
    const f = idx.get('u')!
    expect(f.pinAlpha).toBeCloseTo(4)
    expect(f.pinBeta).toBeCloseTo(6)
  })

  it('upsert does not clear pin coefficients on re-index', () => {
    idx.upsert(makeFile({ id: 'p', path: '/p' }))
    idx.setPin('p', 1.1, 2.2, 0, 1, 99)
    idx.upsert(makeFile({ id: 'p', path: '/p', size: 999 }))  // re-index
    const f = idx.get('p')!
    expect(f.isPinned).toBe(true)
    expect(f.pinAlpha).toBeCloseTo(1.1)
    expect(f.pinBeta).toBeCloseTo(2.2)
    expect(f.pinAxisA).toBe(0)
    expect(f.pinAxisB).toBe(1)
    expect(f.pinnedAt).toBe(99)
    expect(f.size).toBe(999)
  })
})
