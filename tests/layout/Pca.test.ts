import { describe, it, expect } from 'vitest'
import { StarPca, scalePositions, PC_COUNT } from '../../src/daemon/layout/Pca'

function gaussianCluster(center: number[], n: number, seed: number): Float32Array[] {
  const dim = center.length
  const result: Float32Array[] = []
  let s = seed
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(dim)
    for (let j = 0; j < dim; j++) {
      // simple LCG
      s = (s * 1664525 + 1013904223) >>> 0
      const noise = (s / 2 ** 32) * 0.1 - 0.05
      v[j] = center[j] + noise
    }
    result.push(v)
  }
  return result
}

describe('StarPca', () => {
  it('throws with fewer than 2 samples', () => {
    expect(() => StarPca.train([new Float32Array(4)])).toThrow('at least 2')
  })

  it('projects to 2D', () => {
    const vecs = [
      ...gaussianCluster([1, 0, 0, 0], 50, 1),
      ...gaussianCluster([0, 1, 0, 0], 50, 2),
      ...gaussianCluster([0, 0, 1, 0], 50, 3),
    ]
    const pca = StarPca.train(vecs)
    const [x, y] = pca.project(new Float32Array([1, 0, 0, 0]))
    expect(typeof x).toBe('number')
    expect(typeof y).toBe('number')
    expect(isFinite(x)).toBe(true)
    expect(isFinite(y)).toBe(true)
  })

  it('serialize + deserialize round-trips projection', () => {
    const dim = 16
    const vecs = Array.from({ length: 30 }, (_, i) => {
      const v = new Float32Array(dim)
      for (let j = 0; j < dim; j++) v[j] = Math.sin(i * 0.3 + j)
      return v
    })
    const pca = StarPca.train(vecs)
    const test = vecs[5]
    const [x1, y1] = pca.project(test)

    const buf = pca.serialize()
    const pca2 = StarPca.deserialize(buf)
    const [x2, y2] = pca2.project(test)

    expect(x2).toBeCloseTo(x1, 10)
    expect(y2).toBeCloseTo(y1, 10)
  })

  it('cluster separation: different clusters project far apart', () => {
    const dim = 32
    const vecs = [
      ...gaussianCluster(Array.from({ length: dim }, (_, i) => i < 16 ? 1.0 : 0.0), 50, 1),
      ...gaussianCluster(Array.from({ length: dim }, (_, i) => i >= 16 ? 1.0 : 0.0), 50, 2),
    ]
    const pca = StarPca.train(vecs)

    const c1 = pca.project(new Float32Array(Array.from({ length: dim }, (_, i) => i < 16 ? 1.0 : 0.0)))
    const c2 = pca.project(new Float32Array(Array.from({ length: dim }, (_, i) => i >= 16 ? 1.0 : 0.0)))

    const dist = Math.sqrt((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2)
    expect(dist).toBeGreaterThan(0.01)  // must separate
  })

  it('scalePositions maps to [-range/2, range/2]', () => {
    const positions: [number, number][] = [[0, 0], [1, 1], [2, 2], [-1, -1]]
    const scaled = scalePositions(positions, 1000)
    const xs = scaled.map(([x]) => x)
    const ys = scaled.map(([, y]) => y)
    expect(Math.min(...xs)).toBeCloseTo(-500)
    expect(Math.max(...xs)).toBeCloseTo(500)
    expect(Math.min(...ys)).toBeCloseTo(-500)
    expect(Math.max(...ys)).toBeCloseTo(500)
  })

  it('scalePositions handles empty input', () => {
    expect(scalePositions([])).toEqual([])
  })

  it('keeps top-PC_COUNT components when dim is large', () => {
    const dim = 64
    const vecs = Array.from({ length: 50 }, (_, i) => {
      const v = new Float32Array(dim)
      for (let j = 0; j < dim; j++) v[j] = Math.sin(i * 0.13 + j * 0.07)
      return v
    })
    const pca = StarPca.train(vecs)
    expect(pca.componentCount).toBe(PC_COUNT)
  })

  it('clamps componentCount when dim < PC_COUNT', () => {
    const vecs = [
      new Float32Array([1, 0, 0, 0]),
      new Float32Array([0, 1, 0, 0]),
      new Float32Array([0, 0, 1, 0]),
      new Float32Array([0, 0, 0, 1]),
      new Float32Array([1, 1, 0, 0]),
    ]
    const pca = StarPca.train(vecs)
    expect(pca.componentCount).toBeLessThanOrEqual(4)
    expect(pca.componentCount).toBeGreaterThanOrEqual(2)
  })

  it('projectAll returns componentCount scalars and matches project on default axes', () => {
    const dim = 32
    const vecs = Array.from({ length: 40 }, (_, i) => {
      const v = new Float32Array(dim)
      for (let j = 0; j < dim; j++) v[j] = Math.cos(i * 0.21 + j * 0.11)
      return v
    })
    const pca = StarPca.train(vecs)
    const all = pca.projectAll(vecs[7])
    expect(all.length).toBe(pca.componentCount)
    const [x, y] = pca.project(vecs[7])
    expect(all[0]).toBeCloseTo(x, 10)
    expect(all[1]).toBeCloseTo(y, 10)
  })

  it('project respects axis selection', () => {
    const dim = 32
    const vecs = Array.from({ length: 40 }, (_, i) => {
      const v = new Float32Array(dim)
      for (let j = 0; j < dim; j++) v[j] = Math.cos(i * 0.21 + j * 0.11)
      return v
    })
    const pca = StarPca.train(vecs)
    const all = pca.projectAll(vecs[3])
    const [px, py] = pca.project(vecs[3], 2, 3)
    expect(px).toBeCloseTo(all[2], 10)
    expect(py).toBeCloseTo(all[3], 10)
  })

  it('project rejects axis indices out of range', () => {
    const vecs = [
      new Float32Array([1, 0, 0, 0]),
      new Float32Array([0, 1, 0, 0]),
      new Float32Array([0, 0, 1, 0]),
    ]
    const pca = StarPca.train(vecs)
    expect(() => pca.project(vecs[0], pca.componentCount, 0)).toThrow('out of range')
    expect(() => pca.project(vecs[0], 0, -1)).toThrow('out of range')
  })

  it('serialize round-trips componentCount and projectAll', () => {
    const dim = 24
    const vecs = Array.from({ length: 30 }, (_, i) => {
      const v = new Float32Array(dim)
      for (let j = 0; j < dim; j++) v[j] = Math.sin(i + j * 0.5)
      return v
    })
    const pca = StarPca.train(vecs)
    const before = pca.projectAll(vecs[4])
    const buf = pca.serialize()
    const pca2 = StarPca.deserialize(buf)
    expect(pca2.componentCount).toBe(pca.componentCount)
    const after = pca2.projectAll(vecs[4])
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).toBeCloseTo(before[i], 10)
    }
  })
})
