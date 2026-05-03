import type { ThemeBackground } from '../types'
import { paintJwstDeepField } from '../../components/StarMap/backgroundNebula'

/**
 * JWST background — Stage C deck-faithful deep-field. `canvasFill` runs
 * first as the opaque clear so resize / DPR transitions don't reveal
 * stale pixels (its colour matches `paintJwstDeepField`'s base fill so
 * any first-frame cache miss is invisible); `paint` then draws the
 * teal+pink nebula clouds + 180 colour-temp pinpoints. `replacesBackdrop`
 * tells StarMap to skip the legacy prerendered backdrop — the new
 * deck-style wash IS the background per the F-NEXT-C design (parallax
 * pan/zoom on the backdrop was an old-design trick that the deck doesn't
 * use). The painter caches its output (see backgroundNebula.ts), so
 * steady-state cost is one drawImage call per frame.
 */
export const jwstBackground: ThemeBackground = {
  canvasFill: '#05060f',
  paint: paintJwstDeepField,
  replacesBackdrop: true,
  // No per-frame overlay for JWST. Scanlines / aberration are vapor-only
  // (Stage D); the deep-field wash already provides the colour bias.
}
