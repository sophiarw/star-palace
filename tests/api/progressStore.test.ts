import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProgressStore } from '../../src/daemon/index/progressStore'
import type { ProgressState } from '../../src/daemon/index/progressStore'

// F17 — pure-state-machine test for the progressStore. Avoids importing the
// daemon (which would trip the hnswlib-node SIGSEGV at vitest teardown per
// CLAUDE.md). The SSE endpoint is exercised via app-level integration tests
// once the contract test stabilizes; for now these cover state transitions,
// subscription fan-out, cancel flag, cleanup timer, and idempotency.

describe('ProgressStore (F17)', () => {
  let store: ProgressStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = new ProgressStore({ cleanupMs: 60_000 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start()', () => {
    it('mints a unique jobId and seeds running state', () => {
      const id = store.start({ galaxyId: 1, galaxyName: 'docs' })
      const state = store.get(id)
      expect(state).not.toBeNull()
      expect(state!.status).toBe('running')
      expect(state!.scanned).toBe(0)
      expect(state!.indexed).toBe(0)
      expect(state!.galaxyId).toBe(1)
      expect(state!.galaxyName).toBe('docs')
      expect(state!.total).toBeNull()
      expect(state!.currentPath).toBeNull()
    })

    it('mints distinct ids for back-to-back starts', () => {
      const a = store.start({ galaxyId: 1, galaxyName: 'a' })
      const b = store.start({ galaxyId: 2, galaxyName: 'b' })
      expect(a).not.toBe(b)
      expect(store.size()).toBe(2)
    })
  })

  describe('update()', () => {
    it('writes counters and refreshes lastUpdateAt', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      const before = store.get(id)!.lastUpdateAt
      vi.advanceTimersByTime(50)
      store.update(id, { scanned: 3, indexed: 2, currentPath: '/foo' })
      const after = store.get(id)!
      expect(after.scanned).toBe(3)
      expect(after.indexed).toBe(2)
      expect(after.currentPath).toBe('/foo')
      expect(after.lastUpdateAt).toBeGreaterThan(before)
    })

    it('is a no-op once the job has finished', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.finish(id, { status: 'done', scanned: 5, indexed: 5 })
      store.update(id, { scanned: 99 })
      expect(store.get(id)!.scanned).toBe(5)
    })

    it('silently ignores unknown jobIds (race with cleanup)', () => {
      // No throw; just nothing happens.
      expect(() => store.update('does-not-exist', { scanned: 1 })).not.toThrow()
    })
  })

  describe('finish()', () => {
    it('flips status, writes final counters, and stamps finishedAt', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      vi.advanceTimersByTime(100)
      store.finish(id, {
        status: 'done',
        scanned: 10, indexed: 9, skipped: 1, errors: 0, total: 10,
      })
      const s = store.get(id)!
      expect(s.status).toBe('done')
      expect(s.scanned).toBe(10)
      expect(s.indexed).toBe(9)
      expect(s.skipped).toBe(1)
      expect(s.total).toBe(10)
      expect(s.finishedAt).not.toBeNull()
    })

    it('captures errorMessage on error finish', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.finish(id, { status: 'error', errorMessage: 'Ollama unreachable' })
      expect(store.get(id)!.status).toBe('error')
      expect(store.get(id)!.errorMessage).toBe('Ollama unreachable')
    })

    it('is idempotent — second finish is a no-op', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.finish(id, { status: 'done', indexed: 5 })
      store.finish(id, { status: 'cancelled', indexed: 99 })
      expect(store.get(id)!.status).toBe('done')
      expect(store.get(id)!.indexed).toBe(5)
    })

    it('schedules cleanup that GCs the entry after cleanupMs', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.finish(id, { status: 'done' })
      expect(store.has(id)).toBe(true)
      vi.advanceTimersByTime(59_999)
      expect(store.has(id)).toBe(true)
      vi.advanceTimersByTime(2)
      expect(store.has(id)).toBe(false)
    })
  })

  describe('cancel()', () => {
    it('flips the cancel flag and isCancelled() reflects it', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      expect(store.isCancelled(id)).toBe(false)
      const ok = store.cancel(id)
      expect(ok).toBe(true)
      expect(store.isCancelled(id)).toBe(true)
    })

    it('returns false for unknown or already-finished jobs', () => {
      expect(store.cancel('nope')).toBe(false)
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.finish(id, { status: 'done' })
      expect(store.cancel(id)).toBe(false)
    })

    it('does not auto-finish — caller (walker) decides when to flush terminal state', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.cancel(id)
      // Status stays running until finish() is called explicitly so the
      // walker can drain its in-flight per-file work without contention.
      expect(store.get(id)!.status).toBe('running')
    })
  })

  describe('subscribe()', () => {
    it('fires for each update with a snapshot', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      const fn = vi.fn()
      store.subscribe(id, fn)
      store.update(id, { scanned: 1, indexed: 1, currentPath: '/a' })
      store.update(id, { scanned: 2, indexed: 2, currentPath: '/b' })
      expect(fn).toHaveBeenCalledTimes(2)
      const last = fn.mock.calls[1][0] as ProgressState
      expect(last.scanned).toBe(2)
      expect(last.currentPath).toBe('/b')
    })

    it('fires on finish so subscribers see the terminal frame', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      const fn = vi.fn()
      store.subscribe(id, fn)
      store.finish(id, { status: 'done', indexed: 7 })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn.mock.calls[0][0].status).toBe('done')
    })

    it('unsubscribes cleanly without affecting other subscribers', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      const a = vi.fn()
      const b = vi.fn()
      const offA = store.subscribe(id, a)
      store.subscribe(id, b)
      offA()
      store.update(id, { scanned: 1 })
      expect(a).not.toHaveBeenCalled()
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('returns a no-op unsubscribe for unknown jobIds', () => {
      const off = store.subscribe('missing', () => undefined)
      expect(() => off()).not.toThrow()
    })

    it('a throwing subscriber does not break other subscribers or the store', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      const good = vi.fn()
      store.subscribe(id, () => { throw new Error('boom') })
      store.subscribe(id, good)
      store.update(id, { scanned: 1 })
      expect(good).toHaveBeenCalledTimes(1)
    })
  })

  describe('lifecycle integration', () => {
    it('full happy-path: start → updates → done → cleanup', () => {
      const id = store.start({ galaxyId: 5, galaxyName: 'photos' })
      const events: ProgressState[] = []
      store.subscribe(id, s => events.push(s))

      store.update(id, { scanned: 1, indexed: 1, currentPath: '/x' })
      store.update(id, { scanned: 2, indexed: 2, currentPath: '/y' })
      store.finish(id, { status: 'done', scanned: 2, indexed: 2, total: 2 })

      expect(events).toHaveLength(3)
      expect(events.map(e => e.status)).toEqual(['running', 'running', 'done'])

      vi.advanceTimersByTime(60_001)
      expect(store.has(id)).toBe(false)
      expect(store.get(id)).toBeNull()
    })

    it('cancel flow: start → updates → cancel → finish(cancelled) → cleanup', () => {
      const id = store.start({ galaxyId: null, galaxyName: null })
      store.update(id, { scanned: 50, indexed: 48 })
      store.cancel(id)
      // walker would observe isCancelled then stop; daemon then calls finish
      store.finish(id, { status: 'cancelled', scanned: 50, indexed: 48 })
      expect(store.get(id)!.status).toBe('cancelled')
      vi.advanceTimersByTime(60_001)
      expect(store.has(id)).toBe(false)
    })
  })
})
