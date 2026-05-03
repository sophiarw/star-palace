import { describe, it, expect } from 'vitest'
import { jitterFor, JITTER_RADIUS_WORLD } from '../../src/daemon/layout/jitter'

describe('jitterFor', () => {
  it('is deterministic', () => {
    expect(jitterFor('abc')).toEqual(jitterFor('abc'))
    expect(jitterFor('file:42')).toEqual(jitterFor('file:42'))
  })

  it('returns distinct offsets for distinct ids', () => {
    expect(jitterFor('a')).not.toEqual(jitterFor('b'))
    expect(jitterFor('file:1')).not.toEqual(jitterFor('file:2'))
  })

  it('stays within the disk of radius JITTER_RADIUS_WORLD', () => {
    for (let i = 0; i < 5000; i++) {
      const [dx, dy] = jitterFor(`id-${i}`)
      const r = Math.hypot(dx, dy)
      expect(r).toBeLessThanOrEqual(JITTER_RADIUS_WORLD + 1e-9)
    }
  })

  it('spreads ids across the disk (no severe clumping)', () => {
    // Bin into a 6×6 grid covering the bounding square of the disk; require
    // most cells to be hit by 1000 ids. With perfect uniformity each cell
    // gets ~28 hits; we just want to rule out catastrophic collapse.
    const buckets = new Map<string, number>()
    const N = 1000
    for (let i = 0; i < N; i++) {
      const [dx, dy] = jitterFor(`id-${i}`)
      const bx = Math.floor(((dx + JITTER_RADIUS_WORLD) / (2 * JITTER_RADIUS_WORLD)) * 6)
      const by = Math.floor(((dy + JITTER_RADIUS_WORLD) / (2 * JITTER_RADIUS_WORLD)) * 6)
      const key = `${bx},${by}`
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    // 6×6 = 36 cells; the disk only covers ~π/4 ≈ 28 of them.
    expect(buckets.size).toBeGreaterThan(20)
  })
})
