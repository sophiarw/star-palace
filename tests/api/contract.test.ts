import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { EMBED_DIM } from '../../src/shared/types'

// Must stub fetch + DB BEFORE importing daemon to avoid real FS side effects
vi.stubGlobal('fetch', vi.fn())

// Use in-memory DB and no-persist HNSW for tests
process.env.STARPALACE_DB = ':memory:'
process.env.STARPALACE_DIR = '/tmp/star-palace-test'

import { app, db, hnsw } from '../../src/daemon/index'

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

  // Seed a few files
  for (let i = 0; i < 5; i++) {
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
    })
    hnsw.addPoint(emb, `seed${i}`)
  }
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
