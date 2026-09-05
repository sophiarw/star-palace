import { describe, expect, it } from 'vitest'
import { fileStellarAppearance, pointStellarAppearance, STELLAR_BASE_COLORS, STELLAR_PALETTE, stellarAppearance, stellarMagnitude, stellarSaturation, stellarSeed } from '../../src/renderer/src/atlas/stellarVisual'
import { objectRadius, seedFor } from '../../src/renderer/src/atlas/scene'
import { spriteIndex, SPRITE_COLUMNS, SPRITE_ROWS } from '../../src/renderer/src/atlas/celestialSprites'

describe('canonical stellar identity', () => {
  it('uses explicit favorites rather than bytes, extensions, or legacy classifications for landmark silhouettes', () => {
    const file = { id: 'archive.zip', size: 2 ** 50, starType: 'black-hole' }
    expect(fileStellarAppearance(file).objectType).toBe('main-sequence')
    expect(fileStellarAppearance({ ...file, isFavorite: true }).objectType).toBe('pulsar')
    expect(fileStellarAppearance({ ...file, isFavorite: true, favoriteAppearance: 'black-hole' }).objectType).toBe('black-hole')
    expect(fileStellarAppearance({ ...file, isFavorite: false, favoriteAppearance: 'black-hole' }).objectType).toBe('main-sequence')
  })
  it('keeps absolute bytes bounded and deterministic independently of library membership', () => {
    const seed = stellarSeed('notes.md')
    expect(seed).toBe(seedFor('notes.md'))
    expect(stellarAppearance(seed, 0).radiusScale).toBe(.38)
    expect(stellarAppearance(seed, 2 ** 60).radiusScale).toBeCloseTo(2.1)
    expect(stellarAppearance(seed, 1024).radiusScale).toBeLessThan(stellarAppearance(seed, 2 ** 20).radiusScale)
    expect(stellarAppearance(seed, 2 ** 20)).toEqual(stellarAppearance(seed, 2 ** 20))
    for (const invalid of [undefined, NaN, Infinity, -1]) {
      expect(stellarMagnitude(invalid)).toBe(.5)
      expect(Number.isFinite(stellarAppearance(seed, invalid).radiusScale)).toBe(true)
    }
  })
  it('keeps ordinary small stars pale and reserves saturated tails for a minority of larger stars', () => {
    let tails = 0
    for (let i = 0; i < 10000; i++) {
      const seed = stellarSeed('file-' + i), small = stellarAppearance(seed, 1024), large = stellarAppearance(seed, 2 ** 30)
      expect(STELLAR_BASE_COLORS).toContain(small.color)
      expect(stellarSaturation(seed, 2 ** 30)).toBeGreaterThanOrEqual(.03)
      expect(stellarSaturation(seed, 2 ** 30)).toBeLessThanOrEqual(.5)
      if (!(STELLAR_BASE_COLORS as readonly string[]).includes(large.color)) tails++
      expect(STELLAR_PALETTE).toContain(large.color)
    }
    expect(tails).toBeGreaterThan(100)
    expect(tails).toBeLessThan(1500)
  })
  it('invalidates cached scalar appearance when bytes or explicit favorite state changes', () => {
    const point: { id: string; sizeBytes: number; objectType: 'main-sequence' | 'pulsar' } = { id: 'stable', sizeBytes: 1024, objectType: 'main-sequence' }
    const before = pointStellarAppearance(point)
    expect(pointStellarAppearance(point)).toBe(before)
    point.sizeBytes = 2 ** 30
    expect(pointStellarAppearance(point).radiusScale).toBeGreaterThan(before.radiusScale)
    point.objectType = 'pulsar'
    expect(pointStellarAppearance(point).objectType).toBe('pulsar')
    expect(pointStellarAppearance(point).radiusScale).toBe(1.8)
  })
  it('fits every possible canonical color and favorite into the fixed sprite atlas', () => {
    const indices = STELLAR_PALETTE.map(color => spriteIndex('main-sequence', 0, color))
    expect(new Set(indices).size).toBe(STELLAR_PALETTE.length)
    for (const i of [...indices, spriteIndex('pulsar', 0, '#d5dfe9'), spriteIndex('black-hole', 0, '#d5dfe9')]) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(SPRITE_COLUMNS * SPRITE_ROWS)
    }
  })
  it('applies the byte multiplier once to the same continuous zoom curve used for hit testing and GPU instances', () => {
    const point = { id: 'file', radius: 25, zoomable: true, stellar: true, sizeBytes: 2 ** 20 }
    for (const zoom of [.003, .06, .4, .5, 2, 12, 120]) {
      const scale = stellarAppearance(stellarSeed(point.id), point.sizeBytes).radiusScale
      expect(objectRadius(point, zoom)).toBeCloseTo(objectRadius({ radius: 25 * scale, zoomable: true }, zoom), 10)
      expect(objectRadius(point, zoom + .00001) - objectRadius(point, zoom)).toBeLessThan(.01)
    }
  })
})
