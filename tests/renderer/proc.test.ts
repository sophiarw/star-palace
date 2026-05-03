import { describe, it, expect } from 'vitest'
import {
  seedFromId,
  rngRange,
  pickN,
  hash2,
  smoothNoise2D,
  fbm2D,
  buildRamp,
  mix,
  LRUSpriteCache,
} from '../../src/renderer/src/components/StarMap/proc'

describe('seedFromId', () => {
  it('is deterministic for the same id', () => {
    const a = seedFromId('star-x')
    const b = seedFromId('star-x')
    for (let i = 0; i < 50; i++) {
      expect(a()).toBe(b())
    }
  })

  it('produces different streams for different ids', () => {
    const a = seedFromId('star-1')
    const b = seedFromId('star-2')
    let identical = 0
    for (let i = 0; i < 100; i++) {
      if (a() === b()) identical++
    }
    // Two independent streams should not collide on > a couple of samples.
    expect(identical).toBeLessThan(5)
  })

  it('returns values in [0, 1)', () => {
    const rng = seedFromId('range-check')
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('rngRange stays inside requested bounds', () => {
    const rng = seedFromId('range')
    for (let i = 0; i < 200; i++) {
      const v = rngRange(rng, -7, 11)
      expect(v).toBeGreaterThanOrEqual(-7)
      expect(v).toBeLessThan(11)
    }
  })
})

describe('pickN', () => {
  it('returns n distinct elements when n <= arr.length', () => {
    const rng = seedFromId('pickN')
    const out = pickN([1, 2, 3, 4, 5], 3, rng)
    expect(out).toHaveLength(3)
    expect(new Set(out).size).toBe(3)
    for (const v of out) expect([1, 2, 3, 4, 5]).toContain(v)
  })

  it('caps at arr.length when n > arr.length', () => {
    const rng = seedFromId('pickN-cap')
    const out = pickN(['a', 'b'], 5, rng)
    expect(out).toHaveLength(2)
    expect(new Set(out).size).toBe(2)
  })
})

describe('hash2 / smoothNoise2D / fbm2D', () => {
  it('hash2 returns float in [0, 1) and is deterministic', () => {
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        const v = hash2(x, y, 17)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
        expect(hash2(x, y, 17)).toBe(v)  // deterministic
      }
    }
  })

  it('hash2 distribution covers both halves of the unit interval', () => {
    let lo = 0, hi = 0
    for (let i = 0; i < 256; i++) {
      const v = hash2(i, i * 7 + 3, 0)
      if (v < 0.5) lo++
      else hi++
    }
    expect(lo).toBeGreaterThan(64)
    expect(hi).toBeGreaterThan(64)
  })

  it('smoothNoise2D stays inside [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 100 - 50
      const y = Math.random() * 100 - 50
      const v = smoothNoise2D(x, y, 42)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('fbm2D stays inside [0, 1]', () => {
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 10 - 5
      const y = Math.random() * 10 - 5
      const v = fbm2D(x, y, 5, 2.0, 0.5, 7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('buildRamp', () => {
  it('maps clamped density to expected stops', () => {
    const ramp = buildRamp([
      { d: 0.0, rgba: [0, 0, 0, 0] },
      { d: 1.0, rgba: [255, 255, 255, 255] },
    ])
    expect(ramp(-1)).toEqual([0, 0, 0, 0])
    expect(ramp(2)).toEqual([255, 255, 255, 255])
    const mid = ramp(0.5)
    expect(mid[0]).toBeCloseTo(127.5)
    expect(mid[3]).toBeCloseTo(127.5)
  })
})

describe('mix', () => {
  it('blends RGB triples by t', () => {
    expect(mix([0, 0, 0], [10, 20, 30], 0)).toEqual([0, 0, 0])
    expect(mix([0, 0, 0], [10, 20, 30], 1)).toEqual([10, 20, 30])
    expect(mix([0, 0, 0], [10, 20, 30], 0.5)).toEqual([5, 10, 15])
  })
})

describe('LRUSpriteCache', () => {
  // Stub canvas object — proc.ts doesn't actually inspect it, only stores it.
  const stub = (label: string): HTMLCanvasElement =>
    ({ tag: label } as unknown as HTMLCanvasElement)

  it('evicts the oldest entry past cap', () => {
    const c = new LRUSpriteCache<string>(3)
    c.set('a', stub('A'))
    c.set('b', stub('B'))
    c.set('c', stub('C'))
    c.set('d', stub('D'))  // evicts 'a'
    expect(c.size()).toBe(3)
    expect(c.get('a')).toBeNull()
    expect(c.get('b')).not.toBeNull()
    expect(c.get('c')).not.toBeNull()
    expect(c.get('d')).not.toBeNull()
  })

  it('get() refreshes recency: gotten key survives an eviction round', () => {
    const c = new LRUSpriteCache<string>(3)
    c.set('a', stub('A'))
    c.set('b', stub('B'))
    c.set('c', stub('C'))
    c.get('a')             // 'a' becomes MRU
    c.set('d', stub('D'))  // should evict 'b' (now oldest), not 'a'
    expect(c.get('a')).not.toBeNull()
    expect(c.get('b')).toBeNull()
  })

  it('set() of an existing key updates value + moves to MRU', () => {
    const c = new LRUSpriteCache<string>(2)
    c.set('a', stub('A1'))
    c.set('b', stub('B'))
    c.set('a', stub('A2'))  // 'a' becomes MRU; value replaced
    c.set('c', stub('C'))   // evicts 'b'
    expect(c.get('b')).toBeNull()
    expect(c.get('a')).not.toBeNull()
    expect(c.get('c')).not.toBeNull()
  })

  it('clear() empties the cache', () => {
    const c = new LRUSpriteCache<string>(5)
    c.set('a', stub('A'))
    c.set('b', stub('B'))
    c.clear()
    expect(c.size()).toBe(0)
    expect(c.get('a')).toBeNull()
  })
})
