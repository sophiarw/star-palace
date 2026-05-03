import { describe, it, expect } from 'vitest'
import { convexHull, type Pt } from '../../src/renderer/src/components/StarMap/convexHull'

describe('convexHull', () => {
  it('returns [] for zero points', () => {
    expect(convexHull([])).toEqual([])
  })

  it('returns the single point for one input', () => {
    const pts: Pt[] = [[1, 2]]
    expect(convexHull(pts)).toEqual([[1, 2]])
  })

  it('returns both points for two inputs', () => {
    const pts: Pt[] = [[3, 4], [1, 2]]
    const h = convexHull(pts)
    expect(h).toHaveLength(2)
    // Sorted lexicographically by x then y
    expect(h[0]).toEqual([1, 2])
    expect(h[1]).toEqual([3, 4])
  })

  it('returns endpoint pair for collinear inputs', () => {
    const pts: Pt[] = [[0, 0], [1, 1], [2, 2], [3, 3]]
    const h = convexHull(pts)
    expect(h).toHaveLength(2)
    expect(h.find(p => p[0] === 0 && p[1] === 0)).toBeDefined()
    expect(h.find(p => p[0] === 3 && p[1] === 3)).toBeDefined()
  })

  it('returns the four corners for an axis-aligned square (interior dropped)', () => {
    const pts: Pt[] = [
      [0, 0], [1, 0], [1, 1], [0, 1],
      [0.5, 0.5],  // interior
    ]
    const h = convexHull(pts)
    expect(h).toHaveLength(4)
    const xs = h.map(p => p[0]).sort()
    const ys = h.map(p => p[1]).sort()
    expect(xs).toEqual([0, 0, 1, 1])
    expect(ys).toEqual([0, 0, 1, 1])
  })

  it('orientation is counter-clockwise (positive signed area)', () => {
    const pts: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
    const h = convexHull(pts)
    let area = 0
    for (let i = 0; i < h.length; i++) {
      const a = h[i]
      const b = h[(i + 1) % h.length]
      area += (a[0] * b[1] - b[0] * a[1])
    }
    expect(area / 2).toBeGreaterThan(0)
  })

  it('handles a 100-point random cloud (hull subset of input)', () => {
    let s = 12345 >>> 0
    const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000 }
    const pts: Pt[] = []
    for (let i = 0; i < 100; i++) pts.push([rand() * 1000 - 500, rand() * 1000 - 500])
    const h = convexHull(pts)
    expect(h.length).toBeGreaterThanOrEqual(3)
    expect(h.length).toBeLessThanOrEqual(pts.length)
    // every hull vertex came from the input set
    const set = new Set(pts.map(p => `${p[0]},${p[1]}`))
    for (const hp of h) expect(set.has(`${hp[0]},${hp[1]}`)).toBe(true)
  })
})
