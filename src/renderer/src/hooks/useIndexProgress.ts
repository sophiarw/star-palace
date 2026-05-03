import { useEffect, useRef, useState } from 'react'
import type { IndexProgressEvent } from '../api'
import { indexProgressUrl } from '../api'

// F17 — wraps EventSource for `/api/index/progress?jobId=…`. Exposes a
// flattened, render-friendly snapshot so GalaxyPanel can show progress
// without re-running JSON.parse on every frame.
//
// `total` is null until the daemon's terminal frame fills it (walker doesn't
// pre-count for v1). `percent` is null in the same window — UI uses
// indeterminate stripes until percent flips numeric.
//
// `stalled` flips true after STALL_THRESHOLD_MS of no `lastUpdateAt`
// movement; spec wants a "stalled?" hint when Ollama hangs on a single file.

const STALL_THRESHOLD_MS = 10_000

export type IndexStatus = 'idle' | 'running' | 'done' | 'error' | 'cancelled'

export interface IndexProgressSnapshot {
  status: IndexStatus
  jobId: string | null
  scanned: number
  indexed: number
  skipped: number
  errors: number
  total: number | null
  percent: number | null
  currentPath: string | null
  startedAt: number | null
  lastUpdateAt: number | null
  errorMessage: string | null
  stalled: boolean
}

const IDLE_SNAPSHOT: IndexProgressSnapshot = {
  status: 'idle',
  jobId: null,
  scanned: 0,
  indexed: 0,
  skipped: 0,
  errors: 0,
  total: null,
  percent: null,
  currentPath: null,
  startedAt: null,
  lastUpdateAt: null,
  errorMessage: null,
  stalled: false,
}

export function useIndexProgress(jobId: string | null): IndexProgressSnapshot {
  const [snap, setSnap] = useState<IndexProgressSnapshot>(IDLE_SNAPSHOT)
  // Tick at 1 Hz so the "stalled?" badge can flip without a fresh SSE event.
  const [now, setNow] = useState(() => Date.now())
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!jobId) {
      setSnap(IDLE_SNAPSHOT)
      return
    }

    const es = new EventSource(indexProgressUrl(jobId))
    sourceRef.current = es

    es.onmessage = ev => {
      try {
        const parsed = JSON.parse(ev.data) as IndexProgressEvent
        setSnap(deriveSnapshot(parsed))
      } catch {
        // malformed frame — keep last good snapshot
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects; if the daemon is gone we expect a clean
      // close on the next tick. We don't flip status to 'error' here because
      // a transient network blip shouldn't tear the UI down.
    }

    return () => {
      es.close()
      sourceRef.current = null
    }
  }, [jobId])

  // 1 Hz wall-clock tick so `stalled` can recompute even when no SSE frame
  // has arrived. Cheap; no DOM work in the absence of a state change.
  useEffect(() => {
    if (snap.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [snap.status])

  if (snap.status !== 'running') return snap
  if (snap.lastUpdateAt === null) return snap
  const stalled = now - snap.lastUpdateAt > STALL_THRESHOLD_MS
  if (stalled === snap.stalled) return snap
  return { ...snap, stalled }
}

function deriveSnapshot(ev: IndexProgressEvent): IndexProgressSnapshot {
  const percent = ev.total && ev.total > 0
    ? Math.min(1, ev.scanned / ev.total)
    : null
  return {
    status: ev.status,
    jobId: ev.jobId,
    scanned: ev.scanned,
    indexed: ev.indexed,
    skipped: ev.skipped,
    errors: ev.errors,
    total: ev.total,
    percent,
    currentPath: ev.currentPath,
    startedAt: ev.startedAt,
    lastUpdateAt: ev.lastUpdateAt,
    errorMessage: ev.errorMessage,
    stalled: false,
  }
}
