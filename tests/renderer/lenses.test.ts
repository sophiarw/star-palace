import { describe, expect, it } from 'vitest'
import { lensAppearance } from '../../src/renderer/src/atlas/lenses'
import { INFRARED, ULTRAVIOLET, LENS_PALETTE } from '../../src/renderer/src/atlas/lensPalette'
import { spriteIndex, SPRITE_COLUMNS, SPRITE_ROWS } from '../../src/renderer/src/atlas/celestialSprites'
describe('Observing lenses', () => {
  it('uses absolute timestamps and sizes, independent of viewport membership', () => {
    const now = 2000000000
    expect(lensAppearance('recent', { modifiedAt: now }, now).alpha).toBeGreaterThan(lensAppearance('recent', { modifiedAt: now - 10 * 86400000 }, now).alpha)
    expect(lensAppearance('recent', {}, now)).toEqual({ color: ULTRAVIOLET.unknown, alpha: .4 })
    expect(lensAppearance('size', { size: 1024 }, now).color).not.toBe(lensAppearance('size', { size: 1024 ** 3 }, now).color)
    expect(lensAppearance('visible', {}, now)).toEqual({ alpha: 1 })
  })
  it('uses violet for all age bands and warm red for all size bands, including missing metadata', () => {
    const now = 2000000000
    for (const modifiedAt of [undefined, now, now - 86400000, now - 7 * 86400000]) {
      const color = lensAppearance('recent', { modifiedAt }, now).color!
      const [r, g, b] = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16))
      expect(b).toBeGreaterThan(r); expect(r).toBeGreaterThan(g)
    }
    for (const size of [undefined, NaN, -1, 0, 1024 ** 2, 16 * 1024 ** 2, 1024 ** 3]) {
      const color = lensAppearance('size', { size }, now).color!
      const [r, g, b] = [1, 3, 5].map(at => parseInt(color.slice(at, at + 2), 16))
      expect(r).toBeGreaterThan(g); expect(r).toBeGreaterThan(b)
    }
    expect(lensAppearance('size', { size: 1024 ** 2 }, now).color).toBe(INFRARED.medium)
    expect(lensAppearance('size', { size: 16 * 1024 ** 2 }, now).color).toBe(INFRARED.medium)
  })
  it('bakes distinct lens colors for ordinary stars and both favorite silhouettes inside the existing sheet', () => {
    const indices = LENS_PALETTE.flatMap(color => (['main-sequence', 'pulsar', 'black-hole'] as const).map(type => spriteIndex(type, 42, color)))
    expect(new Set(indices).size).toBe(LENS_PALETTE.length * 3)
    expect(Math.max(...indices)).toBeLessThan(SPRITE_COLUMNS * SPRITE_ROWS)
  })
})
