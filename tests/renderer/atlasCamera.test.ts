import { expect, it } from 'vitest'
import { objectRadius, project, unproject, zoomAt } from '../../src/renderer/src/atlas/scene'

it('keeps the pointer world coordinate fixed from galaxy scale to close-up and back', () => {
  const original = { x: 3421.7, y: -992.4, zoom: .012 }, pointer = [175, 391], size = [900, 650]
  let camera = original
  const world = unproject(pointer[0], pointer[1], camera, size[0], size[1])
  for (const factor of [...Array<number>(40).fill(1.2), ...Array<number>(40).fill(1 / 1.2)]) {
    camera = zoomAt(camera, factor, pointer[0], pointer[1], size[0], size[1])
    const screen = project(world[0], world[1], camera, size[0], size[1])
    expect(screen[0]).toBeCloseTo(pointer[0], 7); expect(screen[1]).toBeCloseTo(pointer[1], 7)
  }
  expect(camera.zoom).toBeCloseTo(original.zoom, 10)
  expect(camera.x).toBeCloseTo(original.x, 7); expect(camera.y).toBeCloseTo(original.y, 7)
})

it('keeps even clamped zoom anchored and grows artwork continuously across old transition thresholds', () => {
  const camera = { x: 40, y: 50, zoom: 119 }, next = zoomAt(camera, 10, 100, 200, 800, 600)
  expect(next.zoom).toBe(120)
  const before = unproject(100, 200, camera, 800, 600), after = unproject(100, 200, next, 800, 600)
  expect(after[0]).toBeCloseTo(before[0]); expect(after[1]).toBeCloseTo(before[1])
  const star = { radius: 25, zoomable: true }
  expect(objectRadius(star, .5)).toBeGreaterThan(35)
  expect(objectRadius(star, 2) / objectRadius(star, .5)).toBeLessThan(1.5)
  expect(objectRadius(star, .03)).toBeLessThan(4)
  for (const zoom of [.06, .4, .07, .18, .22, .65, 1.3, 1.5, 6]) {
    expect(objectRadius(star, zoom + .0001) - objectRadius(star, zoom)).toBeLessThan(.02)
  }
})
