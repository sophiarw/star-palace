import { describe, it, expect } from 'vitest'
import { HnswIndex } from '../../src/daemon/ann/HnswIndex'
import { EMBED_DIM } from '../../src/shared/types'

function randVec(dim: number, seed: number): Float32Array {
  const v = new Float32Array(dim)
  // simple LCG to get repeatable pseudo-random
  let s = seed
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    v[i] = (s / 2 ** 32) * 2 - 1
  }
  // normalize
  let norm = 0
  for (let i = 0; i < dim; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  for (let i = 0; i < dim; i++) v[i] /= norm
  return v
}

describe('HnswIndex', () => {
  it('returns empty results on empty index', () => {
    const idx = new HnswIndex({ dim: EMBED_DIM })
    const results = idx.searchKNN(randVec(EMBED_DIM, 42), 5)
    expect(results).toHaveLength(0)
  })

  it('single point: top-1 returns itself', () => {
    const idx = new HnswIndex({ dim: EMBED_DIM })
    const v = randVec(EMBED_DIM, 1)
    idx.addPoint(v, 'file1')
    const results = idx.searchKNN(v, 1)
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('file1')
  })

  it('returns correct size', () => {
    const idx = new HnswIndex({ dim: EMBED_DIM })
    expect(idx.size()).toBe(0)
    idx.addPoint(randVec(EMBED_DIM, 1), 'a')
    idx.addPoint(randVec(EMBED_DIM, 2), 'b')
    expect(idx.size()).toBe(2)
  })

  it('k capped to index size', () => {
    const idx = new HnswIndex({ dim: EMBED_DIM })
    idx.addPoint(randVec(EMBED_DIM, 1), 'a')
    idx.addPoint(randVec(EMBED_DIM, 2), 'b')
    const results = idx.searchKNN(randVec(EMBED_DIM, 3), 10)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('high recall vs brute force with structured data (64-dim, 200 pts, top-10)', () => {
    // Use 64-dim with cluster structure so true neighbors are meaningfully closer.
    // Pure random 768-dim vectors are all ~equidistant (curse of dimensionality).
    const DIM = 64
    const K = 10
    const idx = new HnswIndex({ dim: DIM })
    const vecs: Float32Array[] = []

    // 10 cluster centroids
    const centroids = Array.from({ length: 10 }, (_, ci) => randVec(DIM, ci * 100 + 7))

    // 20 points per cluster, close to centroid
    for (let ci = 0; ci < 10; ci++) {
      for (let j = 0; j < 20; j++) {
        const noise = randVec(DIM, ci * 1000 + j + 1)
        const v = new Float32Array(DIM)
        const mix = 0.85
        for (let d = 0; d < DIM; d++) v[d] = centroids[ci][d] * mix + noise[d] * (1 - mix)
        // normalize
        let norm = 0
        for (let d = 0; d < DIM; d++) norm += v[d] * v[d]
        norm = Math.sqrt(norm)
        for (let d = 0; d < DIM; d++) v[d] /= norm
        const id = `c${ci}_${j}`
        vecs.push(v)
        idx.addPoint(v, id)
      }
    }

    // query = a slightly noisy version of centroid 3
    const queryBase = centroids[3]
    const noise = randVec(DIM, 55555)
    const query = new Float32Array(DIM)
    for (let d = 0; d < DIM; d++) query[d] = queryBase[d] * 0.9 + noise[d] * 0.1
    let qNorm = 0
    for (let d = 0; d < DIM; d++) qNorm += query[d] * query[d]
    qNorm = Math.sqrt(qNorm)
    for (let d = 0; d < DIM; d++) query[d] /= qNorm

    // brute-force
    const scores = vecs.map((v, i) => {
      let dot = 0
      for (let d = 0; d < DIM; d++) dot += v[d] * query[d]
      return { id: `c${Math.floor(i / 20)}_${i % 20}`, dot }
    })
    scores.sort((a, b) => b.dot - a.dot)
    const bruteTopK = new Set(scores.slice(0, K).map(s => s.id))

    const hnswTopK = new Set(idx.searchKNN(query, K).map(r => r.id))
    const overlap = [...hnswTopK].filter(id => bruteTopK.has(id)).length
    const recall = overlap / K
    expect(recall).toBeGreaterThanOrEqual(0.8)
  })
})
