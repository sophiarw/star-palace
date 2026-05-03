import { describe, it, expect } from 'vitest'
import { FrameMetrics } from '../../src/renderer/src/lib/frameMetrics'

describe('FrameMetrics', () => {
  it('snapshot of empty store returns zeroed metrics', () => {
    const m = new FrameMetrics()
    const s = m.snapshot()
    expect(s.frameCount).toBe(0)
    expect(s.fps).toBe(0)
    expect(s.avgMs).toBe(0)
  })

  it('computes fps and avg from recorded deltas', () => {
    const m = new FrameMetrics()
    for (let i = 0; i < 60; i++) m.record(16.67, false, 100)
    const s = m.snapshot()
    expect(s.frameCount).toBe(60)
    expect(s.avgMs).toBeCloseTo(16.67, 1)
    expect(s.fps).toBeCloseTo(60, 0)
    expect(s.droppedCount).toBe(0)
  })

  it('counts dropped frames (>33ms)', () => {
    const m = new FrameMetrics()
    m.record(16, false, 0)
    m.record(50, false, 0)
    m.record(16, false, 0)
    m.record(100, false, 0)
    expect(m.snapshot().droppedCount).toBe(2)
  })

  it('tracks interacting subset separately', () => {
    const m = new FrameMetrics()
    for (let i = 0; i < 30; i++) m.record(16, false, 0)
    for (let i = 0; i < 20; i++) m.record(33, true, 0)
    const s = m.snapshot()
    expect(s.interactingFrameCount).toBe(20)
    expect(s.interactingAvgMs).toBeCloseTo(33, 1)
  })

  it('p99 reflects tail latency', () => {
    const m = new FrameMetrics()
    for (let i = 0; i < 99; i++) m.record(10, false, 0)
    m.record(200, false, 0)  // single tail spike
    const s = m.snapshot()
    expect(s.p99Ms).toBeGreaterThanOrEqual(10)
    expect(s.worstMs).toBe(200)
  })

  it('skippedCount accumulates separately from frameCount', () => {
    const m = new FrameMetrics()
    m.record(16, false, 0)
    m.recordSkipped()
    m.recordSkipped()
    const s = m.snapshot()
    expect(s.frameCount).toBe(1)
    expect(s.skippedCount).toBe(2)
  })

  it('reset clears all state', () => {
    const m = new FrameMetrics()
    m.record(16, true, 50)
    m.recordSkipped()
    m.reset()
    const s = m.snapshot()
    expect(s.frameCount).toBe(0)
    expect(s.skippedCount).toBe(0)
    expect(s.visibleStars).toBe(0)
  })

  it('ring buffer caps at 240 entries', () => {
    const m = new FrameMetrics()
    for (let i = 0; i < 500; i++) m.record(16, false, 0)
    expect(m.snapshot().frameCount).toBe(240)
  })
})
