import { describe, it, expect } from 'vitest'
import type { Star } from '../../src/shared/types'
import { buildSpatialGrid, forEachStarInBounds, CELL_SIZE } from '../../src/renderer/src/components/StarMap/spatialGrid'

// Only `id`, `x`, `y` are read by the spatial grid; the rest of Star is
// irrelevant. Cast through `unknown` to skip the strict-mode field check.
function star(id: string, x: number, y: number): Star {
  return { id, x, y } as unknown as Star
}

describe('spatialGrid', () => {
  it('groups stars by cell and visits only cells in bounds', () => {
    const stars: Star[] = [
      star('a', 5, 5),       // cell (0,0)
      star('b', 50, 50),     // cell (0,0)
      star('c', 150, 5),     // cell (1,0)
      star('d', -50, -50),   // cell (-1,-1)
      star('e', 999, 999),   // cell (9,9) — far away
    ]
    const grid = buildSpatialGrid(stars)
    expect(grid.cellSize).toBe(CELL_SIZE)

    const visited: string[] = []
    forEachStarInBounds(grid, 0, 0, 200, 100, s => visited.push(s.id))
    visited.sort()
    expect(visited).toEqual(['a', 'b', 'c'])
  })

  it('handles negative-coord cells correctly', () => {
    const stars: Star[] = [
      star('a', -250, -250),
      star('b', -150, -150),
      star('c', 100, 100),
    ]
    const grid = buildSpatialGrid(stars)
    const visited: string[] = []
    forEachStarInBounds(grid, -300, -300, -100, -100, s => visited.push(s.id))
    visited.sort()
    expect(visited).toEqual(['a', 'b'])
  })

  it('returns no stars for an empty bounds region', () => {
    const stars: Star[] = [star('a', 5, 5)]
    const grid = buildSpatialGrid(stars)
    const visited: string[] = []
    forEachStarInBounds(grid, 1000, 1000, 2000, 2000, s => visited.push(s.id))
    expect(visited).toEqual([])
  })
})
