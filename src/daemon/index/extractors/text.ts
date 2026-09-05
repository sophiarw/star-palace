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

  extract(path: string): Promise<ExtractedText> {
    if (this.closed) return Promise.resolve({ text: '', status: 'unavailable', error: 'Extractor closed' })
    return new Promise(resolve => { this.queue.push({ id: ++this.sequence, path, resolve }); this.pump() })
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
