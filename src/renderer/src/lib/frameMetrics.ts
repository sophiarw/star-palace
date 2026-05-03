// Real-time render-loop metrics for diagnosing pan/zoom/scroll smoothness.
//
// Lives outside React state so the rAF loop can write hot-path numbers
// without forcing renders. Subscribers (PerfOverlay) poll on an interval
// and pull a snapshot — cheap, no event spam.
//
// Tracks:
// - per-frame delta time (ring buffer, last N=240 frames ≈ 4s at 60 fps)
// - whether each frame ran during a user interaction (drag, wheel, vim
//   pan velocity, pin drag, animation continuous)
// - skipped frames (dirty=false rAF gate)
// - last frame's visible-star count (drives a quick "are we drawing too
//   much?" sanity read)
//
// `snapshot()` derives FPS, p50/p99 ms, dropped-frame count, and an
// interacting-only subset so the user can compare idle smoothness vs.
// the cost of the gestures that actually feel laggy.

const CAP = 240
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

export class FrameMetrics {
  private buf: Entry[] = []
  private idx = 0
  private skipped = 0
  private visibleStars = 0
  // Total frames recorded since last reset (overflows fine — used for sanity).
  private total = 0

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

  reset(): void {
    this.buf = []
    this.idx = 0
    this.skipped = 0
    this.total = 0
    this.visibleStars = 0
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
}

// Single shared store. The renderer's rAF loop is the only writer; readers
// (PerfOverlay) poll on an interval. Module-level singleton keeps prop
// plumbing out of every component on the path between StarMap and the
// overlay.
export const frameMetrics = new FrameMetrics()
