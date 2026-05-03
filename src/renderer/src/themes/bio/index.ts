import type { Theme } from '../types'
import { bioDrawers, bioDefaultDrawer } from './drawers'
import { bioBackground } from './background'

/**
 * Bioluminescent — organic, watercolor + ink + glow. Each star type maps
 * to a tide-pool creature or forest flora: anemone, coral bloom,
 * jellyfish, sea urchin, spores, angler-light, twin flowers, mantaray,
 * carnivorous flower, moss patch.
 */
export const bioTheme: Theme = {
  id: 'bio',
  name: 'Bioluminescent',
  description: 'Organic, dreamy. Tide-pool creatures and glowing flora replace stars.',
  drawers: bioDrawers,
  defaultDrawer: bioDefaultDrawer,
  background: bioBackground,
  smoothing: 'high',
  flatLighting: true,
  ui: {
    accentColor: '#a8f0c8',  // mint
    fontStack: '"Instrument Serif", "Iowan Old Style", Georgia, serif',
    titleTransform: 'none',
  },
}
