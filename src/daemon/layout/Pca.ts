import { PCA } from 'ml-pca'

export const PC_COUNT = 8

export interface ScaleParams {
  minX: number
  minY: number
  scale: number
  outputRange: number
}

export interface PcaModel {
  components: number[][]  // [K x dim] eigenvectors (rows = PCs)
  mean: number[]          // [dim] column means
  componentCount: number
  // Linear transform that mapped the training set into [-outputRange/2,
  // outputRange/2]. Persisted so post-train inserts can apply the same
  // transform to single embeddings (otherwise they'd land at raw PCA scale,
  // ~±1, and stack at the world origin). Optional for back-compat: legacy
  // models without scale trigger a one-shot retrain at daemon startup.
  scale?: ScaleParams
}

export class StarPca {
  private components: number[][]
  private mean: number[]
  private scaleParams: ScaleParams | null = null

  private constructor(components: number[][], mean: number[], scale: ScaleParams | null = null) {
    this.components = components
    this.mean = mean
    this.scaleParams = scale
  }

  get componentCount(): number {
    return this.components.length
  }

  get scale(): ScaleParams | null {
    return this.scaleParams
  }

  setScale(s: ScaleParams): void {
    this.scaleParams = s
  }

  static train(embeddings: Float32Array[]): StarPca {
    if (embeddings.length < 2) {
      throw new Error(`PCA requires at least 2 samples, got ${embeddings.length}`)
    }
    const dim = embeddings[0].length
    const matrix = embeddings.map(v => Array.from(v))
    const pca = new PCA(matrix, { center: true, scale: false })

    // getEigenvectors() returns a [dim x nComp] matrix.
    // Each COLUMN is a principal component direction.
    const loadings = pca.getEigenvectors().to2DArray() as number[][]
    const nCompAvail = loadings[0]?.length ?? 0
    const k = Math.min(PC_COUNT, nCompAvail, dim, embeddings.length - 1)
    if (k < 2) throw new Error(`PCA produced ${nCompAvail} components; need ≥2`)

    const components: number[][] = []
    for (let c = 0; c < k; c++) {
      components.push(loadings.map(row => row[c]))
    }

    const mean = new Array<number>(dim).fill(0)
    for (const v of embeddings) {
      for (let j = 0; j < dim; j++) mean[j] += v[j]
    }
    for (let j = 0; j < dim; j++) mean[j] /= embeddings.length

    return new StarPca(components, mean)
  }

  // Default: PC1 × PC2 (back-compat).
  project(embedding: Float32Array, axisX = 0, axisY = 1): [number, number] {
    if (axisX < 0 || axisX >= this.components.length) {
      throw new Error(`axisX ${axisX} out of range [0, ${this.components.length})`)
    }
    if (axisY < 0 || axisY >= this.components.length) {
      throw new Error(`axisY ${axisY} out of range [0, ${this.components.length})`)
    }
    const dim = embedding.length
    const cx = this.components[axisX]
    const cy = this.components[axisY]
    let x = 0, y = 0
    for (let j = 0; j < dim; j++) {
      const centered = embedding[j] - this.mean[j]
      x += cx[j] * centered
      y += cy[j] * centered
    }
    return [x, y]
  }

  // Project an embedding onto all K components. Used by the renderer dial.
  projectAll(embedding: Float32Array): number[] {
    const dim = embedding.length
    const k = this.components.length
    const out = new Array<number>(k).fill(0)
    for (let c = 0; c < k; c++) {
      const comp = this.components[c]
      let acc = 0
      for (let j = 0; j < dim; j++) {
        acc += comp[j] * (embedding[j] - this.mean[j])
      }
      out[c] = acc
    }
    return out
  }

  toJSON(): PcaModel {
    return {
      components: this.components,
      mean: this.mean,
      componentCount: this.components.length,
      ...(this.scaleParams ? { scale: this.scaleParams } : {}),
    }
  }

  serialize(): Buffer {
    return Buffer.from(JSON.stringify(this.toJSON()))
  }

  static deserialize(buf: Buffer): StarPca {
    const payload = JSON.parse(buf.toString('utf8')) as Partial<PcaModel>
    if (!payload.components || !payload.mean) {
      throw new Error('PcaModel missing components or mean')
    }
    return new StarPca(payload.components, payload.mean, payload.scale ?? null)
  }
}

export interface ScaledPositions {
  scaled: [number, number][]
  params: ScaleParams
}

export function scalePositions(
  positions: [number, number][],
  outputRange = 1000
): ScaledPositions {
  if (positions.length === 0) {
    return { scaled: [], params: { minX: 0, minY: 0, scale: 1, outputRange } }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of positions) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const rangeX = maxX - minX || 1
  const rangeY = maxY - minY || 1
  const scale = outputRange / Math.max(rangeX, rangeY)
  const params: ScaleParams = { minX, minY, scale, outputRange }
  const scaled = positions.map<[number, number]>(([x, y]) => applyScale([x, y], params))
  return { scaled, params }
}

export function applyScale(p: [number, number], s: ScaleParams): [number, number] {
  return [
    (p[0] - s.minX) * s.scale - s.outputRange / 2,
    (p[1] - s.minY) * s.scale - s.outputRange / 2,
  ]
}
