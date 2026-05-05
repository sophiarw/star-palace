import { describe, it, expect, beforeEach } from 'vitest'
import { mixLab, _resetLabMixForTests } from '../../src/daemon/embedding/labMix'
import { projectVectors, SUBSET_PCA_MIN } from '../../src/daemon/layout/Relayouter'
import { EMBED_DIM } from '../../src/shared/types'

function unitVec(seed: number): Float32Array {
  const v = new Float32Array(EMBED_DIM)
  let sum = 0
  for (let i = 0; i < EMBED_DIM; i++) {
    v[i] = Math.sin((i + 1) * seed)
    sum += v[i] * v[i]
  }
  const inv = 1 / Math.sqrt(sum)
  for (let i = 0; i < EMBED_DIM; i++) v[i] *= inv
  return v
}

describe('projectVectors', () => {
  it('returns null when fewer than SUBSET_PCA_MIN vectors', () => {
    const ids = ['a', 'b', 'c']
    const vecs = ids.map((_, i) => unitVec(i + 1))
    expect(projectVectors(ids, vecs)).toBeNull()
  })

  it('returns one (x, y) per id for valid input', () => {
    const n = SUBSET_PCA_MIN + 4
    const ids = Array.from({ length: n }, (_, i) => `id${i}`)
    const vecs = ids.map((_, i) => unitVec(i + 1))
    const out = projectVectors(ids, vecs)
    expect(out).not.toBeNull()
    expect(out!.size).toBe(n)
    for (const id of ids) {
      const pos = out!.get(id)
      expect(pos).toBeDefined()
      expect(pos!.length).toBe(2)
      expect(Number.isFinite(pos![0])).toBe(true)
      expect(Number.isFinite(pos![1])).toBe(true)
    }
  })

  it('throws on length mismatch', () => {
    const ids = Array.from({ length: SUBSET_PCA_MIN + 1 }, (_, i) => `id${i}`)
    const vecs = ids.slice(1).map((_, i) => unitVec(i + 1))
    expect(() => projectVectors(ids, vecs)).toThrow(/length mismatch/i)
  })
})

describe('mixLab error paths', () => {
  beforeEach(() => {
    _resetLabMixForTests()
  })

  it('returns not-found for unknown prepId', () => {
    const result = mixLab({ prepId: 'does-not-exist', weights: { 'path-only': 1 } })
    expect('code' in result && result.code).toBe('not-found')
  })
})
