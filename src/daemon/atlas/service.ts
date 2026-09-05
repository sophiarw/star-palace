import { TextExtractor } from '../index/extractors/text'
import type { AtlasStore } from './AtlasStore'
import type { EmbeddingEngine } from '../embedding/EmbeddingEngine'
import type { AtlasHit, AtlasScope } from '../../shared/atlas'
import { stat } from 'node:fs/promises'

export class AtlasService {
  private extractor = new TextExtractor()
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private embeddings = new Map<string, Promise<Float32Array>>()
  constructor(readonly store: AtlasStore, private engine: EmbeddingEngine) {}

  start(): void { this.stopped = false; this.schedule(0) }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.extractor.close() }
  async refreshText(id: string): Promise<void> {
    const file = this.store.index.get(id)
    if (!file || file.platform !== 'local' || !/\.(md|markdown|txt|text)$/i.test(file.path)) throw new Error('Choose a local Markdown or plain-text document.')
    const before = await stat(file.path)
    if (!before.isFile()) throw new Error('This document is not a regular file.')
    const result = await this.extractor.extract(file.path, `${before.mtimeMs}:${before.size}:${before.ctimeMs}`)
    const after = await stat(file.path)
    if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size) throw new Error('This document is still changing. Try refreshing again after saving.')
    if (!['ready', 'truncated', 'no-text'].includes(result.status)) throw new Error('This document could not be refreshed as text.')
    this.store.index.db.transaction(() => {
      this.store.index.db.prepare('UPDATE files SET size=?,modified_at=? WHERE id=? AND path=?').run(after.size, after.mtimeMs, id, file.path)
      this.store.setText(id, result.text, result.status, `${after.mtimeMs}:${after.size}`, result.error)
    })()
  }
  async text(id: string): Promise<void> {
    const file = this.store.index.get(id)
    if (!file) return
    const stamp = `${file.modifiedAt}:${file.size}`
    const previous = this.store.document(id)
    if (previous?.stamp === stamp && previous.status !== 'unavailable') return
    const result = await this.extractor.extract(file.path, stamp)
    this.store.setText(id, result.text, result.status, stamp, result.error)
  }
  private schedule(ms: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { void this.tick().catch(err => { console.warn('[atlas]', String(err)); this.schedule(1000) }) }, ms)
    this.timer.unref()
  }
  private async tick(): Promise<void> {
    if (this.stopped) return
    // Commit a bounded slice, then yield before doing the next one. Metadata
    // and positions become available before optional document extraction.
    const changed = this.store.syncBatch(64)
    if (changed) { this.schedule(0); return }
    const next = this.store.needsExtraction(1)[0]
    if (next) {
      const result = await this.extractor.extract(next.path, `${next.modified_at}:${next.size}`)
      if (this.stopped) return
      this.store.setText(next.id, result.text, result.status, `${next.modified_at}:${next.size}`, result.error)
      this.schedule(0)
    } else this.schedule(500)
  }

  async related(query: string, scope: AtlasScope, limit: number, isCancelled = (): boolean => false): Promise<AtlasHit[]> {
    if (limit <= 0) return []
    const key = query.trim().toLowerCase()
    let pending = this.embeddings.get(key)
    if (!pending) {
      pending = this.engine.embed(query).then(r => r.embedding)
      this.embeddings.set(key, pending)
      if (this.embeddings.size > 128) this.embeddings.delete(this.embeddings.keys().next().value!)
    }
    let vector: Float32Array
    try { vector = await pending } catch (error) { this.embeddings.delete(key); throw error }
    if (isCancelled()) return []
    const best: { id: string; score: number }[] = []
    let after = ''
    for (;;) {
      if (isCancelled()) return []
      const candidates = this.store.vectorBatch(scope, after)
      if (!candidates.length) break
      after = candidates[candidates.length - 1].id
      for (const candidate of candidates) {
        if (candidate.embedding.length !== vector.length) continue
        let score = 0
        for (let d = 0; d < vector.length; d++) score += vector[d] * candidate.embedding[d]
        if (score < 0.25) continue
        if (best.length < limit || score > best[best.length - 1].score) {
          best.push({ id: candidate.id, score }); best.sort((a, b) => b.score - a.score)
          if (best.length > limit) best.pop()
        }
      }
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    return best.map(hit => ({ file: this.store.file(hit.id)!, score: hit.score, reason: 'related',
      snippet: this.store.document(hit.id)?.text.slice(0, 240) || 'Related by document meaning', offset: 0 }))
  }
}
