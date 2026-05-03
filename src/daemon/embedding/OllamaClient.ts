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

// Truncate to at most MAX_TEXT_BYTES of UTF-8 bytes, ending on a codepoint
// boundary. The previous implementation truncated by char count, which under-
// or over-shot the byte budget on multi-byte scripts (CJK, emoji) and could
// leave Ollama with a half-truncated codepoint at the tail.
export function truncateText(text: string): string {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= MAX_TEXT_BYTES) return text
  let end = MAX_TEXT_BYTES
  // Back up past any UTF-8 continuation byte (10xxxxxx) so the cut never
  // bisects a multi-byte codepoint.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.toString('utf8', 0, end)
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

export function validateEmbedding(v: Float32Array, expectedDim = EMBED_DIM): void {
  if (v.length !== expectedDim) {
    throw new Error(`Expected embedding dim ${expectedDim}, got ${v.length}`)
  }
}
