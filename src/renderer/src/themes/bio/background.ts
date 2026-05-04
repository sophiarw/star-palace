/**
 * Bioluminescent background — diagonal teal-into-deep-navy wash with
 * oversized translucent ovals (paper-feel) and sparse mint sparkles.
 * Matches the deck's `bioBg`.
 */

import type { ThemeBackground } from '../types'
import { BIO } from './drawers'

// RGBA tuples (peak-alpha at gradient center). Each wash is rendered as a
// radial gradient that fades to alpha=0 at the rim, so overlapping ovals read
// as soft watercolor washes instead of hard-edged grey ellipses.
const WASH_COLORS: readonly [number, number, number, number][] = [
  [95, 210, 192, 0.10],   // teal
  [255, 154, 139, 0.08],  // coral
  [155, 124, 216, 0.08],  // mauve
] as const

function makeRng(seed: number): () => number {
  let s = (seed | 0) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const bioBackground: ThemeBackground = {
  // Mid-tone of the diagonal wash so a sliver behind the overlay still
  // reads as deep tide-pool rather than the JWST slate.
  canvasFill: BIO.bg1,
  // The Bio sky is the diagonal teal-into-navy gradient + watercolor washes
  // + sparkles; the deep-field starfield underneath would clash with the
  // organic mood.
  replacesBackdrop: true,
  overlay(ctx, w, h) {
    // Re-stamp the diagonal gradient under the existing scene.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, BIO.bg1)
    g.addColorStop(1, BIO.bg2)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    const rng = makeRng(((w | 0) * 73856093) ^ ((h | 0) * 19349663) ^ 0xB10)

    // Watercolor wash ovals — large translucent shapes for paper feel.
    // Each oval is a radial gradient with alpha=0 at the rim so the boundary
    // never reads as a hard ellipse against the underlying scene.
    for (let i = 0; i < 5; i++) {
      const [r, g, b, a] = WASH_COLORS[Math.floor(rng() * WASH_COLORS.length)]
      const cx = rng() * w
      const cy = rng() * h
      const rx = w * 0.34
      const ry = h * 0.34
      const angle = rng() * Math.PI
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(angle)
      ctx.scale(1, ry / rx)
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
      grad.addColorStop(0, `rgba(${r},${g},${b},${a})`)
      grad.addColorStop(0.55, `rgba(${r},${g},${b},${a * 0.55})`)
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, rx, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // Sparkles — scale count with canvas area so big windows don't look
    // empty (deck used a fixed 30 for a ~250px preview).
    const count = Math.min(180, Math.round((w * h) / 30000))
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `rgba(168,240,200,${0.3 + rng() * 0.4})`
      ctx.beginPath()
      ctx.arc(rng() * w, rng() * h, 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  },
}
