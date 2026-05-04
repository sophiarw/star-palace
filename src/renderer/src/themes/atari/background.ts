/**
 * Atari low-res background — dark navy field stamped with chunky pixel
 * stars in the 8-colour palette. The pattern is deterministic per-frame
 * (seeded from the canvas size) so panning doesn't produce flicker.
 */

import type { ThemeBackground } from '../types'

// Match the deck's `ATARI.bg`. The renderer's clear pass uses this colour
// so resize / DPR transitions never reveal stale pixels.
const ATARI_BG = '#1a1a2e'
const STAR_PALETTE = ['#fff8d8', '#ffd23f', '#7fdbff'] as const

/** Cheap deterministic LCG seeded from canvas size. Same seed → same
 * pattern, so the chunky pixel stars stay put across frames. */
function makeRng(seed: number): () => number {
  let s = (seed | 0) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const atariBackground: ThemeBackground = {
  canvasFill: ATARI_BG,
  // The Atari sky is the navy fill + chunky pixel stars; rendering the
  // deep-field deep-space backdrop underneath would leak JWST nebulae.
  replacesBackdrop: true,
  overlay(ctx, w, h) {
    // Re-stamp under the clear pass so the deep-field cache (a JWST
    // artefact baked at boot time) doesn't bleed into the Atari sky.
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = ATARI_BG
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Pixel field. Block size scales with the smaller canvas dim so the
    // pattern reads at any window size; ~80 stars total to keep cost flat.
    const px = Math.max(2, Math.round(Math.min(w, h) / 200))
    const rng = makeRng(((w | 0) * 73856093) ^ ((h | 0) * 19349663))
    for (let i = 0; i < 80; i++) {
      const x = Math.round(rng() * w / px) * px
      const y = Math.round(rng() * h / px) * px
      const c = STAR_PALETTE[Math.floor(rng() * STAR_PALETTE.length)]
      ctx.fillStyle = c
      ctx.fillRect(x, y, px, px)
    }
  },
}
