import type { Theme } from '../types'
import { jwstDrawers, jwstDefaultDrawer } from './drawers'
import { jwstBackground } from './background'

export const jwstTheme: Theme = {
  id: 'jwst',
  name: 'JWST',
  description: 'Deep-space realism. Multi-stop gradients, additive halos, gold accent.',
  drawers: jwstDrawers,
  defaultDrawer: jwstDefaultDrawer,
  background: jwstBackground,
  smoothing: 'high',
  ui: {
    accentColor: '#ffe066',  // gold — matches existing production aesthetic
    fontStack: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    titleTransform: 'none',
  },
}
