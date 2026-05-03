import { createHash } from 'crypto'
import { OllamaClient, normalizeEmbedding, validateEmbedding } from './OllamaClient'
import type { FileNode } from '../../shared/types'

export interface EmbeddingResult {
  embedding: Float32Array
  contentHash: string
}

export class EmbeddingEngine {
  private client: OllamaClient

  constructor(client: OllamaClient) {
    this.client = client
  }

  // Embeddings are normalised to unit length so HnswIndex's `ip` (inner-product)
  // distance equals 1 - cosine_similarity. Without this, similarity scores
  // computed downstream as `1 - distance` would drift outside [0, 1].
  async embed(text: string): Promise<EmbeddingResult> {
    const contentHash = createHash('sha1').update(text).digest('hex')
    const raw = await this.client.embed(text)
    validateEmbedding(raw)
    const embedding = normalizeEmbedding(raw)
    return { embedding, contentHash }
  }

  async embedFile(node: FileNode, content: Buffer): Promise<EmbeddingResult | null> {
    if (node.category === 'media') return null
    const text = content.toString('utf8')
    if (!text.trim()) return null
    return this.embed(text)
  }

  contentHash(content: Buffer): string {
    return createHash('sha1').update(content).digest('hex')
  }
}
