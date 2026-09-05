import { describe, expect, it } from 'vitest'
import { FileIndex, type IndexedFile } from '../../src/daemon/db/FileIndex'
import { AtlasStore } from '../../src/daemon/atlas/AtlasStore'
import { nebulaGroups, NEBULA_MEMBER_LIMIT, type NebulaPoint } from '../../src/daemon/atlas/nebulaGroups'

const point = (id: string, x: number, hash: string | null = null): NebulaPoint => ({ id, x, y: 0, contentHash: hash, size: 100 })
describe('Evidence-led nebula groups', () => {
  it('does not invent similarity from nearby files or missing/empty hashes', () => {
    expect(nebulaGroups([point('a', 0), point('b', 20), point('c', 40)], [])).toEqual([])
    expect(nebulaGroups(['a', 'b', 'c'].map((id, i) => ({ ...point(id, i, 'empty'), size: 0 })), [])).toEqual([])
  })
  it('connects nonempty duplicate groups without moving files, regardless of input order', () => {
    const files = ['a', 'b', 'c', 'd'].map((id, i) => point(id, i * 30, 'same-content'))
    const before = structuredClone(files), groups = nebulaGroups(files, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('duplicates')
    expect(groups[0].members).toEqual(files.map(({ id, x, y }) => ({ id, x, y })))
    expect(nebulaGroups([...files].reverse(), [])).toEqual(groups)
    expect(files).toEqual(before)
  })
  it('requires strong valid edges and rejects distant islands', () => {
    const files = [point('a', 0), point('b', 100), point('c', 200), point('d', 99999)]
    const edges = [{ src: 'a', dst: 'b', weight: .97 }, { src: 'b', dst: 'c', weight: .95 }, { src: 'c', dst: 'd', weight: .99 }]
    expect(nebulaGroups(files, edges)[0].members.map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(nebulaGroups(files, edges.map(e => ({ ...e, weight: .8 })))).toEqual([])
    expect(nebulaGroups(files, [{ src: 'missing', dst: 'b', weight: 1 }])).toEqual([])
  })
  it('caps dense chains and duplicate groups', () => {
    const files = Array.from({ length: 500 }, (_, i) => point(String(i).padStart(4, '0'), i, 'same-content'))
    const groups = nebulaGroups(files, [])
    expect(groups.length).toBeGreaterThan(1)
    expect(Math.max(...groups.map(g => g.members.length))).toBeLessThanOrEqual(NEBULA_MEMBER_LIMIT)
    const members = groups.flatMap(g => g.members.map(p => p.id))
    expect(new Set(members).size).toBe(members.length)
  })
})

it('rebuilds derived clouds on changed evidence/geometry, filters hidden members, and preserves source state', () => {
  const index = new FileIndex({ dbPath: ':memory:' })
  try {
    const atlas = new AtlasStore(index)
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      index.upsert({ id, name: `${id}.md`, path: `/fixture/${id}.md`, platform: 'local', category: 'document', mimeType: 'text/markdown', size: 100, createdAt: 1, modifiedAt: 2,
        embedding: null, contentHash: 'same', x: null, y: null, z: null, clusterId: null, galaxyId: null, layoutVersion: 0, firstSeen: 1, viewCount: 0, isPinned: false, starType: null,
        pinAlpha: null, pinBeta: null, pinAxisA: null, pinAxisB: null, pinnedAt: null, osUseCount: null, osLastUsed: null, importanceScore: null, tags: null, embeddingStrategy: null } satisfies IndexedFile)
      atlas.syncBatch(); atlas.pin(id, i * 100, 0)
    }
    const source = index.db.prepare('SELECT * FROM files ORDER BY id').all()
    expect(atlas.summary().nebulae).toHaveLength(1)
    expect(atlas.summary({ galaxyIds: [] }).nebulae).toEqual([])
    expect(index.db.prepare('SELECT * FROM files ORDER BY id').all()).toEqual(source)
    const epoch = () => (index.db.prepare('SELECT epoch FROM atlas_nebula_state').get() as { epoch: number }).epoch
    const before = epoch(); atlas.setText('a', 'extracted content', 'ready', '2:100')
    expect(epoch()).toBe(before)
    atlas.favorite('a', true, 'pulsar'); expect(epoch()).toBe(before)
    atlas.pin('c', 99999, 0); expect(atlas.summary().nebulae).toEqual([])
    atlas.pin('c', 200, 0); expect(atlas.summary().nebulae).toHaveLength(1)
    index.db.prepare('UPDATE files SET content_hash=? WHERE id=?').run('changed', 'c')
    expect(atlas.summary().nebulae).toEqual([])
    // Edge-only evidence changes must reach clients even without a file/FTS revision.
    const prior = atlas.summary()
    const positions = index.db.prepare('SELECT * FROM atlas_positions ORDER BY id').all()
    const documents = index.db.prepare('SELECT * FROM atlas_documents ORDER BY id').all()
    const edge = index.db.prepare('INSERT INTO edges(src_id,dst_id,weight,engine,computed_at) VALUES(?,?,?,?,?)')
    edge.run('a', 'c', .98, 'embedding', 1); edge.run('b', 'c', .97, 'embedding', 1)
    const connected = atlas.summary()
    expect(connected.revision).toBe(prior.revision)
    expect(connected.nebulaEpoch).toBeGreaterThan(prior.nebulaEpoch!)
    expect(connected.nebulae).toHaveLength(1)
    expect(connected.nebulae![0].kind).toBe('related')
    expect(connected.nebulae![0].members.map(member => member.id)).toEqual(['a', 'b', 'c'])
    index.db.prepare('DELETE FROM edges WHERE src_id=?').run('b')
    const disconnected = atlas.summary()
    expect(disconnected.revision).toBe(connected.revision)
    expect(disconnected.nebulaEpoch).toBeGreaterThan(connected.nebulaEpoch!)
    expect(disconnected.nebulae).toEqual([])
    expect(index.db.prepare('SELECT * FROM atlas_positions ORDER BY id').all()).toEqual(positions)
    expect(index.db.prepare('SELECT * FROM atlas_documents ORDER BY id').all()).toEqual(documents)
  } finally { index.close() }
})
