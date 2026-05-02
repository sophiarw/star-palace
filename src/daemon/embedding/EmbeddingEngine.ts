import { createHash } from 'crypto'
import { OllamaClient } from './OllamaClient'
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

  async embed(text: string): Promise<EmbeddingResult> {
    const contentHash = createHash('sha1').update(text).digest('hex')
    const embedding = await this.client.embed(text)
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
