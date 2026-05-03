/**
 * Theme registry smoke test — every registered theme must:
 *  - expose all 10 typed drawers (no fallback to default for known types),
 *  - declare a non-empty `canvasFill`,
 *  - declare a `defaultDrawer` for cluster-hue stars,
 *  - resolve through `getTheme` by id.
 *
 * The drawers themselves are exercised at runtime via the typed sprite
 * cache; this test just guards against a theme being added to the registry
 * with a missing slot (which would silently fall through to the default
 * drawer and lose its type-specific identity).
 */

import { describe, it, expect } from 'vitest'
import { STAR_TYPES } from '@shared/types'
import { listThemes, getTheme } from '../../src/renderer/src/themes/registry'

describe('theme registry', () => {
  it('lists all five themes', () => {
    const ids = listThemes().map((t) => t.id).sort()
    expect(ids).toEqual(['atari', 'bio', 'jwst', 'lost', 'vapor'])
  })

  for (const summary of listThemes()) {
    describe(`theme: ${summary.id}`, () => {
      const theme = getTheme(summary.id)!

      it('resolves by id', () => {
        expect(theme).not.toBeNull()
        expect(theme.id).toBe(summary.id)
      })

      it('declares a default drawer for cluster-hue stars', () => {
        expect(typeof theme.defaultDrawer).toBe('function')
      })

      it('declares a non-empty background canvasFill', () => {
        expect(theme.background).toBeDefined()
        expect(typeof theme.background.canvasFill).toBe('string')
        expect(theme.background.canvasFill.length).toBeGreaterThan(0)
      })

      for (const type of STAR_TYPES) {
        it(`provides a typed drawer for ${type}`, () => {
          const drawer = theme.drawers[type]
          expect(typeof drawer).toBe('function')
        })
      }
    })
  }

  it('atari sets dprCap = 1.0 for the 8-bit aesthetic', () => {
    const atari = getTheme('atari')!
    expect(atari.dprCap).toBe(1.0)
    expect(atari.smoothing).toBe('off')
  })

  it('jwst, vapor, lost, bio leave dprCap unset (= native DPR)', () => {
    for (const id of ['jwst', 'vapor', 'lost', 'bio']) {
      expect(getTheme(id)!.dprCap).toBeUndefined()
    }
  })
})
