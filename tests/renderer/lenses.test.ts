import { describe, expect, it } from 'vitest'
import { lensAppearance } from '../../src/renderer/src/atlas/lenses'
describe('Observing lenses', () => {
  it('uses absolute timestamps and sizes, independent of viewport membership', () => {
    const now = 2000000000
    expect(lensAppearance('recent', { modifiedAt: now }, now).alpha).toBeGreaterThan(lensAppearance('recent', { modifiedAt: now - 10 * 86400000 }, now).alpha)
    expect(lensAppearance('recent', {}, now)).toEqual({ alpha: .4 })
    expect(lensAppearance('size', { size: 1024 }, now).color).not.toBe(lensAppearance('size', { size: 1024 ** 3 }, now).color)
    expect(lensAppearance('visible', {}, now)).toEqual({ alpha: 1 })
  })
})
