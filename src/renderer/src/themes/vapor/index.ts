import type { Theme } from '../types'
import { vaporDrawers, vaporDefaultDrawer } from './drawers'
import { vaporBackground } from './background'
import { drawScanlines } from '../../components/StarMap/vaporCrt'

/**
 * F-NEXT-D — vapor's CRT post-pass. The chromatic-aberration shimmer
 * piece is applied per focused star inside the StarMap decoration pass
 * (it needs per-sprite coords + radius), so the theme-level post-pass
 * only owns the full-frame scanline overlay.
 */
function vaporPostPass(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  drawScanlines(ctx, w, h)
}

export const vaporTheme: Theme = {
  id: 'vapor',
  name: 'Vapor',
  description: 'Synthwave / chromatic-aberration. Sunset gradient, Tron grid, hot pink.',
  drawers: vaporDrawers,
  defaultDrawer: vaporDefaultDrawer,
  background: vaporBackground,
  smoothing: 'off',
  postPass: vaporPostPass,
  constellationHalos: false,
  ui: {
    accentColor: '#ff007a',  // hot pink
    fontStack: '"VT323", "Courier New", "Menlo", monospace',
    titleTransform: 'uppercase',
    titleLetterSpacing: '0.15em',
  },
}
