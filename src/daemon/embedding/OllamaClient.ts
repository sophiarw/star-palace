import { OLLAMA_PORT, EMBED_DIM, MAX_TEXT_BYTES } from '../../shared/types'

export interface OllamaClientOptions {
  model?: string
  baseUrl?: string
  concurrency?: number
}

const DEFAULT_MODEL = 'nomic-embed-text'
const BATCH_CONCURRENCY = 8

export class OllamaClient {
  private model: string
  private baseUrl: string
  private concurrency: number

  constructor(opts: OllamaClientOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL
    this.baseUrl = opts.baseUrl ?? `http://localhost:${OLLAMA_PORT}`
    this.concurrency = opts.concurrency ?? BATCH_CONCURRENCY
  }

  async embed(text: string): Promise<Float32Array> {
    const truncated = truncateText(text)
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: truncated, options: { num_ctx: 8192 } }),
    })
    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`)
    }
    const json = await res.json() as { embedding: number[] }
    return new Float32Array(json.embedding)
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = new Array(texts.length)
    for (let start = 0; start < texts.length; start += this.concurrency) {
      const chunk = texts.slice(start, start + this.concurrency)
      const embeddings = await Promise.all(chunk.map(t => this.embed(t)))
      for (let i = 0; i < embeddings.length; i++) {
        results[start + i] = embeddings[i]
      }
    }
    return results
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }
}

function truncateText(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_TEXT_BYTES) return text
  // truncate to MAX_TEXT_BYTES by char count (approximate; UTF-8 avg ~1.2 bytes/char)
  return text.slice(0, MAX_TEXT_BYTES)
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function normalizeEmbedding(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm === 0) return v
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

export function zeroPadOrTruncate(v: Float32Array, dim: number): Float32Array {
  if (v.length === dim) return v
  const out = new Float32Array(dim)
  out.set(v.slice(0, dim))
  return out
}

export function validateEmbedding(v: Float32Array, expectedDim = EMBED_DIM): void {
  if (v.length !== expectedDim) {
    throw new Error(`Expected embedding dim ${expectedDim}, got ${v.length}`)
  }
}
