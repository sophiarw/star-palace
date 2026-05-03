import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld, type Camera } from '../../src/renderer/src/components/StarMap/coords'

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('coords round-trip', () => {
  it('worldToScreen ∘ screenToWorld = id for random points and cameras', () => {
    const r = rng(42)
    for (let i = 0; i < 200; i++) {
      const cam: Camera = {
        cx: (r() - 0.5) * 1000,
        cy: (r() - 0.5) * 1000,
        zoom: 0.05 + r() * 50,
      }
      const w = 200 + r() * 2000
      const h = 200 + r() * 1500
      const wx = (r() - 0.5) * 2000
      const wy = (r() - 0.5) * 2000

      const [sx, sy] = worldToScreen(wx, wy, cam, w, h)
      const [bx, by] = screenToWorld(sx, sy, cam, w, h)
      expect(bx).toBeCloseTo(wx, 6)
      expect(by).toBeCloseTo(wy, 6)
    }
  })

  it('center of viewport maps to camera center', () => {
    const cam: Camera = { cx: 100, cy: -50, zoom: 2.5 }
    const [wx, wy] = screenToWorld(640, 360, cam, 1280, 720)
    expect(wx).toBeCloseTo(100, 9)
    expect(wy).toBeCloseTo(-50, 9)
  })

  it('zoom doubles screen distance from center', () => {
    const cam1: Camera = { cx: 0, cy: 0, zoom: 1 }
    const cam2: Camera = { cx: 0, cy: 0, zoom: 2 }
    const w = 1000, h = 1000
    const [sx1] = worldToScreen(100, 0, cam1, w, h)
    const [sx2] = worldToScreen(100, 0, cam2, w, h)
    expect(sx1 - w / 2).toBeCloseTo(100)
    expect(sx2 - w / 2).toBeCloseTo(200)
  })
})
