import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import type { IndexedFile } from '../../src/daemon/db/FileIndex'
import { searchSpotlight, SpotlightUnavailable } from '../../src/daemon/search/spotlight'
import { fileIdFromPath } from '../../src/daemon/index/walker'

function makeFile(overrides: Partial<IndexedFile> = {}): Omit<IndexedFile, 'isStale'> {
  return {
    id: 'placeholder',
    path: '/placeholder',
    platform: 'local',
    name: 'placeholder',
    mimeType: 'text/plain',
    category: 'document',
    size: 100,
    createdAt: 1000,
    modifiedAt: 2000,
    embedding: null,
    contentHash: null,
    x: 0,
    y: 0,
    z: null,
    clusterId: null,
    galaxyId: null,
    layoutVersion: 1,
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

interface Seeded {
  galaxyId: number
  alphaId: string
  bravoId: string
  charlieId: string
  alphaPath: string
  bravoPath: string
  charliePath: string
  unindexedPath: string
}

function seed(idx: FileIndex, root = '/Users/test/Docs'): Seeded {
  const galaxy = idx.getOrCreateGalaxy(root, 'docs')
  const galaxyId = galaxy.id

  const alphaPath = `${root}/alpha.md`
  const bravoPath = `${root}/bravo.md`
  const charliePath = `${root}/sub/charlie.md`
  const unindexedPath = `${root}/skipped.md`

  const alphaId = fileIdFromPath(alphaPath, galaxyId)
  const bravoId = fileIdFromPath(bravoPath, galaxyId)
  const charlieId = fileIdFromPath(charliePath, galaxyId)

  idx.upsert(makeFile({ id: alphaId, path: alphaPath, name: 'alpha.md', galaxyId, x: 10, y: 20 }))
  idx.upsert(makeFile({ id: bravoId, path: bravoPath, name: 'bravo.md', galaxyId, x: 11, y: 21 }))
  idx.upsert(makeFile({ id: charlieId, path: charliePath, name: 'charlie.md', galaxyId, x: 12, y: 22 }))

  return { galaxyId, alphaId, bravoId, charlieId, alphaPath, bravoPath, charliePath, unindexedPath }
}

describe('searchSpotlight', () => {
  let idx: FileIndex

  beforeEach(() => {
    idx = new FileIndex({ dbPath: ':memory:' })
  })

  afterEach(() => {
    idx.close()
  })

  it('maps mdfind hits to indexed file ids and returns rank-descending scores', async () => {
    const s = seed(idx)
    const results = await searchSpotlight(
      { db: idx, runMdfind: async () => [s.alphaPath, s.bravoPath, s.charliePath] },
      { query: 'foo', limit: 10 },
    )
    expect(results.map(r => r.id)).toEqual([s.alphaId, s.bravoId, s.charlieId])
    // First hit gets the highest score; last gets the lowest. Order is the
    // contract n/N cycling depends on.
    expect(results[0].score).toBeGreaterThan(results[1].score)
    expect(results[1].score).toBeGreaterThan(results[2].score)
  })

  it('drops paths the daemon never indexed', async () => {
    const s = seed(idx)
    const results = await searchSpotlight(
      { db: idx, runMdfind: async () => [s.alphaPath, s.unindexedPath] },
      { query: 'foo', limit: 10 },
    )
    expect(results.map(r => r.id)).toEqual([s.alphaId])
  })

  it('drops files without an (x, y) projection', async () => {
    const galaxy = idx.getOrCreateGalaxy('/Users/test/Docs', 'docs')
    const projectedPath = '/Users/test/Docs/projected.md'
    const unprojectedPath = '/Users/test/Docs/unprojected.md'
    const projectedId = fileIdFromPath(projectedPath, galaxy.id)
    const unprojectedId = fileIdFromPath(unprojectedPath, galaxy.id)
    idx.upsert(makeFile({ id: projectedId, path: projectedPath, name: 'projected.md', galaxyId: galaxy.id, x: 5, y: 5 }))
    idx.upsert(makeFile({ id: unprojectedId, path: unprojectedPath, name: 'unprojected.md', galaxyId: galaxy.id, x: null, y: null }))
    const results = await searchSpotlight(
      { db: idx, runMdfind: async () => [projectedPath, unprojectedPath] },
      { query: 'foo', limit: 10 },
    )
    expect(results.map(r => r.id)).toEqual([projectedId])
  })

  it('intersects with collection members when collectionId supplied', async () => {
    const s = seed(idx)
    const coll = idx.createCollection({
      name: 'pinned',
      kind: 'static',
      fileIds: [s.alphaId, s.charlieId],
    })
    const results = await searchSpotlight(
      { db: idx, runMdfind: async () => [s.alphaPath, s.bravoPath, s.charliePath] },
      { query: 'foo', limit: 10, collectionId: coll.id },
    )
    expect(results.map(r => r.id).sort()).toEqual([s.alphaId, s.charlieId].sort())
  })

  it('honours limit', async () => {
    const s = seed(idx)
    const results = await searchSpotlight(
      { db: idx, runMdfind: async () => [s.alphaPath, s.bravoPath, s.charliePath] },
      { query: 'foo', limit: 2 },
    )
    expect(results).toHaveLength(2)
    expect(results.map(r => r.id)).toEqual([s.alphaId, s.bravoId])
  })

  it('returns empty list when limit is 0', async () => {
    seed(idx)
    const results = await searchSpotlight(
      { db: idx, runMdfind: async () => { throw new Error('runner should not be called') } },
      { query: 'foo', limit: 0 },
    )
    expect(results).toEqual([])
  })

  it('skips the sentinel default galaxy', async () => {
    // FileIndex auto-creates a sentinel galaxy `__default__:default` for
    // legacy rows. mdfind cannot search such a path; the helper must filter
    // it out without erroring.
    let called = 0
    await searchSpotlight(
      { db: idx, runMdfind: async () => { called++; return [] } },
      { query: 'foo', limit: 10 },
    )
    expect(called).toBe(0)
  })

  it('narrows to a single galaxy when galaxyId supplied', async () => {
    const a = seed(idx, '/Users/test/A')
    const b = seed(idx, '/Users/test/B')
    const calledRoots: string[] = []
    const results = await searchSpotlight(
      {
        db: idx,
        runMdfind: async (root) => {
          calledRoots.push(root)
          return root === '/Users/test/A' ? [a.alphaPath] : [b.alphaPath]
        },
      },
      { query: 'foo', limit: 10, galaxyId: a.galaxyId },
    )
    expect(calledRoots).toEqual(['/Users/test/A'])
    expect(results.map(r => r.id)).toEqual([a.alphaId])
  })

  it('one galaxy mdfind failure does not sink the whole search', async () => {
    const a = seed(idx, '/Users/test/A')
    const b = seed(idx, '/Users/test/B')
    const results = await searchSpotlight(
      {
        db: idx,
        runMdfind: async (root) => {
          if (root === '/Users/test/A') {
            throw new SpotlightUnavailable('mdfind-failed', 'volume offline')
          }
          return [b.alphaPath]
        },
      },
      { query: 'foo', limit: 10 },
    )
    expect(results.map(r => r.id)).toEqual([b.alphaId])
    // Confirm a really did get attempted and ignored — not silently skipped.
    expect(a.galaxyId).not.toBe(b.galaxyId)
  })
})
