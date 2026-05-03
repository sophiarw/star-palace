import type { ThemeBackground } from '../types'

/**
 * JWST background — deep-space slate. The existing prerendered backdrop
 * (`StarMap.background`) and vignette do the heavy lifting; the canvas
 * clear pass just needs an opaque dark base so resize / DPR transitions
 * don't reveal stale pixels.
 */
export const jwstBackground: ThemeBackground = {
  canvasFill: '#0a0d1a',
  // No per-frame overlay for JWST. The deep-field backdrop is drawn by
  // StarMap's existing parallax pass (it owns the `getBackdrop()` cache).
}
