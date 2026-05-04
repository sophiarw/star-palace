import type { Theme } from '../types'
import { atariDrawers, atariDefaultDrawer } from './drawers'
import { atariBackground } from './background'

/**
 * Atari low-res — 8-bit pixel art. The aesthetic IS low resolution, so
 * `dprCap: 1.0` pins the backing store to native CSS pixels regardless of
 * the user's display. `smoothing: 'off'` (nearest-neighbour) keeps blocks
 * crisp through the StarMap upscale pass.
 */
export const atariTheme: Theme = {
  id: 'atari',
  name: 'Atari low-res',
  description: '8-bit pixel art. Chunky blocks, sprite-style spikes, 8-color palette.',
  drawers: atariDrawers,
  defaultDrawer: atariDefaultDrawer,
  background: atariBackground,
  smoothing: 'off',
  dprCap: 1.0,
  constellationHalos: false,
  ui: {
    accentColor: '#ffd23f',  // Atari yellow
    fontStack: '"Press Start 2P", "VT323", "Courier New", monospace',
    titleTransform: 'uppercase',
    titleLetterSpacing: '0.1em',
  },
}
