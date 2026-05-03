import type { Theme } from '../types'
import { vaporDrawers, vaporDefaultDrawer } from './drawers'
import { vaporBackground } from './background'

export const vaporTheme: Theme = {
  id: 'vapor',
  name: 'Vapor',
  description: 'Synthwave / chromatic-aberration. Sunset gradient, Tron grid, hot pink.',
  drawers: vaporDrawers,
  defaultDrawer: vaporDefaultDrawer,
  background: vaporBackground,
  ui: {
    accentColor: '#ff007a',  // hot pink
    fontStack: '"VT323", "Courier New", "Menlo", monospace',
    titleTransform: 'uppercase',
    titleLetterSpacing: '0.15em',
  },
}
