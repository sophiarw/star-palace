import { describe, it, expect } from 'vitest'
import { buildIgnoreMatcher } from '../../src/daemon/index/ignoreMatcher'

describe('buildIgnoreMatcher', () => {
  it('returns an inert matcher for empty source', () => {
    const m = buildIgnoreMatcher('')
    expect(m.active).toBe(false)
    expect(m.matches('/x/y/z.txt', '/x')).toBe(false)
    expect(m.matchesRelative('y/z.txt', false)).toBe(false)
  })

  it('treats whitespace-only source as inert', () => {
    expect(buildIgnoreMatcher('   \n\n  ').active).toBe(false)
  })

  it('matches a directory pattern (trailing slash) anywhere in the tree', () => {
    const m = buildIgnoreMatcher('node_modules/')
    expect(m.matchesRelative('node_modules/foo', false)).toBe(true)
    expect(m.matchesRelative('a/b/node_modules/lib/x.js', false)).toBe(true)
    expect(m.matchesRelative('src/main.ts', false)).toBe(false)
  })

  it('matches an extension glob', () => {
    const m = buildIgnoreMatcher('*.log')
    expect(m.matchesRelative('debug.log', false)).toBe(true)
    expect(m.matchesRelative('a/b/c.log', false)).toBe(true)
    expect(m.matchesRelative('a/b/c.txt', false)).toBe(false)
  })

  it('honors negation', () => {
    const m = buildIgnoreMatcher('vendor/**\n!vendor/keep.md')
    expect(m.matchesRelative('vendor/foo.js', false)).toBe(true)
    expect(m.matchesRelative('vendor/keep.md', false)).toBe(false)
  })

  it('matches() builds the relative path from absPath + root', () => {
    const m = buildIgnoreMatcher('build/')
    expect(m.matches('/repo/build/x.js', '/repo')).toBe(true)
    expect(m.matches('/repo/src/x.js', '/repo')).toBe(false)
  })

  it('matches() returns false when the path is outside the root', () => {
    const m = buildIgnoreMatcher('*.log')
    // /elsewhere/foo.log is not under /repo, so the rule should not apply
    // (caller would have used a different root for that file).
    expect(m.matches('/elsewhere/foo.log', '/repo')).toBe(false)
  })

  it('comments and blank lines are tolerated', () => {
    const m = buildIgnoreMatcher('# comment\n\n*.tmp\n\n# trailing\n')
    expect(m.active).toBe(true)
    expect(m.matchesRelative('a.tmp', false)).toBe(true)
  })
})
