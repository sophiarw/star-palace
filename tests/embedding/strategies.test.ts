import { describe, it, expect } from 'vitest'
import { STRATEGIES, DEFAULT_STRATEGY, isStrategyId } from '../../src/daemon/embedding/strategies'
import type { FileNode } from '../../src/shared/types'

function makeNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    id: 'n1',
    name: 'note.md',
    path: '/Users/jane/projects/notes/note.md',
    platform: 'local',
    mimeType: 'text/markdown',
    category: 'document',
    size: 42,
    createdAt: 1_700_000_000_000,
    // 2024-01-01T00:00:00Z — exercises the date formatter at a known boundary
    modifiedAt: 1_704_067_200_000,
    ...overrides,
  }
}

describe('strategies registry', () => {
  it('default strategy id is content-only', () => {
    expect(DEFAULT_STRATEGY).toBe('content-only')
  })

  it('isStrategyId accepts all five ids and rejects others', () => {
    for (const id of Object.keys(STRATEGIES)) {
      expect(isStrategyId(id)).toBe(true)
    }
    expect(isStrategyId('nope')).toBe(false)
    expect(isStrategyId(null)).toBe(false)
    expect(isStrategyId(undefined)).toBe(false)
    expect(isStrategyId(123)).toBe(false)
  })
})

describe('content-only strategy', () => {
  const s = STRATEGIES['content-only']

  it('returns the raw text for a markdown doc', () => {
    const node = makeNode()
    const out = s.build({ node, content: Buffer.from('# Hello world\n\nbody'), tags: null })
    expect(out).toBe('# Hello world\n\nbody')
  })

  it('returns null for media files', () => {
    const node = makeNode({ category: 'media', mimeType: 'image/png', name: 'img.png' })
    const out = s.build({ node, content: Buffer.from([0xff, 0xd8]), tags: null })
    expect(out).toBeNull()
  })

  it('returns null for empty / whitespace-only content', () => {
    const node = makeNode()
    expect(s.build({ node, content: Buffer.alloc(0), tags: null })).toBeNull()
    expect(s.build({ node, content: Buffer.from('   \n\t '), tags: null })).toBeNull()
  })
})

describe('metadata-only strategy', () => {
  const s = STRATEGIES['metadata-only']

  it('emits the standard six-line block for a normal document', () => {
    const node = makeNode()
    const out = s.build({ node, content: Buffer.from('ignored'), tags: null })
    expect(out).toBe(
      [
        'filename: note.md',
        'parent: projects/notes',
        'ext: md',
        'mime: text/markdown',
        'size: 42 bytes',
        'modified: 2024-01-01',
      ].join('\n')
    )
  })

  it('still emits metadata for media files (never returns null)', () => {
    const node = makeNode({
      category: 'media',
      mimeType: 'image/png',
      name: 'img.png',
      path: '/Users/jane/photos/2024/img.png',
      size: 12345,
    })
    const out = s.build({ node, content: Buffer.alloc(0), tags: null })
    expect(out).toContain('filename: img.png')
    expect(out).toContain('parent: photos/2024')
    expect(out).toContain('ext: png')
    expect(out).toContain('mime: image/png')
    expect(out).toContain('size: 12345 bytes')
  })

  it('handles paths with no parent ancestors', () => {
    const node = makeNode({ path: '/loose.md', name: 'loose.md' })
    const out = s.build({ node, content: Buffer.from('x'), tags: null }) as string
    expect(out).toContain('filename: loose.md')
    expect(out).toMatch(/parent: ?$/m)
  })
})

describe('metadata+content strategy', () => {
  const s = STRATEGIES['metadata+content']

  it('joins metadata then content with a divider', () => {
    const node = makeNode()
    const out = s.build({ node, content: Buffer.from('# Title\nBody'), tags: null })
    expect(out).toBe(
      [
        'filename: note.md',
        'parent: projects/notes',
        'ext: md',
        'mime: text/markdown',
        'size: 42 bytes',
        'modified: 2024-01-01',
        '---',
        'content:',
        '# Title',
        'Body',
      ].join('\n')
    )
  })

  it('returns metadata only for media files (no content section)', () => {
    const node = makeNode({ category: 'media', mimeType: 'image/png', name: 'img.png' })
    const out = s.build({ node, content: Buffer.from([0xff]), tags: null }) as string
    expect(out).not.toContain('---')
    expect(out).not.toContain('content:')
    expect(out).toContain('filename: img.png')
  })

  it('returns metadata only when content is empty / whitespace', () => {
    const node = makeNode()
    const out = s.build({ node, content: Buffer.from('   '), tags: null }) as string
    expect(out).not.toContain('---')
    expect(out).toContain('filename: note.md')
  })
})

describe('tags+metadata+content strategy', () => {
  const s = STRATEGIES['tags+metadata+content']

  it('prepends a tags line when tags are present', () => {
    const node = makeNode()
    const out = s.build({
      node,
      content: Buffer.from('body'),
      tags: ['research', 'pinned'],
    })
    expect(out?.startsWith('tags: research, pinned\n')).toBe(true)
    expect(out).toContain('filename: note.md')
    expect(out).toContain('content:\nbody')
  })

  it('falls through to metadata+content when tags is null', () => {
    const node = makeNode()
    const tagged = s.build({ node, content: Buffer.from('body'), tags: null })
    const fallback = STRATEGIES['metadata+content'].build({ node, content: Buffer.from('body'), tags: null })
    expect(tagged).toBe(fallback)
  })

  it('falls through to metadata+content when tags is empty', () => {
    const node = makeNode()
    const tagged = s.build({ node, content: Buffer.from('body'), tags: [] })
    const fallback = STRATEGIES['metadata+content'].build({ node, content: Buffer.from('body'), tags: [] })
    expect(tagged).toBe(fallback)
  })
})

describe('sampled-stats+metadata strategy', () => {
  const s = STRATEGIES['sampled-stats+metadata']

  it('emits a numeric summary for a tiny numeric file (data_subjectX_DayY.txt shape)', () => {
    const node = makeNode({
      name: 'data_subject7_Day3.txt',
      path: '/Users/jane/exp/data/data_subject7_Day3.txt',
      mimeType: 'text/plain',
      category: 'data',
      size: 25,
    })
    const out = s.build({
      node,
      content: Buffer.from('1.0 2.0 3.0 4.0 5.0'),
      tags: null,
    }) as string
    expect(out).toContain('filename: data_subject7_Day3.txt')
    expect(out).toContain('parent: exp/data')
    expect(out).toContain('numeric_summary: n=5 min=1 max=5 mean=3 std=')
    expect(out).toContain('raw: 1, 2, 3, 4, 5')
  })

  it('falls back to metadata+content for non-numeric prose', () => {
    const node = makeNode()
    const text = 'This is prose with no consistent numerics — see notes.'
    const out = s.build({ node, content: Buffer.from(text), tags: null })
    const fallback = STRATEGIES['metadata+content'].build({ node, content: Buffer.from(text), tags: null })
    expect(out).toBe(fallback)
  })

  it('falls back when fewer than 3 numeric tokens', () => {
    const node = makeNode()
    const out = s.build({ node, content: Buffer.from('1 2'), tags: null }) as string
    expect(out).not.toContain('numeric_summary')
  })

  it('falls back when total token count is too high (≥ 50)', () => {
    const node = makeNode()
    const big = Array.from({ length: 60 }, (_, i) => i).join(' ')
    const out = s.build({ node, content: Buffer.from(big), tags: null }) as string
    expect(out).not.toContain('numeric_summary')
  })

  it('returns null for an empty file (falls through to metadata+content -> metadata)', () => {
    const node = makeNode()
    const out = s.build({ node, content: Buffer.alloc(0), tags: null }) as string
    // metadata+content with empty body returns just the metadata block, not null
    expect(out).toContain('filename: note.md')
    expect(out).not.toContain('numeric_summary')
  })
})
