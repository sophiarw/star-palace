import { HierarchicalNSW } from 'hnswlib-node'
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { EMBED_DIM } from '../../shared/types'

export interface KNNResult {
  id: string
  distance: number  // 1 - cosine_similarity (inner product space: distance = 1 - dot)
}

export interface HnswIndexOptions {
  dim?: number
  maxElements?: number
  persistPath?: string
}

export class HnswIndex {
  private index: HierarchicalNSW
  private idToLabel: Map<string, number>   // fileId -> hnswlib label (int)
  private labelToId: Map<number, string>   // hnswlib label -> fileId
  private nextLabel: number
  private dim: number
  private persistPath: string | null

  constructor(opts: HnswIndexOptions = {}) {
    this.dim = opts.dim ?? EMBED_DIM
    this.persistPath = opts.persistPath ?? null
    this.idToLabel = new Map()
    this.labelToId = new Map()
    this.nextLabel = 0

    // InnerProductSpace: distance = 1 - dot(a,b). The contract requires
    // unit-length inputs so 1 - dot equals 1 - cosine_similarity. The
    // pipeline normalises in EmbeddingEngine.embed before reaching here;
    // callers that bypass that path (e.g. tests with hand-crafted vectors)
    // must normalise themselves.
    this.index = new HierarchicalNSW('ip', this.dim)
    this.index.initIndex(opts.maxElements ?? 200_000, 16, 200, 100)
  }

  addPoint(embedding: Float32Array, fileId: string): void {
    if (this.idToLabel.has(fileId)) {
      // update in place: hnswlib marks the old vector and adds new one at same label
      const label = this.idToLabel.get(fileId)!
      this.index.addPoint(Array.from(embedding), label)
      return
    }
    const label = this.nextLabel++
    this.idToLabel.set(fileId, label)
    this.labelToId.set(label, fileId)
    this.index.addPoint(Array.from(embedding), label)
  }

  searchKNN(embedding: Float32Array, k: number): KNNResult[] {
    const count = this.idToLabel.size
    if (count === 0) return []
    const actual = Math.min(k, count)
    const result = this.index.searchKnn(Array.from(embedding), actual)
    return result.neighbors.map((label, i) => ({
      id: this.labelToId.get(label) ?? String(label),
      distance: result.distances[i],
    }))
  }

  size(): number {
    return this.idToLabel.size
  }

  has(fileId: string): boolean {
    return this.idToLabel.has(fileId)
  }

  save(): void {
    if (!this.persistPath) return
    mkdirSync(dirname(this.persistPath), { recursive: true })
    this.index.writeIndex(this.persistPath)
    // also persist id<->label mapping as JSON beside the bin file
    const mapPath = this.persistPath + '.map.json'
    const entries: [string, number][] = []
    for (const [id, label] of this.idToLabel) entries.push([id, label])
    writeFileSync(mapPath, JSON.stringify({ entries, nextLabel: this.nextLabel }))
  }

  load(): boolean {
    if (!this.persistPath) return false
    if (!existsSync(this.persistPath)) return false
    const mapPath = this.persistPath + '.map.json'
    if (!existsSync(mapPath)) return false
    try {
      this.index.readIndex(this.persistPath)
      const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as {
        entries: [string, number][]
        nextLabel: number
      }
      this.idToLabel = new Map(raw.entries)
      this.labelToId = new Map(raw.entries.map(([id, label]) => [label, id]))
      this.nextLabel = raw.nextLabel
      return true
    } catch {
      return false
    }
  }
}
