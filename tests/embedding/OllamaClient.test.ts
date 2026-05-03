import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaClient, normalizeEmbedding, truncateText } from '../../src/daemon/embedding/OllamaClient'
import { EmbeddingEngine } from '../../src/daemon/embedding/EmbeddingEngine'
import { EMBED_DIM, MAX_TEXT_BYTES } from '../../src/shared/types'

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

describe('normalizeEmbedding', () => {
  it('produces unit vector', () => {
    const v = makeEmbedding(4, 2.5)
    const n = normalizeEmbedding(v)
    const norm = Math.sqrt(n.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1.0)
  })
})

describe('truncateText', () => {
  it('returns input unchanged when under the byte limit', () => {
    const s = 'hello world'
    expect(truncateText(s)).toBe(s)
  })

  it('cuts ASCII strictly to MAX_TEXT_BYTES', () => {
    const s = 'a'.repeat(MAX_TEXT_BYTES + 100)
    const out = truncateText(s)
    expect(Buffer.byteLength(out, 'utf8')).toBe(MAX_TEXT_BYTES)
  })

  it('never bisects a multi-byte codepoint (emoji)', () => {
    const emoji = '😀'  // 4 bytes in UTF-8
    const s = emoji.repeat(Math.ceil(MAX_TEXT_BYTES / 4) + 10)
    const out = truncateText(s)
    const bytes = Buffer.byteLength(out, 'utf8')
    expect(bytes).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    // Decoding must be lossless — no replacement chars introduced
    expect(out).not.toContain('�')
    // Re-encoding the decoded string yields the same bytes
    expect(Buffer.from(out, 'utf8').length).toBe(bytes)
  })

  it('handles CJK script (3 bytes/char) cleanly', () => {
    const s = '中'.repeat(Math.ceil(MAX_TEXT_BYTES / 3) + 5)
    const out = truncateText(s)
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    expect(out).not.toContain('�')
  })

  it('cuts mixed ASCII + UTF-8 at a codepoint boundary', () => {
    const head = 'a'.repeat(MAX_TEXT_BYTES - 2)
    const tail = '😀😀😀'
    const out = truncateText(head + tail)
    expect(Buffer.byteLength(out, 'utf8')).toBeLessThanOrEqual(MAX_TEXT_BYTES)
    expect(out).not.toContain('�')
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

  it('embed returns a unit-norm vector', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const raw = makeEmbedding(EMBED_DIM, 1.7)
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: Array.from(raw) }),
    } as Response)

    const client = new OllamaClient()
    const engine = new EmbeddingEngine(client)
    const { embedding } = await engine.embed('hello')
    let norm = 0
    for (const v of embedding) norm += v * v
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 5)
    vi.unstubAllGlobals()
  })

  it('embed throws when Ollama returns wrong embedding dim', async () => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: new Array(EMBED_DIM - 1).fill(0.1) }),
    } as Response)

    const client = new OllamaClient()
    const engine = new EmbeddingEngine(client)
    await expect(engine.embed('hello')).rejects.toThrow(/expected embedding dim/i)
    vi.unstubAllGlobals()
  })
})
