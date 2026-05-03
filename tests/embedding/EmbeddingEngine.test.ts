import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaClient } from '../../src/daemon/embedding/OllamaClient'
import { EmbeddingEngine } from '../../src/daemon/embedding/EmbeddingEngine'
import { EMBED_DIM } from '../../src/shared/types'
import type { FileNode } from '../../src/shared/types'

function makeRandomEmbedding(seed = 1): Float32Array {
  const v = new Float32Array(EMBED_DIM)
  for (let i = 0; i < EMBED_DIM; i++) v[i] = Math.sin(i * seed)
  return v
}

function makeNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    id: 'n1',
    name: 'doc.md',
    path: '/Users/jane/projects/notes/doc.md',
    platform: 'local',
    mimeType: 'text/markdown',
    category: 'document',
    size: 100,
    createdAt: 1_700_000_000_000,
    modifiedAt: 1_704_067_200_000,
    ...overrides,
  }
}

describe('EmbeddingEngine.embed empty-prompt rejection', () => {
  let client: OllamaClient
  let engine: EmbeddingEngine

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    client = new OllamaClient()
    engine = new EmbeddingEngine(client)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws on empty string', async () => {
    await expect(engine.embed('')).rejects.toThrow(/empty|whitespace/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws on whitespace-only string', async () => {
    await expect(engine.embed('   \n\t  ')).rejects.toThrow(/empty|whitespace/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts a non-empty string and round-trips through fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: Array.from(makeRandomEmbedding(2)) }),
    } as Response)
    const result = await engine.embed('hello')
    expect(result.embedding).toBeInstanceOf(Float32Array)
    expect(result.contentHash).toHaveLength(40)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('EmbeddingEngine.embedFile strategy routing', () => {
  let client: OllamaClient
  let engine: EmbeddingEngine
  let lastPrompt: string | null

  beforeEach(() => {
    lastPrompt = null
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse((init as RequestInit).body as string) as { prompt: string }
      lastPrompt = body.prompt
      return {
        ok: true,
        json: async () => ({ embedding: Array.from(makeRandomEmbedding(3)) }),
      } as Response
    })
    client = new OllamaClient()
    engine = new EmbeddingEngine(client)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('default strategy (content-only) sends raw content as the prompt', async () => {
    const node = makeNode()
    const result = await engine.embedFile(node, Buffer.from('plain body text'))
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('content-only')
    expect(lastPrompt).toBe('plain body text')
  })

  it('default strategy returns null for media files', async () => {
    const node = makeNode({ category: 'media', mimeType: 'image/png', name: 'img.png' })
    const result = await engine.embedFile(node, Buffer.from([0xff, 0xd8]))
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('default strategy returns null for empty content (skips embed entirely)', async () => {
    const node = makeNode()
    const result = await engine.embedFile(node, Buffer.alloc(0))
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('metadata-only strategy sends the metadata block (works for media)', async () => {
    const node = makeNode({ category: 'media', mimeType: 'image/png', name: 'img.png' })
    const result = await engine.embedFile(node, Buffer.alloc(0), 'metadata-only')
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('metadata-only')
    expect(lastPrompt).toContain('filename: img.png')
    expect(lastPrompt).toContain('mime: image/png')
  })

  it('metadata+content strategy emits metadata header before raw content', async () => {
    const node = makeNode()
    const result = await engine.embedFile(
      node,
      Buffer.from('body line one\nbody line two'),
      'metadata+content'
    )
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('metadata+content')
    expect(lastPrompt).not.toBeNull()
    expect(lastPrompt!.startsWith('filename: doc.md')).toBe(true)
    expect(lastPrompt).toContain('---\ncontent:\nbody line one')
  })

  it('tags+metadata+content strategy threads tags into the prompt', async () => {
    const node = makeNode()
    const result = await engine.embedFile(
      node,
      Buffer.from('body'),
      'tags+metadata+content',
      ['research', 'q4']
    )
    expect(result).not.toBeNull()
    expect(result!.strategy).toBe('tags+metadata+content')
    expect(lastPrompt!.startsWith('tags: research, q4\n')).toBe(true)
    expect(lastPrompt).toContain('filename: doc.md')
  })

  it('records which strategy actually produced the vector on the result', async () => {
    const node = makeNode()
    const r1 = await engine.embedFile(node, Buffer.from('x'), 'content-only')
    const r2 = await engine.embedFile(node, Buffer.from('x'), 'metadata+content')
    expect(r1!.strategy).toBe('content-only')
    expect(r2!.strategy).toBe('metadata+content')
  })

  it('returns null without calling fetch when the strategy declines the file', async () => {
    // metadata+content for a media file falls through to metadata-only output,
    // which is non-null — so use content-only on media to verify the early-out.
    const node = makeNode({ category: 'media', mimeType: 'image/png', name: 'p.png' })
    const r = await engine.embedFile(node, Buffer.from([0xff]), 'content-only')
    expect(r).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
})
