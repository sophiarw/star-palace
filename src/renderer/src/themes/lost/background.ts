/**
 * Lost in space background — vertical deep-blue gradient with a sparse
 * sparkle field. Matches the deck's `lostBg`. Sparkles are deterministic
 * per canvas size so they stay put across pan / zoom.
 */

import type { ThemeBackground } from '../types'

const LOST_BG = '#0d1224'
const LOST_DEEP = '#080b18'

function makeRng(seed: number): () => number {
  let s = (seed | 0) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const lostBackground: ThemeBackground = {
  // Mid-tone fill so any sliver that escapes the overlay still reads
  // as deep space rather than the JWST slate.
  canvasFill: LOST_BG,
  overlay(ctx, w, h) {
    // Re-stamp the gradient under the existing scene so we sit over the
    // theme-picker's previous backdrop cache.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, LOST_DEEP)
    g.addColorStop(1, LOST_BG)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Sparkle field — 50 tiny stars in the deck preview; scale up with
    // canvas area so a 1080p window doesn't look empty.
    const count = Math.min(280, Math.round((w * h) / 18000))
    const rng = makeRng(((w | 0) * 73856093) ^ ((h | 0) * 19349663) ^ 0xCAFE)
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = `rgba(242,244,255,${0.3 + rng() * 0.5})`
      ctx.beginPath()
      ctx.arc(rng() * w, rng() * h, 0.5 + rng() * 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
  },
}
