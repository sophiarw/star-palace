// ThemeAwareSpriteCache eviction policy. Mirrors Report 4 §C.2.

import { describe, it, expect } from 'vitest'
import { ThemeAwareSpriteCache } from '../../src/renderer/src/components/StarMap/proc'

function fakeCanvas(side = 32): HTMLCanvasElement {
  // Stub — we only need width/height numbers for byte tracking.
  return { width: side, height: side } as unknown as HTMLCanvasElement
}

describe('ThemeAwareSpriteCache', () => {
  it('basic LRU get/set semantics', () => {
    const c = new ThemeAwareSpriteCache<string>(3, 1_000_000)
    c.setActiveTheme('jwst')
    c.set('a', fakeCanvas(), 'jwst')
    c.set('b', fakeCanvas(), 'jwst')
    c.set('c', fakeCanvas(), 'jwst')
    expect(c.size()).toBe(3)
    expect(c.get('a')).not.toBeNull()
    c.set('d', fakeCanvas(), 'jwst')  // evicts oldest = 'b' (a was just touched)
    expect(c.size()).toBe(3)
    expect(c.get('b')).toBeNull()
    expect(c.get('a')).not.toBeNull()
  })

  it('prefers non-active-theme victim on eviction', () => {
    const c = new ThemeAwareSpriteCache<string>(3, 1_000_000)
    c.setActiveTheme('vapor')
    // Old theme entries first, then new theme.
    c.set('jwst1', fakeCanvas(), 'jwst')
    c.set('jwst2', fakeCanvas(), 'jwst')
    c.set('vapor1', fakeCanvas(), 'vapor')
    expect(c.size()).toBe(3)
    // Now active theme = vapor; evict should land on a jwst entry.
    c.set('vapor2', fakeCanvas(), 'vapor')
    expect(c.size()).toBe(3)
    expect(c.get('vapor1')).not.toBeNull()
    expect(c.get('vapor2')).not.toBeNull()
    // One of jwst1/jwst2 was evicted — at least one is gone.
    const aliveJwst = (c.get('jwst1') ? 1 : 0) + (c.get('jwst2') ? 1 : 0)
    expect(aliveJwst).toBeLessThan(2)
  })

  it('falls back to plain LRU when no foreign-theme victim available', () => {
    const c = new ThemeAwareSpriteCache<string>(2, 1_000_000)
    c.setActiveTheme('jwst')
    c.set('a', fakeCanvas(), 'jwst')
    c.set('b', fakeCanvas(), 'jwst')
    c.set('c', fakeCanvas(), 'jwst')
    expect(c.size()).toBe(2)
    expect(c.get('a')).toBeNull()  // oldest evicted
  })

  it('enforces byte ceiling', () => {
    // 32×32×4 = 4096 bytes per sprite. Cap = 8192 = 2 sprites.
    const c = new ThemeAwareSpriteCache<string>(100, 8192)
    c.setActiveTheme('jwst')
    c.set('a', fakeCanvas(32), 'jwst')
    c.set('b', fakeCanvas(32), 'jwst')
    c.set('c', fakeCanvas(32), 'jwst')
    expect(c.size()).toBe(2)
    expect(c.bytes()).toBeLessThanOrEqual(8192)
  })

  it('clear resets size + bytes', () => {
    const c = new ThemeAwareSpriteCache<string>(10, 1_000_000)
    c.setActiveTheme('jwst')
    c.set('a', fakeCanvas(64), 'jwst')
    c.set('b', fakeCanvas(64), 'jwst')
    expect(c.size()).toBe(2)
    expect(c.bytes()).toBeGreaterThan(0)
    c.clear()
    expect(c.size()).toBe(0)
    expect(c.bytes()).toBe(0)
  })
})
