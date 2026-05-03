import { randomBytes } from 'crypto'

// F17 — In-memory progress tracker for `POST /api/index` jobs. The walker
// publishes incremental events that the SSE endpoint streams to renderers.
// State is intentionally not persisted: a daemon restart drops in-flight
// indexing UI; the underlying SQLite + HNSW writes are idempotent so a
// re-trigger picks up where the abort left off.

export type ProgressStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface ProgressState {
  jobId: string
  status: ProgressStatus
  // Walker counters. `total` stays null until the walker has finished its
  // discovery phase (only filled in the final 'done' frame for v1; UI shows
  // indeterminate stripes until then).
  scanned: number
  indexed: number
  skipped: number
  errors: number
  total: number | null
  currentPath: string | null
  // Wall-clock timestamps in ms. `lastUpdateAt` lets the renderer's "stalled?"
  // hint fire after 10 s of no movement (per spec).
  startedAt: number
  lastUpdateAt: number
  finishedAt: number | null
  errorMessage: string | null
  galaxyId: number | null
  galaxyName: string | null
}

export type Subscriber = (state: ProgressState) => void

interface JobEntry {
  state: ProgressState
  // Cooperative cancel flag — the walker checks this between files via
  // `isCancelled(jobId)` and aborts cleanly when set.
  cancelRequested: boolean
  subscribers: Set<Subscriber>
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

// Default cleanup delay after a job hits a terminal state. SSE clients have
// 60 s after completion to grab the final frame before the entry is GC'd.
export const PROGRESS_CLEANUP_MS = 60_000

export class ProgressStore {
  private readonly jobs = new Map<string, JobEntry>()
  private readonly cleanupMs: number

  constructor(opts: { cleanupMs?: number } = {}) {
    this.cleanupMs = opts.cleanupMs ?? PROGRESS_CLEANUP_MS
  }

  // Register a fresh job. The returned jobId is the SSE subscription key and
  // gets bundled in the `POST /api/index` response so the renderer can connect
  // before the walker fires its first event.
  start(opts: { galaxyId: number | null; galaxyName: string | null }): string {
    const jobId = `${Date.now()}-${randomBytes(4).toString('hex')}`
    const now = Date.now()
    const state: ProgressState = {
      jobId,
      status: 'running',
      scanned: 0,
      indexed: 0,
      skipped: 0,
      errors: 0,
      total: null,
      currentPath: null,
      startedAt: now,
      lastUpdateAt: now,
      finishedAt: null,
      errorMessage: null,
      galaxyId: opts.galaxyId,
      galaxyName: opts.galaxyName,
    }
    this.jobs.set(jobId, {
      state,
      cancelRequested: false,
      subscribers: new Set(),
      cleanupTimer: null,
    })
    return jobId
  }

  // Update the walker's counters and broadcast to any SSE subscribers. Caller
  // (Insert pipeline) throttles to ~10 Hz so we don't flood the EventSource.
  update(jobId: string, patch: Partial<Pick<ProgressState,
    'scanned' | 'indexed' | 'skipped' | 'errors' | 'currentPath' | 'total'
  >>): void {
    const entry = this.jobs.get(jobId)
    if (!entry || entry.state.status !== 'running') return
    Object.assign(entry.state, patch)
    entry.state.lastUpdateAt = Date.now()
    this.broadcast(entry)
  }

  // Mark a job done/error/cancelled, broadcast the final frame, and schedule
  // cleanup. Once terminal, further `update` calls are no-ops.
  finish(jobId: string, opts: {
    status: 'done' | 'error' | 'cancelled'
    scanned?: number
    indexed?: number
    skipped?: number
    errors?: number
    total?: number | null
    errorMessage?: string | null
  }): void {
    const entry = this.jobs.get(jobId)
    if (!entry) return
    if (entry.state.status !== 'running') return
    if (opts.scanned !== undefined) entry.state.scanned = opts.scanned
    if (opts.indexed !== undefined) entry.state.indexed = opts.indexed
    if (opts.skipped !== undefined) entry.state.skipped = opts.skipped
    if (opts.errors !== undefined) entry.state.errors = opts.errors
    if (opts.total !== undefined) entry.state.total = opts.total
    if (opts.errorMessage !== undefined) entry.state.errorMessage = opts.errorMessage
    entry.state.status = opts.status
    entry.state.finishedAt = Date.now()
    entry.state.lastUpdateAt = entry.state.finishedAt
    this.broadcast(entry)
    this.scheduleCleanup(jobId)
  }

  // Flip the cancel flag. The walker calls `isCancelled(jobId)` between files
  // and aborts at the next checkpoint. Returns true if a job was found.
  cancel(jobId: string): boolean {
    const entry = this.jobs.get(jobId)
    if (!entry) return false
    if (entry.state.status !== 'running') return false
    entry.cancelRequested = true
    return true
  }

  isCancelled(jobId: string): boolean {
    const entry = this.jobs.get(jobId)
    return entry ? entry.cancelRequested : false
  }

  get(jobId: string): ProgressState | null {
    const entry = this.jobs.get(jobId)
    return entry ? { ...entry.state } : null
  }

  has(jobId: string): boolean {
    return this.jobs.has(jobId)
  }

  // SSE handler subscribes; the returned unsubscribe is invoked on response
  // close so we never leak listeners across reconnects.
  subscribe(jobId: string, fn: Subscriber): () => void {
    const entry = this.jobs.get(jobId)
    if (!entry) return () => undefined
    entry.subscribers.add(fn)
    return () => { entry.subscribers.delete(fn) }
  }

  // Test hook — force-removes a job without waiting on the cleanup timer.
  // Production code shouldn't call this; lets unit tests assert post-cleanup
  // shape deterministically.
  delete(jobId: string): void {
    const entry = this.jobs.get(jobId)
    if (entry?.cleanupTimer) clearTimeout(entry.cleanupTimer)
    this.jobs.delete(jobId)
  }

  // Test hook — count of live jobs; lets tests assert cleanup actually fired.
  size(): number {
    return this.jobs.size
  }

  private broadcast(entry: JobEntry): void {
    const snapshot: ProgressState = { ...entry.state }
    for (const fn of entry.subscribers) {
      try { fn(snapshot) } catch { /* a single bad subscriber must not break the rest */ }
    }
  }

  private scheduleCleanup(jobId: string): void {
    const entry = this.jobs.get(jobId)
    if (!entry) return
    if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer)
    entry.cleanupTimer = setTimeout(() => {
      this.jobs.delete(jobId)
    }, this.cleanupMs)
    // Don't keep the daemon alive solely for this timer.
    if (typeof entry.cleanupTimer.unref === 'function') entry.cleanupTimer.unref()
  }
}

// Singleton — the daemon process owns one instance shared by the indexer and
// the SSE endpoint. Tests construct their own instances directly.
export const progressStore = new ProgressStore()
