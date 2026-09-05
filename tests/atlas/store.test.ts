import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileIndex, type IndexedFile } from '../../src/daemon/db/FileIndex'
import { AtlasStore, chunkText, ftsQuery } from '../../src/daemon/atlas/AtlasStore'

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

  it('returns consistent favorite and byte metadata in summary, hydration, list, search, and reload', () => {
    db.upsert(fixture('favorite', { size: 987654321, starType: 'nebula' })); sync()
    atlas.pin('favorite', 33, 44)
    const before = atlas.file('favorite')!, revision = atlas.revision
    expect(atlas.favorite('favorite', true, 'black-hole')).toBe(true)
    expect(atlas.revision).toBeGreaterThan(revision)
    const expected = { id: 'favorite', size: 987654321, isFavorite: true, favoriteAppearance: 'black-hole', x: 33, y: 44 }
    expect(atlas.summary().markers?.[0]).toMatchObject(expected)
    expect(atlas.viewport({}, { minX: 0, minY: 0, maxX: 100, maxY: 100 })[0]).toMatchObject(expected)
    expect(atlas.list().files[0]).toMatchObject(expected)
    expect(atlas.lexical('favorite', {}, 10)[0].file).toMatchObject(expected)
    expect(atlas.file('favorite')).toMatchObject({ ...before, isFavorite: true, favoriteAppearance: 'black-hole' })
    const changed = atlas.revision
    expect(atlas.favorite('favorite', true, 'black-hole')).toBe(true)
    expect(atlas.revision).toBe(changed)
    expect(new AtlasStore(db).file('favorite')).toMatchObject(expected)
    const snapshot = atlas.snapshot('Favorite stays independent')
    atlas.favorite('favorite', false); atlas.restore(snapshot)
    expect(atlas.file('favorite')).toMatchObject({ isFavorite: false, favoriteAppearance: 'black-hole', isPinned: true, starType: 'nebula', x: 33, y: 44 })
    expect(atlas.favorite('missing', true)).toBe(false)
  })

  it('covers small libraries and media without embeddings or a PCA model', () => {
    db.upsert(fixture('photo', { category: 'media', mimeType: 'image/png' }))
    db.upsert(fixture('note')); sync()
    expect(atlas.summary().positioned).toBe(2)
    expect(atlas.file('photo')?.hasEmbedding).toBe(false)
    expect(atlas.lexical('photo', {}, 10).map(h => h.file.id)).toEqual(['photo'])
    expect(db.get('photo')?.x).toBeNull()
  })
  it('hydrates full-folder links independently of viewport bounds and refreshes them after a pin or deletion', () => {
    for (const id of ['a', 'b', 'c']) db.upsert(fixture(id))
    sync()
    atlas.pin('a', 0, 0); atlas.pin('b', 100, 0); atlas.pin('c', 200, 0)
    const original = db.db.prepare('SELECT * FROM files ORDER BY id').all()
    const a = atlas.viewport({}, { minX: -1, minY: -1, maxX: 1, maxY: 1 })[0]
    expect(a.id).toBe('a'); expect(a.folderLinks).toEqual([{ id: 'b', x: 100, y: 0 }])
    const complete = atlas.viewport({}, { minX: -1, minY: -1, maxX: 201, maxY: 1 })
    expect(complete.find(file => file.id === 'a')?.folderLinks).toEqual(a.folderLinks)
    expect(db.db.prepare('SELECT * FROM files ORDER BY id').all()).toEqual(original)
    atlas.setText('a', 'Extracted text does not affect folder geometry', 'ready', '2:100')
    db.setTags('a', ['updated']); sync()
    expect(atlas.viewport({}, { minX: -1, minY: -1, maxX: 1, maxY: 1 })[0].folderLinks).toBe(a.folderLinks)
    atlas.pin('b', 110, 20)
    expect(atlas.viewport({}, { minX: -1, minY: -1, maxX: 1, maxY: 1 })[0].folderLinks).toEqual([{ id: 'b', x: 110, y: 20 }])
    db.db.prepare('DELETE FROM files WHERE id=?').run('b'); sync()
    expect(atlas.viewport({}, { minX: -1, minY: -1, maxX: 1, maxY: 1 })[0].folderLinks).toEqual([{ id: 'c', x: 200, y: 0 }])
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
  it('finds nested folder paths and visible heading/source aliases with scoped ranking after reopening an existing index', () => {
    const source = db.getOrCreateGalaxy('/vault', 'Personal inbox'), other = db.getOrCreateGalaxy('/other', 'Other')
    db.upsert(fixture('direct', { path: '/vault/Incoming/notes.md', name: 'notes.md', galaxyId: source.id }))
    db.upsert(fixture('nested', { path: '/vault/Incoming/2026/draft.md', name: 'draft.md', galaxyId: source.id }))
    db.upsert(fixture('filename', { path: '/vault/Archive/Incoming', name: 'Incoming', galaxyId: source.id }))
    db.upsert(fixture('excluded', { path: '/other/Incoming/private.md', name: 'private.md', galaxyId: other.id }))
    sync()
    atlas.setText('direct', 'Preserved extracted text', 'ready', '2:100')
    atlas.pin('direct', 123, 456); atlas.favorite('direct', true, 'black-hole')
    const savedFiles = db.db.prepare('SELECT * FROM files ORDER BY id').all(), savedPositions = db.db.prepare('SELECT * FROM atlas_positions ORDER BY id').all()
    const savedDocuments = db.db.prepare('SELECT * FROM atlas_documents ORDER BY id').all()
    atlas = new AtlasStore(db)
    const scope = { galaxyIds: [source.id] }
    expect(atlas.lexical('Incoming', scope, 10).map(hit => hit.file.id)).toEqual(['filename', 'direct', 'nested'])
    expect(atlas.lexical('Incoming', scope, 10).map(hit => hit.reason)).toEqual(['name', 'path', 'path'])
    expect(atlas.lexical('incoming/2026', scope, 10).map(hit => hit.file.id)).toEqual(['nested'])
    expect(atlas.lexical('Personal inbox', scope, 10).map(hit => hit.file.id).sort()).toEqual(['direct', 'filename', 'nested'])
    const region = atlas.file('direct')!.regionId
    atlas.renameRegion(region, 'Review queue')
    expect(atlas.lexical('Review queue', scope, 10).map(hit => hit.file.id).sort()).toEqual(['direct', 'nested'])
    expect(atlas.lexical('Review queue', scope, 10)[0].snippet).toContain('Atlas label match for “Review queue”')
    expect(atlas.lexical('Incoming', { galaxyIds: [] }, 10)).toEqual([])
    expect(atlas.lexical('Incoming', { ...scope, category: 'media' }, 10)).toEqual([])
    expect(atlas.lexical('Incoming', { galaxyIds: [other.id] }, 1)[0].file.id).toBe('excluded')
    expect(db.db.prepare('SELECT * FROM files ORDER BY id').all()).toEqual(savedFiles)
    expect(db.db.prepare('SELECT * FROM atlas_positions ORDER BY id').all()).toEqual(savedPositions)
    expect(db.db.prepare('SELECT * FROM atlas_documents ORDER BY id').all()).toEqual(savedDocuments)
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

  it('uses real file coordinates and identities in filtered, bounded overview markers', () => {
    for (let i = 0; i < 120; i++) db.upsert(fixture(`note-${i}`))
    db.upsert(fixture('image', { category: 'media', mimeType: 'image/png' })); sync()
    const markers = atlas.summary().markers!
    expect(markers.length).toBe(121)
    for (const marker of markers) {
      const file = atlas.file(marker.id)!
      expect([marker.x, marker.y]).toEqual([file.x, file.y])
    }
    expect(atlas.summary({ category: 'media' }).markers!.map(m => m.id)).toEqual(['image'])
    atlas.pin('image', 60000, 90000)
    expect(atlas.summary().markers!.find(m => m.id === 'image')).toMatchObject({ x: 60000, y: 90000, type: 'nebula' })
  })

  it('reshapes only by explicit action, preserves pins, and snapshots restore the complete geometry', () => {
    const galaxy = db.getOrCreateGalaxy('/library', 'Library')
    for (let i = 0; i < 15; i++) db.upsert(fixture(`note-${i}`, { galaxyId: galaxy.id, path: `/library/folder-${i}/note.md` }))
    sync()
    // Simulate the previous grid without touching authoritative file records.
    db.db.exec('UPDATE atlas_regions SET x=x+5000,y=y-3000; UPDATE atlas_positions SET x=x+5000,natural_x=natural_x+5000,y=y-3000,natural_y=natural_y-3000')
    atlas.pin('note-3', 10101, -20202)
    const before = atlas.list({}, 0, 200).files, regions = atlas.summary().regions
    const originalMetadata = db.db.prepare('SELECT * FROM files ORDER BY id').all()
    const snapshot = atlas.reshapeOrganic()
    expect(atlas.file('note-3')).toMatchObject({ x: 10101, y: -20202, isPinned: true })
    expect(atlas.file('note-4')!.x).not.toBe(before.find(f => f.id === 'note-4')!.x)
    expect(db.db.prepare('SELECT * FROM files ORDER BY id').all()).toEqual(originalMetadata)
    const newPositions = atlas.list({}, 0, 200).files
    new AtlasStore(db).syncBatch()
    expect(atlas.list({}, 0, 200).files).toEqual(newPositions)
    atlas.restore(snapshot)
    expect(atlas.summary().regions).toEqual(regions)
    expect(atlas.list({}, 0, 200).files).toEqual(before)
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

it('generates safe literal FTS expressions', () => {
  expect(ftsQuery('foo OR bar*')).toBe('"foo"* AND "OR"* AND "bar"*')
  expect(ftsQuery('"two words"')).toBe('"two words"')
  expect(chunkText('a'.repeat(9000)).at(-1)?.offset).toBe(7400)
})
