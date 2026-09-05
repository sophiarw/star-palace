import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileIndex, type IndexedFile } from '../../src/daemon/db/FileIndex'
import { AtlasStore, chunkText, ftsQuery, spiralSlot } from '../../src/daemon/atlas/AtlasStore'

function fixture(id: string, overrides: Partial<IndexedFile> = {}): IndexedFile {
  return { id, name: `${id}.md`, path: `/library/research/${id}.md`, platform: 'local', category: 'document', mimeType: 'text/markdown',
    size: 100, createdAt: 1, modifiedAt: 2, embedding: null, contentHash: null, x: null, y: null, z: null, clusterId: null, galaxyId: null,
    layoutVersion: 0, firstSeen: 1, viewCount: 0, isPinned: false, starType: null, pinAlpha: null, pinBeta: null, pinAxisA: null, pinAxisB: null,
    pinnedAt: null, osUseCount: null, osLastUsed: null, importanceScore: null, tags: null, embeddingStrategy: null, ...overrides }
}

describe('Atlas persistence and retrieval', () => {
  let db: FileIndex, atlas: AtlasStore
  beforeEach(() => { db = new FileIndex({ dbPath: ':memory:' }); atlas = new AtlasStore(db) })
  afterEach(() => db.close())
  const sync = (): void => { while (atlas.syncBatch()) { /* drain bounded migration */ } }

  it('covers small libraries and media without embeddings or a PCA model', () => {
    db.upsert(fixture('photo', { category: 'media', mimeType: 'image/png' }))
    db.upsert(fixture('note')); sync()
    expect(atlas.summary().positioned).toBe(2)
    expect(atlas.file('photo')?.hasEmbedding).toBe(false)
    expect(atlas.lexical('photo', {}, 10).map(h => h.file.id)).toEqual(['photo'])
    expect(db.get('photo')?.x).toBeNull()
  })
  it('keeps existing positions fixed on insertion, reindex, pin, deletion, and restart', () => {
    for (let i = 0; i < 100; i++) db.upsert(fixture(`file-${i}`))
    sync()
    const original = atlas.list({}, 0, 200).files.map(f => [f.id, f.x, f.y])
    db.upsert(fixture('new')); sync()
    expect(atlas.list({}, 0, 200).files.filter(f => f.id !== 'new').map(f => [f.id, f.x, f.y])).toEqual(original)
    atlas.pin('new', 99000, -3333)
    expect(atlas.list({}, 0, 200).files.filter(f => f.id !== 'new').map(f => [f.id, f.x, f.y])).toEqual(original)
    db.db.prepare('DELETE FROM files WHERE id=?').run('file-20'); sync()
    db.upsert(fixture('another')); sync()
    const positions = atlas.list({}, 0, 200).files.map(f => `${f.x}:${f.y}`)
    expect(new Set(positions).size).toBe(positions.length)
    const restarted = new AtlasStore(db)
    expect(restarted.file('new')?.x).toBe(99000)
    restarted.pin('new', null, null)
    expect(restarted.file('new')?.x).not.toBe(99000)
  })
  it('bounds neighborhoods even when every file is connected', () => {
    for (let i = 0; i < 220; i++) {
      const id = `file-${i}`; db.upsert(fixture(id))
      if (i) db.upsertEdge({ srcId: id, dstId: `file-${i - 1}`, weight: 0.9, engine: 'embedding', computedAt: 1 })
    }
    sync()
    const groups = atlas.summary().regions.filter(r => r.kind === 'neighborhood')
    expect(groups.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...groups.map(g => g.count))).toBeLessThanOrEqual(96)
  })
  it('finds late passages and exact punctuation-heavy filenames', () => {
    db.upsert(fixture('paper', { name: 'analysis.v2_final.md' })); sync()
    const text = 'Introduction about unrelated material. '.repeat(600) + 'The migration strategy uses a copper lantern as its landmark.'
    expect(atlas.setText('paper', text, 'ready', '2:100')).toBe(true)
    expect(atlas.lexical('analysis.v2_final.md', {}, 10)[0].reason).toBe('name')
    const hit = atlas.lexical('"copper lantern"', {}, 10)[0]
    expect(hit.file.id).toBe('paper'); expect(hit.snippet).toContain('copper lantern'); expect(hit.offset).toBeGreaterThan(8000)
  })
  it('scopes before ranking and updates tags even without text changes', () => {
    const one = db.getOrCreateGalaxy('/one', 'One'), two = db.getOrCreateGalaxy('/two', 'Two')
    db.upsert(fixture('one', { name: 'report.md', galaxyId: one.id })); db.upsert(fixture('two', { name: 'report.md', galaxyId: two.id })); sync()
    expect(atlas.lexical('report', { galaxyIds: [two.id] }, 1)[0].file.id).toBe('two')
    expect(atlas.lexical('report', { galaxyIds: [] }, 10)).toEqual([])
    db.setTags('one', ['special-topic']); sync()
    expect(atlas.lexical('special', {}, 10)[0].file.id).toBe('one')
  })
  it('coalesces repeated upserts before the background queue drains', () => {
    db.upsert(fixture('pending'))
    db.upsert(fixture('pending', { name: 'renamed.md' }))
    db.upsert(fixture('pending', { name: 'final.md' }))
    sync()
    expect(atlas.file('pending')?.name).toBe('final.md')
    expect(atlas.summary().positioned).toBe(1)
  })

  it('intermixes file types and updates object summaries without moving files', () => {
    const galaxy = db.getOrCreateGalaxy('/library', 'Library')
    db.upsert(fixture('note', { galaxyId: galaxy.id }))
    db.upsert(fixture('image', { galaxyId: galaxy.id, name: 'image.png', path: '/library/research/image.png', category: 'media', mimeType: 'image/png' }))
    sync()
    const note = atlas.file('note')!, image = atlas.file('image')!
    expect(note.neighborhoodId).toBe(image.neighborhoodId)
    expect(atlas.summary().regions.find(r => r.id === note.regionId)?.objectTypes).toEqual({ 'main-sequence': 1, nebula: 1 })
    db.setStarType('note', 'pulsar'); sync()
    expect(atlas.file('note')?.x).toBe(note.x)
    expect(atlas.summary().regions.find(r => r.id === note.regionId)?.objectTypes).toEqual({ pulsar: 1, nebula: 1 })
    expect(atlas.summary({ category: 'media' }).regions[0].objectTypes).toEqual({ nebula: 1 })
    db.delete('note'); sync()
    expect(atlas.summary().regions.find(r => r.id === image.regionId)?.objectTypes).toEqual({ nebula: 1 })
  })

  it('rejects stale extraction and removes deleted files from search', () => {
    db.upsert(fixture('note')); sync()
    expect(atlas.setText('note', 'obsolete result', 'ready', '1:100')).toBe(false)
    expect(atlas.lexical('obsolete', {}, 10)).toEqual([])
    db.db.prepare('DELETE FROM files WHERE id=?').run('note'); sync()
    expect(atlas.lexical('note', {}, 10)).toEqual([])
  })
  it('restores pins and labels without removing newly indexed files or user tags', () => {
    db.upsert(fixture('note')); sync()
    const snapshot = atlas.snapshot('Before changes'), position = atlas.file('note')!
    atlas.pin('note', 345, 678); db.setTags('note', ['keep']); db.upsert(fixture('new')); sync()
    expect(atlas.restore(snapshot)).toBe(true)
    expect(atlas.file('note')?.x).toBe(position.x)
    expect(atlas.file('note')?.tags).toEqual(['keep'])
    expect(atlas.file('new')).not.toBeNull()
  })
})

it('generates unique grid slots and safe literal FTS expressions', () => {
  const slots = Array.from({ length: 1000 }, (_, i) => spiralSlot(i, 10).join(':'))
  expect(new Set(slots).size).toBe(1000)
  expect(ftsQuery('foo OR bar*')).toBe('"foo"* AND "OR"* AND "bar"*')
  expect(ftsQuery('"two words"')).toBe('"two words"')
  expect(chunkText('a'.repeat(9000)).at(-1)?.offset).toBe(7400)
})
