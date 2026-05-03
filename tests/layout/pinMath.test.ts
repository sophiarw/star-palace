import { describe, it, expect } from 'vitest'
import {
  solvePin,
  detectSignFlips,
  applyPinOffset,
  projectOnAxis,
  dotVectors,
} from '../../src/daemon/math/pinMath'

describe('solvePin', () => {
  it('round-trips: target == natural + (α, β)', () => {
    const natural: [number, number] = [3, -7]
    const target: [number, number] = [5, 2]
    const { alpha, beta } = solvePin(natural, target)
    expect(alpha).toBeCloseTo(2)
    expect(beta).toBeCloseTo(9)
    expect(natural[0] + alpha).toBeCloseTo(target[0])
    expect(natural[1] + beta).toBeCloseTo(target[1])
  })

  it('handles zero-natural (null embedding case): α = target', () => {
    const { alpha, beta } = solvePin([0, 0], [4.5, -1.2])
    expect(alpha).toBeCloseTo(4.5)
    expect(beta).toBeCloseTo(-1.2)
  })

  it('zero target gives offset that cancels natural', () => {
    const { alpha, beta } = solvePin([3, 4], [0, 0])
    expect(alpha).toBeCloseTo(-3)
    expect(beta).toBeCloseTo(-4)
  })
})

describe('applyPinOffset', () => {
  it('returns zero on both axes when neither active matches saved', () => {
    const { dx, dy } = applyPinOffset(2, 3, 0, 1, 4, 5)
    expect(dx).toBe(0)
    expect(dy).toBe(0)
  })

  it('returns (α, β) when active X==axisA and active Y==axisB (saved view)', () => {
    const { dx, dy } = applyPinOffset(2.5, -3.5, 0, 1, 0, 1)
    expect(dx).toBeCloseTo(2.5)
    expect(dy).toBeCloseTo(-3.5)
  })

  it('swaps to (β, α) when axes are swapped', () => {
    // Saved on axisA=0, axisB=1 with α=2.5, β=-3.5
    // User now views Y=0, X=1 → x-axis carries β, y-axis carries α
    const { dx, dy } = applyPinOffset(2.5, -3.5, 0, 1, 1, 0)
    expect(dx).toBeCloseTo(-3.5)
    expect(dy).toBeCloseTo(2.5)
  })

  it('only one axis matches: contributes only to that axis', () => {
    // Saved axisA=0, axisB=1; viewing X=0, Y=2 → x picks up α, y picks up nothing
    const { dx, dy } = applyPinOffset(2.5, -3.5, 0, 1, 0, 2)
    expect(dx).toBeCloseTo(2.5)
    expect(dy).toBe(0)
  })

  it('saved axis on Y only: pins shift y, not x', () => {
    // Saved axisA=2, axisB=3; viewing X=0, Y=2 → y picks up α, x picks up nothing
    const { dx, dy } = applyPinOffset(7, 9, 2, 3, 0, 2)
    expect(dx).toBe(0)
    expect(dy).toBeCloseTo(7)
  })
})

describe('detectSignFlips', () => {
  it('identical components: all +1', () => {
    const a = [[1, 0, 0], [0, 1, 0]]
    const flips = detectSignFlips(a, a)
    expect(flips).toEqual([1, 1])
  })

  it('exact sign-flip per axis: -1', () => {
    const oldC = [[1, 0, 0], [0, 1, 0]]
    const newC = [[-1, 0, 0], [0, -1, 0]]
    expect(detectSignFlips(oldC, newC)).toEqual([-1, -1])
  })

  it('mix of stable + flipped + unstable (orthogonal swap)', () => {
    const oldC = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    const newC = [
      [1, 0, 0],         // stable: +1
      [0, 0, 1],         // axis swapped → orthogonal to old → unstable: 0
      [0, 0, -1],        // anti-parallel to old axis-2's third dim → wait, dot([0,0,1], [0,0,-1]) = -1, perfect flip
    ]
    expect(detectSignFlips(oldC, newC)).toEqual([1, 0, -1])
  })

  it('handles uneven lengths gracefully (uses min)', () => {
    const oldC = [[1, 0]]
    const newC = [[1, 0], [0, 1]]
    expect(detectSignFlips(oldC, newC)).toEqual([1])
  })

  it('mostly aligned (dot ~ 0.99): treated as +1', () => {
    const oldC = [[1, 0]]
    // unit vector very close to [1,0]
    const newC = [[Math.cos(0.05), Math.sin(0.05)]]
    expect(detectSignFlips(oldC, newC)).toEqual([1])
  })

  it('borderline aligned (|dot| < 0.9): 0 (unstable)', () => {
    const oldC = [[1, 0]]
    // 30 degrees off → cos(30°) ≈ 0.866, just under threshold
    const newC = [[Math.cos(Math.PI / 6 + 0.01), Math.sin(Math.PI / 6 + 0.01)]]
    expect(detectSignFlips(oldC, newC)).toEqual([0])
  })
})

describe('projectOnAxis', () => {
  it('matches manual dot of (embedding - mean) and axis', () => {
    const emb = new Float32Array([2, 4, 6])
    const mean = [1, 1, 1]
    const axis = [1, 0, 0]
    expect(projectOnAxis(emb, axis, mean)).toBeCloseTo(1)  // (2-1)*1 + (4-1)*0 + (6-1)*0
  })

  it('returns 0 when axis is orthogonal to (embedding - mean)', () => {
    const emb = new Float32Array([3, 0])
    const mean = [0, 0]
    const axis = [0, 1]
    expect(projectOnAxis(emb, axis, mean)).toBe(0)
  })
})

describe('dotVectors', () => {
  it('orthogonal vectors return 0', () => {
    expect(dotVectors([1, 0, 0], [0, 1, 0])).toBe(0)
  })
  it('parallel unit vectors return 1', () => {
    expect(dotVectors([1, 0], [1, 0])).toBe(1)
  })
  it('anti-parallel unit vectors return -1', () => {
    expect(dotVectors([1, 0], [-1, 0])).toBe(-1)
  })
  it('Float32Array works the same', () => {
    expect(dotVectors(new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6]))).toBeCloseTo(32)
  })
})
