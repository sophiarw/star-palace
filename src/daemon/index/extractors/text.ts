import { Worker } from 'worker_threads'
import { join } from 'path'

export interface ExtractedText { text: string; status: string; error: string | null }
interface Task { id: number; path: string; resolve: (result: ExtractedText) => void }

/** A bounded worker keeps PDF/DOCX parsing off the HTTP event loop. */
export class TextExtractor {
  private worker: Worker | null = null
  private queue: Task[] = []
  private active: Task | null = null
  private sequence = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private pending = new Map<string, Promise<ExtractedText>>()

  extract(path: string, revision = ''): Promise<ExtractedText> {
    if (this.closed) return Promise.resolve({ text: '', status: 'unavailable', error: 'Extractor closed' })
    const key = path + '\0' + revision
    const existing = this.pending.get(key)
    if (existing) return existing
    if (this.queue.length >= 64) return Promise.resolve({ text: '', status: 'unavailable', error: 'Preview queue is busy; try again' })
    const result = new Promise<ExtractedText>(resolve => { this.queue.push({ id: ++this.sequence, path, resolve }); this.pump() })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, result)
    return result
  }

  private pump(): void {
    if (this.active || !this.queue.length || this.closed) return
    if (!this.worker) {
      const worker = new Worker(join(__dirname, 'text-worker.cjs'))
      this.worker = worker
      worker.on('message', (result: ExtractedText & { id: number }) => {
        if (this.worker !== worker || result.id !== this.active?.id) return
        if (this.timer) clearTimeout(this.timer)
        this.active.resolve(result); this.active = null
        worker.unref(); this.pump()
      })
      worker.on('error', error => this.failed(worker, error.message))
      worker.on('exit', code => { if (code !== 0) this.failed(worker, `Extraction worker exited (${code})`) })
    }
    this.active = this.queue.shift()!
    const worker = this.worker
    worker.ref()
    this.timer = setTimeout(() => this.failed(worker, 'Text extraction timed out'), 20_000)
    worker.postMessage({ id: this.active.id, path: this.active.path })
  }

  private failed(worker: Worker, error: string): void {
    if (this.worker !== worker) return
    if (this.timer) clearTimeout(this.timer)
    this.worker = null
    void worker.terminate()
    this.active?.resolve({ text: '', status: 'unavailable', error })
    this.active = null; this.pump()
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    if (this.worker) { void this.worker.terminate(); this.worker = null }
    for (const task of [...this.queue, ...(this.active ? [this.active] : [])]) task.resolve({ text: '', status: 'unavailable', error: 'Extractor closed' })
    this.queue = []; this.active = null
  }
}

// Shared bounded extraction for explicit reindex and advanced experiments.
const sharedExtractor = new TextExtractor()
export async function extractContent(path: string, category: string): Promise<Buffer> {
  if (category === 'media') return Buffer.alloc(0)
  const result = await sharedExtractor.extract(path)
  if (result.status === 'unavailable') throw new Error(result.error ?? 'File unavailable')
  return Buffer.from(result.text, 'utf8')
}
