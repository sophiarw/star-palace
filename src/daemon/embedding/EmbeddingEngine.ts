import { createHash } from 'crypto'
import { OllamaClient, normalizeEmbedding, validateEmbedding } from './OllamaClient'
import type { FileNode } from '../../shared/types'
import { STRATEGIES, DEFAULT_STRATEGY } from './strategies'
import type { StrategyId } from './strategies'

export interface EmbeddingResult {
  embedding: Float32Array
  contentHash: string
  // B1 — provenance: which strategy produced the prompt that produced this
  // vector. Carried back to Insert so the row's embedding_strategy column
  // records what's actually inside `embedding`.
  strategy: StrategyId
}

export class EmbeddingEngine {
  private client: OllamaClient

  constructor(client: OllamaClient) {
    this.client = client
  }

  // Embeddings are normalised to unit length so HnswIndex's `ip` (inner-product)
  // distance equals 1 - cosine_similarity. Without this, similarity scores
  // computed downstream as `1 - distance` would drift outside [0, 1].
  //
  // B1 — empty/whitespace prompts are rejected. Ollama returns an effectively
  // zero vector for empty input; normalising a zero vector divides by 0 and
  // the resulting NaN/zero would break HNSW's IP-space search. Better to
  // surface this loudly than to silently corrupt the index.
  async embed(text: string): Promise<Omit<EmbeddingResult, 'strategy'>> {
    if (!text.trim()) {
      throw new Error('EmbeddingEngine.embed: refusing empty/whitespace prompt')
    }
    const contentHash = createHash('sha1').update(text).digest('hex')
    const raw = await this.client.embed(text)
    validateEmbedding(raw)
    const embedding = normalizeEmbedding(raw)
    return { embedding, contentHash }
  }

  // Routes a (FileNode, content, tags) tuple through the strategy registry.
  // Returns null when the chosen strategy declines the file (e.g. content-only
  // on a media file or empty doc) — caller should treat that as "no embed".
  async embedFile(
    node: FileNode,
    content: Buffer,
    strategy: StrategyId = DEFAULT_STRATEGY,
    tags: string[] | null = null
  ): Promise<EmbeddingResult | null> {
    const prompt = STRATEGIES[strategy].build({ node, content, tags })
    if (prompt === null) return null
    if (!prompt.trim()) return null
    const { embedding, contentHash } = await this.embed(prompt)
    return { embedding, contentHash, strategy }
  }

  contentHash(content: Buffer): string {
    return createHash('sha1').update(content).digest('hex')
  }
}
