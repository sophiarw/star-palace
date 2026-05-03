import { describe, it, expect } from 'vitest'
import { galaxySpiralOffset } from '../../src/daemon/db/galaxySpiral'
import { GALAXY_SPIRAL_STEP } from '../../src/shared/types'

const S = GALAXY_SPIRAL_STEP

describe('galaxySpiralOffset', () => {
  it('places the first galaxy at the origin', () => {
    expect(galaxySpiralOffset(1)).toEqual([0, 0])
  })

  it('walks right-up-left-left-down-down-right-right-right…', () => {
    expect(galaxySpiralOffset(2)).toEqual([ 1 * S,  0])      // right 1
    expect(galaxySpiralOffset(3)).toEqual([ 1 * S,  1 * S])  // up    1
    expect(galaxySpiralOffset(4)).toEqual([ 0,      1 * S])  // left  2 (cell 1)
    expect(galaxySpiralOffset(5)).toEqual([-1 * S,  1 * S])  // left  2 (cell 2)
    expect(galaxySpiralOffset(6)).toEqual([-1 * S,  0])      // down  2 (cell 1)
    expect(galaxySpiralOffset(7)).toEqual([-1 * S, -1 * S])  // down  2 (cell 2)
    expect(galaxySpiralOffset(8)).toEqual([ 0,     -1 * S])  // right 3 (cell 1)
    expect(galaxySpiralOffset(9)).toEqual([ 1 * S, -1 * S])  // right 3 (cell 2)
    expect(galaxySpiralOffset(10)).toEqual([2 * S, -1 * S])  // right 3 (cell 3)
    expect(galaxySpiralOffset(11)).toEqual([2 * S,  0])      // up    3 (cell 1)
  })

  it('rejects non-positive or non-integer indices', () => {
    expect(() => galaxySpiralOffset(0)).toThrow()
    expect(() => galaxySpiralOffset(-1)).toThrow()
    expect(() => galaxySpiralOffset(1.5)).toThrow()
  })

  it('keeps every cell in the spiral unique for the first 50 slots', () => {
    const seen = new Set<string>()
    for (let i = 1; i <= 50; i++) {
      const [x, y] = galaxySpiralOffset(i)
      const key = `${x},${y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    expect(seen.size).toBe(50)
  })
})
