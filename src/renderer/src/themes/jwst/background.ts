import type { ThemeBackground } from '../types'
import { paintJwstDeepField } from '../../components/StarMap/backgroundNebula'

/**
 * JWST background — deep-space slate base + Stage C deep-field nebula
 * wash. `canvasFill` still runs first as the opaque clear so resize /
 * DPR transitions don't reveal stale pixels; `paint` then draws the
 * teal+pink nebula clouds + 180 colour-temp pinpoints on top, sitting
 * underneath the existing prerendered parallax backdrop. The painter
 * caches its output (see backgroundNebula.ts), so steady-state cost is
 * one drawImage call per frame.
 */
export const jwstBackground: ThemeBackground = {
  canvasFill: '#05060f',
  paint: paintJwstDeepField,
  // No per-frame overlay for JWST. Scanlines / aberration are vapor-only
  // (Stage D); the deep-field wash already provides the colour bias.
}
