import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaClient, cosine, normalizeEmbedding } from '../../src/daemon/embedding/OllamaClient'
import { EmbeddingEngine } from '../../src/daemon/embedding/EmbeddingEngine'
import { EMBED_DIM } from '../../src/shared/types'

function makeEmbedding(dim = EMBED_DIM, seed = 1.0): Float32Array {
  const v = new Float32Array(dim)
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i * seed)
  return v
}

describe('OllamaClient (mocked fetch)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('embed returns Float32Array of correct dim', async () => {
    const vec = makeEmbedding()
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: Array.from(vec) }),
    } as Response)

    const client = new OllamaClient()
    const result = await client.embed('hello world')
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(EMBED_DIM)
    expect(result[0]).toBeCloseTo(vec[0])
  })

  it('embed throws on non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'service unavailable',
    } as Response)

    const client = new OllamaClient()
    await expect(client.embed('test')).rejects.toThrow('503')
  })

  it('embedBatch returns array of embeddings', async () => {
    for (let i = 0; i < 3; i++) {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: Array.from(makeEmbedding(EMBED_DIM, i + 1)) }),
      } as Response)
    }

    const client = new OllamaClient({ concurrency: 8 })
    const results = await client.embedBatch(['a', 'b', 'c'])
    expect(results).toHaveLength(3)
    for (const r of results) expect(r).toBeInstanceOf(Float32Array)
  })
})

describe('cosine similarity', () => {
  it('identical vectors = 1.0', () => {
    const v = makeEmbedding()
    expect(cosine(v, v)).toBeCloseTo(1.0)
  })

  it('orthogonal vectors = 0', () => {
    const a = new Float32Array(4).fill(0)
    const b = new Float32Array(4).fill(0)
    a[0] = 1
    b[1] = 1
    expect(cosine(a, b)).toBeCloseTo(0)
  })

  it('zero vector = 0', () => {
    const a = new Float32Array(4).fill(0)
    const b = makeEmbedding(4)
    expect(cosine(a, b)).toBe(0)
  })
})

describe('normalizeEmbedding', () => {
  it('produces unit vector', () => {
    const v = makeEmbedding(4, 2.5)
    const n = normalizeEmbedding(v)
    const norm = Math.sqrt(n.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1.0)
  })
})

describe('EmbeddingEngine', () => {
  it('returns null for media files', async () => {
    const client = new OllamaClient()
    const engine = new EmbeddingEngine(client)
    const node = {
      id: 'x', name: 'img.png', path: '/img.png', platform: 'local' as const,
      mimeType: 'image/png', category: 'media' as const,
      size: 1000, createdAt: 0, modifiedAt: 0,
    }
    const result = await engine.embedFile(node, Buffer.alloc(0))
    expect(result).toBeNull()
  })

  it('returns null for empty content', async () => {
    const client = new OllamaClient()
    const engine = new EmbeddingEngine(client)
    const node = {
      id: 'x', name: 'empty.md', path: '/empty.md', platform: 'local' as const,
      mimeType: 'text/markdown', category: 'document' as const,
      size: 0, createdAt: 0, modifiedAt: 0,
    }
    const result = await engine.embedFile(node, Buffer.from('   '))
    expect(result).toBeNull()
  })

  it('contentHash is deterministic', () => {
    const client = new OllamaClient()
    const engine = new EmbeddingEngine(client)
    const h1 = engine.contentHash(Buffer.from('hello'))
    const h2 = engine.contentHash(Buffer.from('hello'))
    expect(h1).toBe(h2)
    expect(h1).toHaveLength(40)  // sha1 hex
  })
})
