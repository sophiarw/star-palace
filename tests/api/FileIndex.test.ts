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

  it('creates a default galaxy on migration', () => {
    const galaxies = idx.listGalaxies()
    expect(galaxies.length).toBeGreaterThanOrEqual(1)
    const def = galaxies.find(g => g.name === 'default')
    expect(def).toBeDefined()
    expect(def!.originX).toBe(0)
    expect(def!.originY).toBe(0)
  })

  it('getOrCreateGalaxy is idempotent on root_path', () => {
    const a = idx.getOrCreateGalaxy('/Users/foo/projects', 'projects')
    const b = idx.getOrCreateGalaxy('/Users/foo/projects', 'projects')
    expect(a.id).toBe(b.id)
    expect(a.originX).toBe(b.originX)
    expect(a.originY).toBe(b.originY)
  })

  it('places successive galaxies on distinct spiral slots', () => {
    const a = idx.getOrCreateGalaxy('/a', 'a')
    const b = idx.getOrCreateGalaxy('/b', 'b')
    const c = idx.getOrCreateGalaxy('/c', 'c')
    expect(a.originX === b.originX && a.originY === b.originY).toBe(false)
    expect(b.originX === c.originX && b.originY === c.originY).toBe(false)
  })

  it('places the first user galaxy at the origin (default does not push it off-center)', () => {
    const a = idx.getOrCreateGalaxy('/Users/foo/tiny', 'tiny')
    expect(a.originX).toBe(0)
    expect(a.originY).toBe(0)
  })

  it('lists galaxies with member_count', () => {
    const g = idx.getOrCreateGalaxy('/Users/foo/notes', 'notes')
    idx.upsert(makeFile({ id: 'gx1', path: '/Users/foo/notes/a.md', galaxyId: g.id }))
    idx.upsert(makeFile({ id: 'gx2', path: '/Users/foo/notes/b.md', galaxyId: g.id }))
    const list = idx.listGalaxies()
    const found = list.find(x => x.id === g.id)
    expect(found).toBeDefined()
    expect(found!.memberCount).toBe(2)
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
    idx.upsert(makeFile({ id: 'pa', path: '/pa' }))
    idx.upsert(makeFile({ id: 'pb', path: '/pb' }))
    idx.setPin('pa', 3, 5, 0, 1, 1)  // α on axis 0, β on axis 1
    idx.setPin('pb', 7, 9, 2, 3, 2)  // α on axis 2, β on axis 3

    // Flip axes 0 and 3; leave 1 and 2 alone
    idx.applyPinSignFlips([-1, 1, 1, -1])

    const fa = idx.get('pa')!
    expect(fa.pinAlpha).toBeCloseTo(-3)  // axis 0 flipped
    expect(fa.pinBeta).toBeCloseTo(5)    // axis 1 stable

    const fb = idx.get('pb')!
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

  it('round-trips F10 usage signals (os_use_count, os_last_used, importance_score)', () => {
    idx.upsert(makeFile({ id: 'u1', path: '/u1' }))
    const empty = idx.get('u1')!
    expect(empty.osUseCount).toBeNull()
    expect(empty.osLastUsed).toBeNull()
    expect(empty.importanceScore).toBeNull()

    idx.upsert(makeFile({
      id: 'u1',
      path: '/u1',
      osUseCount: 42,
      osLastUsed: 1_700_000_000_000,
      importanceScore: 12.5,
    }))
    const populated = idx.get('u1')!
    expect(populated.osUseCount).toBe(42)
    expect(populated.osLastUsed).toBe(1_700_000_000_000)
    expect(populated.importanceScore).toBeCloseTo(12.5)

    // Re-upsert with all-NULL signals overwrites (recomputed on every walker
    // pass — NULL means "still no signal").
    idx.upsert(makeFile({ id: 'u1', path: '/u1' }))
    const cleared = idx.get('u1')!
    expect(cleared.osUseCount).toBeNull()
    expect(cleared.osLastUsed).toBeNull()
    expect(cleared.importanceScore).toBeNull()
  })

  // F5 — Collections

  it('creates and lists a static collection with members', () => {
    idx.upsert(makeFile({ id: 'c1', path: '/c1' }))
    idx.upsert(makeFile({ id: 'c2', path: '/c2' }))
    const coll = idx.createCollection({
      name: 'Magnets',
      kind: 'static',
      fileIds: ['c1', 'c2'],
    })
    expect(coll.id).toBeGreaterThan(0)
    expect(coll.name).toBe('Magnets')
    expect(coll.kind).toBe('static')
    expect(coll.query).toBeNull()
    expect(coll.similarityFloor).toBeNull()
    expect(coll.evaluatedAt).toBeNull()

    const list = idx.listCollections()
    const found = list.find(c => c.id === coll.id)
    expect(found).toBeDefined()
    expect(found!.memberCount).toBe(2)
    expect(idx.getCollectionMembers(coll.id).sort()).toEqual(['c1', 'c2'])
  })

  it('creates a dynamic collection with query + similarity floor default', () => {
    const coll = idx.createCollection({ name: 'Pitch decks', kind: 'dynamic', query: 'pitch deck' })
    expect(coll.kind).toBe('dynamic')
    expect(coll.query).toBe('pitch deck')
    expect(coll.similarityFloor).toBeCloseTo(0.6)  // COLLECTION_DEFAULT_SIMILARITY_FLOOR
  })

  it('rejects duplicate collection names with a SqliteError', () => {
    idx.createCollection({ name: 'Dup', kind: 'static' })
    expect(() => idx.createCollection({ name: 'Dup', kind: 'static' })).toThrow(/UNIQUE/)
  })

  it('add and remove static members', () => {
    idx.upsert(makeFile({ id: 'm1', path: '/m1' }))
    idx.upsert(makeFile({ id: 'm2', path: '/m2' }))
    idx.upsert(makeFile({ id: 'm3', path: '/m3' }))
    const c = idx.createCollection({ name: 'Bag', kind: 'static', fileIds: ['m1'] })
    idx.addCollectionMembers(c.id, ['m2', 'm3'])
    expect(idx.getCollectionMembers(c.id).sort()).toEqual(['m1', 'm2', 'm3'])

    idx.removeCollectionMember(c.id, 'm2')
    expect(idx.getCollectionMembers(c.id).sort()).toEqual(['m1', 'm3'])
  })

  it('addCollectionMembers is idempotent on duplicate ids', () => {
    idx.upsert(makeFile({ id: 'd1', path: '/d1' }))
    const c = idx.createCollection({ name: 'IdemBag', kind: 'static', fileIds: ['d1'] })
    idx.addCollectionMembers(c.id, ['d1', 'd1'])
    expect(idx.getCollectionMembers(c.id)).toEqual(['d1'])
  })

  it('setCollectionMembership atomically replaces membership and reports diff', () => {
    const c = idx.createCollection({ name: 'DynBag', kind: 'dynamic', query: 'q', fileIds: ['a', 'b'] })
    const diff = idx.setCollectionMembership(c.id, ['b', 'c', 'd'])
    expect(diff.added.sort()).toEqual(['c', 'd'])
    expect(diff.removed).toEqual(['a'])
    expect(idx.getCollectionMembers(c.id).sort()).toEqual(['b', 'c', 'd'])

    const after = idx.getCollection(c.id)!
    expect(after.evaluatedAt).not.toBeNull()
  })

  it('deleteCollection cascades members', () => {
    const c = idx.createCollection({ name: 'Del', kind: 'static', fileIds: ['x', 'y'] })
    expect(idx.getCollectionMembers(c.id)).toHaveLength(2)
    idx.deleteCollection(c.id)
    expect(idx.getCollection(c.id)).toBeNull()
    expect(idx.getCollectionMembers(c.id)).toEqual([])
  })

  it('assigns distinct color indices to successive collections (modulo palette)', () => {
    const a = idx.createCollection({ name: 'C0', kind: 'static' })
    const b = idx.createCollection({ name: 'C1', kind: 'static' })
    expect(b.colorIndex).not.toBe(a.colorIndex)
  })

  it('respects an explicit colorIndex override on create', () => {
    const c = idx.createCollection({ name: 'Override', kind: 'static', colorIndex: 4 })
    expect(c.colorIndex).toBe(4)
  })

  // B1 — tags + embedding strategy + app_settings + snapshot tables

  it('round-trips tags via setTags/getTags (single, multiple, null)', () => {
    idx.upsert(makeFile({ id: 'tg1', path: '/tg1' }))
    expect(idx.getTags('tg1')).toBeNull()

    idx.setTags('tg1', ['research'])
    expect(idx.getTags('tg1')).toEqual(['research'])

    idx.setTags('tg1', ['research', 'pinned', 'q4'])
    expect(idx.getTags('tg1')).toEqual(['research', 'pinned', 'q4'])

    idx.setTags('tg1', null)
    expect(idx.getTags('tg1')).toBeNull()
  })

  it('preserves tags across a re-index that does not pass new tags', () => {
    idx.upsert(makeFile({ id: 'tg2', path: '/tg2' }))
    idx.setTags('tg2', ['keepme'])
    // Re-index passes tags: null — must NOT wipe the existing tags (matches
    // the is_pinned/star_type COALESCE pattern)
    idx.upsert(makeFile({ id: 'tg2', path: '/tg2', size: 999, tags: null }))
    expect(idx.getTags('tg2')).toEqual(['keepme'])
  })

  it('overwrites tags when caller passes explicit non-null tags via upsert', () => {
    idx.upsert(makeFile({ id: 'tg3', path: '/tg3' }))
    idx.setTags('tg3', ['old'])
    idx.upsert(makeFile({ id: 'tg3', path: '/tg3', tags: ['new'] }))
    expect(idx.getTags('tg3')).toEqual(['new'])
  })

  it('default strategy seeded as content-only and round-trips via setDefaultStrategy', () => {
    expect(idx.getDefaultStrategy()).toBe('content-only')
    idx.setDefaultStrategy('metadata+content')
    expect(idx.getDefaultStrategy()).toBe('metadata+content')
    idx.setDefaultStrategy('content-only')
    expect(idx.getDefaultStrategy()).toBe('content-only')
  })

  it('updateEmbedding records the strategy that produced the vector', () => {
    idx.upsert(makeFile({ id: 'es1', path: '/es1' }))
    expect(idx.get('es1')!.embeddingStrategy).toBeNull()

    idx.updateEmbedding('es1', new Float32Array(768).fill(0.05), 'hash_es1', 'metadata+content')
    const f = idx.get('es1')!
    expect(f.embeddingStrategy).toBe('metadata+content')
    expect(f.contentHash).toBe('hash_es1')
  })

  it('preserves embedding_strategy across re-index when caller passes null', () => {
    idx.upsert(makeFile({ id: 'es2', path: '/es2', embeddingStrategy: 'metadata+content' }))
    expect(idx.get('es2')!.embeddingStrategy).toBe('metadata+content')

    // Re-upsert without strategy — must preserve the prior value
    idx.upsert(makeFile({ id: 'es2', path: '/es2', size: 555, embeddingStrategy: null }))
    expect(idx.get('es2')!.embeddingStrategy).toBe('metadata+content')
  })

  it('embedding_snapshot tables accept a basic round-trip insert', () => {
    // B1 just creates the tables — B2 fills them. Verify the schema is
    // queryable end-to-end so a typo in CREATE TABLE doesn't ship.
    idx.db.prepare(
      `INSERT INTO embedding_snapshots (snapshot_id, created_at, strategy, scope_path, note)
       VALUES (?, ?, ?, ?, ?)`
    ).run('snap-1', 1_700_000_000_000, 'metadata+content', '/Users/x/scope', 'first try')

    const emb = Buffer.alloc(3072)  // 768 floats * 4 bytes
    idx.db.prepare(
      `INSERT INTO embedding_snapshot_files
       (snapshot_id, file_id, embedding, content_hash, x, y, layout_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('snap-1', 'fileA', emb, 'hashA', 1.5, -2.3, 7)

    const snap = idx.db.prepare(
      `SELECT * FROM embedding_snapshots WHERE snapshot_id = ?`
    ).get('snap-1') as { snapshot_id: string; strategy: string; scope_path: string; note: string }
    expect(snap.snapshot_id).toBe('snap-1')
    expect(snap.strategy).toBe('metadata+content')
    expect(snap.scope_path).toBe('/Users/x/scope')

    const file = idx.db.prepare(
      `SELECT * FROM embedding_snapshot_files WHERE snapshot_id = ? AND file_id = ?`
    ).get('snap-1', 'fileA') as { file_id: string; content_hash: string; x: number; y: number; layout_version: number }
    expect(file.file_id).toBe('fileA')
    expect(file.content_hash).toBe('hashA')
    expect(file.x).toBeCloseTo(1.5)
    expect(file.y).toBeCloseTo(-2.3)
    expect(file.layout_version).toBe(7)
  })
})
