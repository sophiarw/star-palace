import { PCA } from 'ml-pca'

export interface PcaModel {
  components: number[][]  // [2 x dim] eigenvectors
  mean: number[]          // [dim] column means
}

export class StarPca {
  private components: number[][]
  private mean: number[]

  private constructor(components: number[][], mean: number[]) {
    this.components = components
    this.mean = mean
  }

  static train(embeddings: Float32Array[]): StarPca {
    if (embeddings.length < 2) {
      throw new Error(`PCA requires at least 2 samples, got ${embeddings.length}`)
    }
    // ml-pca expects rows x cols 2D array
    const matrix = embeddings.map(v => Array.from(v))
    const pca = new PCA(matrix, { center: true, scale: false, nCompNIPALS: 2 })

    // getEigenvectors() returns a [dim x nComp] matrix.
    // Each COLUMN is a principal component direction — extract columns 0 and 1.
    const loadings = pca.getEigenvectors().to2DArray() as number[][]
    const nComp = loadings[0]?.length ?? 0
    if (nComp < 2) throw new Error(`PCA produced ${nComp} components; need ≥2`)
    const components = [
      loadings.map(row => row[0]),  // PC1: length = dim
      loadings.map(row => row[1]),  // PC2: length = dim
    ]

    // mean = pca was centered; we need to store the column means manually
    const dim = embeddings[0].length
    const mean = new Array<number>(dim).fill(0)
    for (const v of embeddings) {
      for (let j = 0; j < dim; j++) mean[j] += v[j]
    }
    for (let j = 0; j < dim; j++) mean[j] /= embeddings.length

    return new StarPca(components, mean)
  }

  project(embedding: Float32Array): [number, number] {
    const dim = embedding.length
    let x = 0, y = 0
    for (let j = 0; j < dim; j++) {
      const centered = embedding[j] - this.mean[j]
      x += this.components[0][j] * centered
      y += this.components[1][j] * centered
    }
    return [x, y]
  }

  serialize(): Buffer {
    const payload: PcaModel = {
      components: this.components,
      mean: this.mean,
    }
    return Buffer.from(JSON.stringify(payload))
  }

  static deserialize(buf: Buffer): StarPca {
    const payload = JSON.parse(buf.toString('utf8')) as PcaModel
    return new StarPca(payload.components, payload.mean)
  }
}

export function scalePositions(
  positions: [number, number][],
  outputRange = 1000
): [number, number][] {
  if (positions.length === 0) return []
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
  return positions.map(([x, y]) => [
    (x - minX) * scale - outputRange / 2,
    (y - minY) * scale - outputRange / 2,
  ])
}
