import type { Theme } from '../types'
import { lostDrawers, lostDefaultDrawer } from './drawers'
import { lostBackground } from './background'

/**
 * Lost in space — illustrated, narrative. Each "star type" maps to a
 * different stranded-cosmonaut object: astronaut, rusty ship, rocket,
 * satellite, asteroid cluster, lighthouse beacon, twin spacewalkers,
 * jellyfish-pilot, wormhole, debris field. Same engine, different cast.
 */
export const lostTheme: Theme = {
  id: 'lost',
  name: 'Lost in space',
  description: 'Illustrated. Astronauts, ships, and wormholes replace stars.',
  drawers: lostDrawers,
  defaultDrawer: lostDefaultDrawer,
  background: lostBackground,
  smoothing: 'high',
  flatLighting: true,
  constellationHalos: false,
  labels: {
    'main-sequence': 'Astronaut',
    'red-giant': 'Rusty ship',
    'blue-supergiant': 'Rocket',
    'white-dwarf': 'Satellite',
    'neutron-star': 'Asteroid cluster',
    'pulsar': 'Space lighthouse',
    'binary': 'Two astronauts',
    'quasar': 'Space jellyfish',
    'black-hole': 'Wormhole',
    'nebula': 'Debris field',
  },
  ui: {
    accentColor: '#7ec8ff',  // visor-cyan
    fontStack: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    titleTransform: 'none',
  },
}
