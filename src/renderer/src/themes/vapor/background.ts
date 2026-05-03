/**
 * Vapor background — synthwave sunset gradient + Tron-grid horizon (Stage C
 * `paint`, owns the deep background, cached offscreen so vapor pays one
 * `drawImage` per frame instead of re-stroking the grid every frame).
 *
 * CRT scanlines live in the theme `postPass` (see `vaporCrt.drawScanlines`
 * from Stage D) so they sit above the HUD chevrons / labels like a real
 * CRT screen rather than under them.
 *
 * `replacesBackdrop` tells StarMap to skip the JWST deep-field prerendered
 * backdrop for this theme — `paint` owns the full canvas.
 */

import type { ThemeBackground } from '../types'
import { paintVaporBg } from '../../components/StarMap/backgroundNebula'

export const vaporBackground: ThemeBackground = {
  canvasFill: '#2a0050',
  paint: paintVaporBg,
  replacesBackdrop: true,
}
