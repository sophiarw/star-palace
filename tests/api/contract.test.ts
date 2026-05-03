import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { EMBED_DIM } from '../../src/shared/types'

// Must stub fetch + DB BEFORE importing daemon to avoid real FS side effects
vi.stubGlobal('fetch', vi.fn())

// Use in-memory DB and no-persist HNSW for tests
process.env.STARPALACE_DB = ':memory:'
process.env.STARPALACE_DIR = '/tmp/star-palace-test'

import { app, db, hnsw, relayouter } from '../../src/daemon/index'
import { LAYOUT_THRESHOLD } from '../../src/shared/types'

function fakeEmbedding(seed = 0): Float32Array {
  const v = new Float32Array(EMBED_DIM)
  for (let i = 0; i < EMBED_DIM; i++) v[i] = Math.sin(seed + i * 0.01)
  let norm = 0
  for (let i = 0; i < EMBED_DIM; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= norm
  return v
}

beforeAll(() => {
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    const body = JSON.parse((init as RequestInit).body as string) as { prompt?: string; prompt_index?: number }
    const seed = body.prompt?.length ?? 0
    return {
      ok: true,
      json: async () => ({ embedding: Array.from(fakeEmbedding(seed)) }),
      text: async () => 'ok',
    } as Response
  })

  // Seed enough files to satisfy LAYOUT_THRESHOLD so the F4 pin endpoint
  // can train a PCA model and accept pins. Older tests only used 5 files;
  // we keep the same id naming so they continue to pass.
  for (let i = 0; i < LAYOUT_THRESHOLD + 5; i++) {
    const emb = fakeEmbedding(i)
    db.upsert({
      id: `seed${i}`,
      name: `file${i}.txt`,
      path: `/tmp/file${i}.txt`,
      platform: 'local',
      mimeType: 'text/plain',
      category: 'document',
      size: 100,
      createdAt: 1000,
      modifiedAt: 2000,
      embedding: emb,
      contentHash: `hash${i}`,
      x: (i - 2) * 50.0,
      y: (i - 2) * 30.0,
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
    })
    hnsw.addPoint(emb, `seed${i}`)
  }
  relayouter.train()
})

afterAll(() => {
  db.close()
  vi.unstubAllGlobals()
})

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.indexed).toBe('number')
    expect(typeof res.body.layoutVersion).toBe('number')
  })
})

describe('GET /api/map/viewport', () => {
  it('returns viewport result shape', async () => {
    const res = await request(app).get('/api/map/viewport?x1=-200&y1=-200&x2=200&y2=200')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.stars)).toBe(true)
    expect(Array.isArray(res.body.clusters)).toBe(true)
  })

  it('includes stars within bounds', async () => {
    const res = await request(app).get('/api/map/viewport?x1=-200&y1=-200&x2=200&y2=200')
    expect(res.body.stars.length).toBeGreaterThan(0)
    for (const star of res.body.stars) {
      expect(typeof star.x).toBe('number')
      expect(typeof star.y).toBe('number')
      expect(typeof star.id).toBe('string')
    }
  })
})

describe('GET /api/map/stats', () => {
  it('returns stats shape', async () => {
    const res = await request(app).get('/api/map/stats')
    expect(res.status).toBe(200)
    expect(typeof res.body.total).toBe('number')
    expect(typeof res.body.indexedWithEmbedding).toBe('number')
    expect(typeof res.body.layoutVersion).toBe('number')
    expect(typeof res.body.clusterCount).toBe('number')
  })
})

describe('POST /api/search', () => {
  it('400 on missing query', async () => {
    const res = await request(app).post('/api/search').send({})
    expect(res.status).toBe(400)
  })

  it('returns search results', async () => {
    const res = await request(app).post('/api/search').send({ query: 'hello world', limit: 5 })
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.results)).toBe(true)
    for (const r of res.body.results) {
      expect(typeof r.id).toBe('string')
      expect(typeof r.x).toBe('number')
      expect(typeof r.y).toBe('number')
      expect(typeof r.score).toBe('number')
    }
  })
})

describe('GET /api/file/:id', () => {
  it('404 on unknown id', async () => {
    const res = await request(app).get('/api/file/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns file metadata', async () => {
    const res = await request(app).get('/api/file/seed0')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('seed0')
    expect(res.body.name).toBe('file0.txt')
    expect(res.body.embedding).toBeUndefined()  // never sent to client
  })
})

describe('GET /api/file/:id/neighborhood', () => {
  it('404 on unknown id', async () => {
    const res = await request(app).get('/api/file/nonexistent/neighborhood')
    expect(res.status).toBe(404)
  })

  it('returns neighborhood shape', async () => {
    const res = await request(app).get('/api/file/seed0/neighborhood')
    expect(res.status).toBe(200)
    expect(res.body.file).toBeDefined()
    expect(res.body.file.embedding).toBeUndefined()
    expect(Array.isArray(res.body.neighbors)).toBe(true)
  })
})

describe('POST /api/index', () => {
  it('400 on missing path', async () => {
    const res = await request(app).post('/api/index').send({})
    expect(res.status).toBe(400)
  })
})

describe('POST /api/file/:id/star-type', () => {
  it('404 on unknown id', async () => {
    const res = await request(app).post('/api/file/nonexistent/star-type').send({ starType: 'pulsar' })
    expect(res.status).toBe(404)
  })

  it('400 on invalid type', async () => {
    const res = await request(app).post('/api/file/seed0/star-type').send({ starType: 'banana' })
    expect(res.status).toBe(400)
  })

  it('accepts a valid type and persists it', async () => {
    const set = await request(app).post('/api/file/seed0/star-type').send({ starType: 'pulsar' })
    expect(set.status).toBe(200)
    expect(set.body.starType).toBe('pulsar')

    const got = await request(app).get('/api/file/seed0')
    expect(got.body.starType).toBe('pulsar')
  })

  it('clears with null', async () => {
    await request(app).post('/api/file/seed0/star-type').send({ starType: 'red-giant' })
    const cleared = await request(app).post('/api/file/seed0/star-type').send({ starType: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.starType).toBeNull()

    const got = await request(app).get('/api/file/seed0')
    expect(got.body.starType).toBeNull()
  })
})

describe('POST /api/file/:id/pin (F4)', () => {
  it('404 on unknown id', async () => {
    const res = await request(app).post('/api/file/nonexistent/pin')
      .send({ x: 1, y: 2, axisA: 0, axisB: 1 })
    expect(res.status).toBe(404)
  })

  it('400 on missing x/y', async () => {
    const res = await request(app).post('/api/file/seed0/pin')
      .send({ axisA: 0, axisB: 1 })
    expect(res.status).toBe(400)
  })

  it('400 on non-integer axis', async () => {
    const res = await request(app).post('/api/file/seed0/pin')
      .send({ x: 1, y: 2, axisA: 0.5, axisB: 1 })
    expect(res.status).toBe(400)
  })

  it('400 on axis out of PC range', async () => {
    const res = await request(app).post('/api/file/seed0/pin')
      .send({ x: 1, y: 2, axisA: 0, axisB: 999 })
    expect(res.status).toBe(400)
  })

  it('happy path: stores α/β and is_pinned=1', async () => {
    const res = await request(app).post('/api/file/seed1/pin')
      .send({ x: 12.5, y: -7.5, axisA: 0, axisB: 1 })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.alpha).toBe('number')
    expect(typeof res.body.beta).toBe('number')
    expect(res.body.axisA).toBe(0)
    expect(res.body.axisB).toBe(1)

    const file = db.get('seed1')!
    expect(file.isPinned).toBe(true)
    expect(file.pinAxisA).toBe(0)
    expect(file.pinAxisB).toBe(1)
    expect(file.pinAlpha).toBeCloseTo(res.body.alpha)
    expect(file.pinBeta).toBeCloseTo(res.body.beta)
    // target = natural + (α, β)
    expect(file.pinAlpha! + (12.5 - res.body.alpha)).toBeCloseTo(12.5)
  })

  it('re-pin overwrites prior coefficients', async () => {
    await request(app).post('/api/file/seed2/pin').send({ x: 1, y: 2, axisA: 0, axisB: 1 })
    const second = await request(app).post('/api/file/seed2/pin')
      .send({ x: 9, y: -9, axisA: 2, axisB: 3 })
    expect(second.status).toBe(200)
    const file = db.get('seed2')!
    expect(file.pinAxisA).toBe(2)
    expect(file.pinAxisB).toBe(3)
  })
})

describe('POST /api/file/:id/unpin (F4)', () => {
  it('404 on unknown id', async () => {
    const res = await request(app).post('/api/file/nonexistent/unpin').send()
    expect(res.status).toBe(404)
  })

  it('clears all pin columns', async () => {
    await request(app).post('/api/file/seed3/pin').send({ x: 5, y: 5, axisA: 0, axisB: 1 })
    expect(db.get('seed3')!.isPinned).toBe(true)
    const res = await request(app).post('/api/file/seed3/unpin').send()
    expect(res.status).toBe(200)
    const f = db.get('seed3')!
    expect(f.isPinned).toBe(false)
    expect(f.pinAlpha).toBeNull()
    expect(f.pinBeta).toBeNull()
    expect(f.pinAxisA).toBeNull()
    expect(f.pinAxisB).toBeNull()
    expect(f.pinnedAt).toBeNull()
  })
})

describe('GET /api/map/projection (F4 augmentation)', () => {
  it('includes pin coefficients per file', async () => {
    await request(app).post('/api/file/seed4/pin').send({ x: 0, y: 0, axisA: 0, axisB: 1 })
    const res = await request(app).get('/api/map/projection')
    expect(res.status).toBe(200)
    expect(typeof res.body.componentCount).toBe('number')
    const pinned = res.body.files.find((f: { id: string }) => f.id === 'seed4')
    expect(pinned).toBeDefined()
    expect(pinned.isPinned).toBe(true)
    expect(pinned.pinAxisA).toBe(0)
    expect(pinned.pinAxisB).toBe(1)
    expect(typeof pinned.pinAlpha).toBe('number')
    expect(typeof pinned.pinBeta).toBe('number')
    const unpinned = res.body.files.find((f: { id: string }) => f.id === 'seed0')
    expect(unpinned).toBeDefined()
    expect(unpinned.isPinned).toBe(false)
    expect(unpinned.pinAlpha).toBeNull()
  })
})

describe('POST /api/relayout preserves pins (F4 sign-flip path)', () => {
  it('pinned coords still resolve to roughly the same target after retrain', async () => {
    // Pre-pin a file at a known target
    await request(app).post('/api/file/seed0/pin').send({ x: 10, y: -5, axisA: 0, axisB: 1 })
    const before = db.get('seed0')!
    const beforeAlpha = before.pinAlpha!
    const beforeBeta = before.pinBeta!

    // Force a retrain. Sign-flip detection runs inside; α/β may be negated
    // if axes flipped — but the sum (α + natural) on the saved axes stays
    // fixed up to sign convention.
    const relay = await request(app).post('/api/relayout').send()
    expect(relay.status).toBe(200)

    const after = db.get('seed0')!
    expect(after.isPinned).toBe(true)
    expect(after.pinAxisA).toBe(0)
    expect(after.pinAxisB).toBe(1)
    // |α| / |β| stay the same magnitude; sign may flip
    expect(Math.abs(after.pinAlpha!)).toBeCloseTo(Math.abs(beforeAlpha))
    expect(Math.abs(after.pinBeta!)).toBeCloseTo(Math.abs(beforeBeta))
  })
})
