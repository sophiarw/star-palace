import { expect, it } from 'vitest'
import { pickTarget, starHitRadius } from '../../src/renderer/src/atlas/hitTargets'

it('selects nearby stars before overlapping region centers and chooses the closest star', () => {
  const region = { id: 'region', x: 20, y: 0, radius: 140, region: {} }
  const a = { id: 'a', x: 0, y: 0, radius: starHitRadius(2) }
  const b = { id: 'b', x: 45, y: 0, radius: starHitRadius(2) }
  expect(pickTarget([region, a, b], 20, 0)?.id).toBe('a')
  expect(pickTarget([region, a, b], 25, 0)?.id).toBe('b')
  expect(pickTarget([region, a, b], 90, 0)?.id).toBe('region')
  expect(pickTarget([a, b], 90, 0)).toBeNull()
})
