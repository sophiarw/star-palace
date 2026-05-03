/**
 * Bioluminescent background — diagonal teal-into-deep-navy wash with
 * oversized translucent ovals (paper-feel) and sparse mint sparkles.
 * Matches the deck's `bioBg`.
 */

import type { ThemeBackground } from '../types'
import { BIO } from './drawers'

const WASH_COLORS = [
  'rgba(95,210,192,0.05)',
  'rgba(255,154,139,0.04)',
  'rgba(155,124,216,0.04)',
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
    for (let i = 0; i < 5; i++) {
      const c = WASH_COLORS[Math.floor(rng() * WASH_COLORS.length)]
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.ellipse(rng() * w, rng() * h, w * 0.3, h * 0.3, rng() * Math.PI, 0, Math.PI * 2)
      ctx.fill()
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
