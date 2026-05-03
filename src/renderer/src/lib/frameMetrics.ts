// Real-time render-loop metrics for diagnosing pan/zoom/scroll smoothness.
//
// Lives outside React state so the rAF loop can write hot-path numbers
// without forcing renders. Subscribers (PerfOverlay) poll on an interval
// and pull a snapshot — cheap, no event spam.
//
// Tracks:
// - per-frame delta time (ring buffer, last N=240 frames ≈ 4s at 60 fps)
// - per-pass timing inside draw() (Phase 0 instrumentation; ring buffers
//   keyed by pass name so the overlay can show which pass dominates p99)
// - whether each frame ran during a user interaction (drag, wheel, vim
//   pan velocity, pin drag, animation continuous)
// - skipped frames (dirty=false rAF gate)
// - last frame's visible-star count (drives a quick "are we drawing too
//   much?" sanity read)
// - external counters (sprite-cache miss/size, handleMouseMove time) —
//   exposed via `recordCounter` / `recordTiming` so the renderer can
//   surface non-frame work without extra plumbing.
//
// `snapshot()` derives FPS, p50/p99 ms, dropped-frame count, and an
// interacting-only subset so the user can compare idle smoothness vs.
// the cost of the gestures that actually feel laggy.
// `passSnapshot()` returns the per-pass ranking sorted by p99 desc.

const CAP = 240
const PASS_CAP = 240
const DROPPED_MS_THRESHOLD = 33  // ~30 fps

interface Entry {
  deltaMs: number
  interacting: boolean
}

export interface FrameSnapshot {
  fps: number
  avgMs: number
  p50Ms: number
  p99Ms: number
  worstMs: number
  frameCount: number
  droppedCount: number
  skippedCount: number
  interactingFrameCount: number
  interactingAvgMs: number
  interactingP99Ms: number
  visibleStars: number
}

export interface PassSummary {
  name: string
  n: number
  meanMs: number
  p50Ms: number
  p99Ms: number
  worstMs: number
}

export interface CounterSummary {
  [name: string]: number
}

export class FrameMetrics {
  private buf: Entry[] = []
  private idx = 0
  private skipped = 0
  private visibleStars = 0
  // Total frames recorded since last reset (overflows fine — used for sanity).
  private total = 0
  // Per-pass ring buffers. Float32Array per pass keyed by name; we store the
  // delta in ms. Map<name, {buf, idx, n}>. Allocated lazily so a pass not
  // wrapped with recordPass() never costs anything.
  private passBufs: Map<string, { buf: Float32Array; idx: number; n: number }> = new Map()
  // Free-form counters (sprite-cache misses, sizes, etc).
  private counters: Map<string, number> = new Map()
  // One-off timings (e.g. last handleMouseMove). Same ring shape as passes
  // but conceptually distinct from per-frame instrumentation.
  private timingBufs: Map<string, { buf: Float32Array; idx: number; n: number }> = new Map()

  record(deltaMs: number, interacting: boolean, visibleStars: number): void {
    if (this.buf.length < CAP) {
      this.buf.push({ deltaMs, interacting })
    } else {
      this.buf[this.idx] = { deltaMs, interacting }
      this.idx = (this.idx + 1) % CAP
    }
    this.visibleStars = visibleStars
    this.total++
  }

  recordSkipped(): void {
    this.skipped++
  }

  // Per-pass timing. Called from inside StarMap.draw() once per pass per
  // frame. Lazy-allocates the ring so an instrumented pass that's never
  // hit (e.g. activeHull when no collection active) costs zero memory.
  recordPass(name: string, ms: number): void {
    let entry = this.passBufs.get(name)
    if (!entry) {
      entry = { buf: new Float32Array(PASS_CAP), idx: 0, n: 0 }
      this.passBufs.set(name, entry)
    }
    entry.buf[entry.idx] = ms
    entry.idx = (entry.idx + 1) % PASS_CAP
    if (entry.n < PASS_CAP) entry.n++
  }

  // Free-form counter (e.g. sprite-cache miss count). Caller manages the
  // semantic — this just stores the latest int so the overlay can read it.
  recordCounter(name: string, value: number): void {
    this.counters.set(name, value)
  }

  // Free-form timing histogram (e.g. handleMouseMove). Same ring shape as
  // passes; separate map so per-pass and per-event categories don't collide.
  recordTiming(name: string, ms: number): void {
    let entry = this.timingBufs.get(name)
    if (!entry) {
      entry = { buf: new Float32Array(PASS_CAP), idx: 0, n: 0 }
      this.timingBufs.set(name, entry)
    }
    entry.buf[entry.idx] = ms
    entry.idx = (entry.idx + 1) % PASS_CAP
    if (entry.n < PASS_CAP) entry.n++
  }

  reset(): void {
    this.buf = []
    this.idx = 0
    this.skipped = 0
    this.total = 0
    this.visibleStars = 0
    this.passBufs.clear()
    this.counters.clear()
    this.timingBufs.clear()
  }

  snapshot(): FrameSnapshot {
    const n = this.buf.length
    if (n === 0) {
      return {
        fps: 0, avgMs: 0, p50Ms: 0, p99Ms: 0, worstMs: 0,
        frameCount: 0, droppedCount: 0, skippedCount: this.skipped,
        interactingFrameCount: 0, interactingAvgMs: 0, interactingP99Ms: 0,
        visibleStars: this.visibleStars,
      }
    }
    const all: number[] = []
    const interacting: number[] = []
    let dropped = 0
    let sumAll = 0
    for (let i = 0; i < n; i++) {
      const e = this.buf[i]
      all.push(e.deltaMs)
      sumAll += e.deltaMs
      if (e.deltaMs > DROPPED_MS_THRESHOLD) dropped++
      if (e.interacting) interacting.push(e.deltaMs)
    }
    all.sort((a, b) => a - b)
    interacting.sort((a, b) => a - b)
    const avgMs = sumAll / n
    const p50Ms = all[Math.floor(n * 0.5)]
    const p99Ms = all[Math.min(n - 1, Math.floor(n * 0.99))]
    const worstMs = all[n - 1]
    const fps = avgMs > 0 ? 1000 / avgMs : 0
    const interactingAvgMs = interacting.length > 0
      ? interacting.reduce((a, b) => a + b, 0) / interacting.length
      : 0
    const interactingP99Ms = interacting.length > 0
      ? interacting[Math.min(interacting.length - 1, Math.floor(interacting.length * 0.99))]
      : 0
    return {
      fps, avgMs, p50Ms, p99Ms, worstMs,
      frameCount: n, droppedCount: dropped, skippedCount: this.skipped,
      interactingFrameCount: interacting.length,
      interactingAvgMs, interactingP99Ms,
      visibleStars: this.visibleStars,
    }
  }

  // Per-pass ranking. Sorted by p99 desc — overlay rows red where p99 > 4 ms
  // mean a pass eats > 25 % of a 60 fps frame budget.
  passSnapshot(): PassSummary[] {
    const out: PassSummary[] = []
    for (const [name, entry] of this.passBufs) {
      if (entry.n === 0) continue
      const samples = Array.from(entry.buf.slice(0, entry.n))
      samples.sort((a, b) => a - b)
      const sum = samples.reduce((a, b) => a + b, 0)
      out.push({
        name,
        n: entry.n,
        meanMs: sum / entry.n,
        p50Ms: samples[Math.floor(entry.n * 0.5)],
        p99Ms: samples[Math.min(entry.n - 1, Math.floor(entry.n * 0.99))],
        worstMs: samples[entry.n - 1],
      })
    }
    out.sort((a, b) => b.p99Ms - a.p99Ms)
    return out
  }

  countersSnapshot(): CounterSummary {
    const out: CounterSummary = {}
    for (const [k, v] of this.counters) out[k] = v
    return out
  }

  timingSnapshot(): PassSummary[] {
    const out: PassSummary[] = []
    for (const [name, entry] of this.timingBufs) {
      if (entry.n === 0) continue
      const samples = Array.from(entry.buf.slice(0, entry.n))
      samples.sort((a, b) => a - b)
      const sum = samples.reduce((a, b) => a + b, 0)
      out.push({
        name,
        n: entry.n,
        meanMs: sum / entry.n,
        p50Ms: samples[Math.floor(entry.n * 0.5)],
        p99Ms: samples[Math.min(entry.n - 1, Math.floor(entry.n * 0.99))],
        worstMs: samples[entry.n - 1],
      })
    }
    out.sort((a, b) => b.p99Ms - a.p99Ms)
    return out
  }
}

// Single shared store. The renderer's rAF loop is the only writer; readers
// (PerfOverlay) poll on an interval. Module-level singleton keeps prop
// plumbing out of every component on the path between StarMap and the
// overlay.
export const frameMetrics = new FrameMetrics()
