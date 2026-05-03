import { describe, it, expect } from 'vitest'
import {
  computePercentileBuckets,
  usageStarType,
} from '../../src/renderer/src/components/StarMap/usageStarType'

describe('computePercentileBuckets', () => {
  it('returns all-zero on empty input', () => {
    const b = computePercentileBuckets([])
    expect(b.p50).toBe(0)
    expect(b.p80).toBe(0)
    expect(b.p95).toBe(0)
  })

  it('returns the single score on length-1 input', () => {
    const b = computePercentileBuckets([42])
    expect(b.p50).toBe(42)
    expect(b.p80).toBe(42)
    expect(b.p95).toBe(42)
  })

  it('sorts before bucketing', () => {
    // Same data, two orderings: result must be identical.
    const a = computePercentileBuckets([10, 1, 5, 100, 50])
    const b = computePercentileBuckets([100, 50, 10, 5, 1])
    expect(a).toEqual(b)
  })

  it('matches the floor-index semantic on a known corpus', () => {
    // 10 sorted scores: indexes 0..9 -> values 1..10
    // p=0.5 -> idx = floor(10*0.5) = 5 -> sorted[5] = 6
    // p=0.8 -> idx = floor(10*0.8) = 8 -> sorted[8] = 9
    // p=0.95 -> idx = floor(10*0.95) = 9 -> sorted[9] = 10
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const b = computePercentileBuckets(scores)
    expect(b.p50).toBe(6)
    expect(b.p80).toBe(9)
    expect(b.p95).toBe(10)
  })
})

describe('usageStarType', () => {
  const buckets = { p50: 6, p80: 9, p95: 10 }

  it('classifies bottom 50% as white-dwarf', () => {
    expect(usageStarType(0, buckets)).toBe('white-dwarf')
    expect(usageStarType(3, buckets)).toBe('white-dwarf')
    expect(usageStarType(6, buckets)).toBe('white-dwarf')  // boundary -> lower
  })

  it('classifies 50-80% as main-sequence', () => {
    expect(usageStarType(7, buckets)).toBe('main-sequence')
    expect(usageStarType(8, buckets)).toBe('main-sequence')
    expect(usageStarType(9, buckets)).toBe('main-sequence')  // boundary -> lower
  })

  it('classifies 80-95% as red-giant', () => {
    expect(usageStarType(9.5, buckets)).toBe('red-giant')
    expect(usageStarType(10, buckets)).toBe('red-giant')  // boundary -> lower
  })

  it('classifies top 5% as blue-supergiant', () => {
    expect(usageStarType(11, buckets)).toBe('blue-supergiant')
    expect(usageStarType(1000, buckets)).toBe('blue-supergiant')
  })

  it('all-zero corpus -> all white-dwarf (single-file / freshly-indexed sky)', () => {
    const buckets = computePercentileBuckets([0, 0, 0, 0, 0])
    expect(buckets.p50).toBe(0)
    expect(usageStarType(0, buckets)).toBe('white-dwarf')
  })

  it('handles negative scores by parking them in the bottom bucket', () => {
    expect(usageStarType(-5, buckets)).toBe('white-dwarf')
  })
})
