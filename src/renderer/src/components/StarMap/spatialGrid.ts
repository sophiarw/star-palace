// Bucketed spatial grid over star world positions. Lets the draw loop iterate
// only the cells touched by the visible viewport instead of the full corpus —
// at 5k+ stars zoomed in to a small region, this drops per-frame work from
// O(N) to O(visible_cells).
//
// Cells are square `CELL_SIZE` world units. Keys are encoded as `${cx}|${cy}`
// strings for safety against negative coords (galaxy origins push positions
// outside any single positive offset).

import type { Star } from '@shared/types'

export const CELL_SIZE = 100

export interface SpatialGrid {
  readonly cells: ReadonlyMap<string, Star[]>
  readonly cellSize: number
}

function cellKey(cx: number, cy: number): string {
  return `${cx}|${cy}`
}

export function buildSpatialGrid(stars: readonly Star[]): SpatialGrid {
  const cells = new Map<string, Star[]>()
  for (const star of stars) {
    const cx = Math.floor(star.x / CELL_SIZE)
    const cy = Math.floor(star.y / CELL_SIZE)
    const key = cellKey(cx, cy)
    let bucket = cells.get(key)
    if (!bucket) {
      bucket = []
      cells.set(key, bucket)
    }
    bucket.push(star)
  }
  return { cells, cellSize: CELL_SIZE }
}

// Iterate every star whose cell overlaps the world-space rectangle
// [minX, maxX] × [minY, maxY]. The caller still applies a per-star
// pixel-level cull — this just skips entire empty regions.
export function forEachStarInBounds(
  grid: SpatialGrid,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  visit: (star: Star) => void,
): void {
  const cs = grid.cellSize
  const cx0 = Math.floor(minX / cs)
  const cx1 = Math.floor(maxX / cs)
  const cy0 = Math.floor(minY / cs)
  const cy1 = Math.floor(maxY / cs)
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const bucket = grid.cells.get(cellKey(cx, cy))
      if (!bucket) continue
      for (const star of bucket) visit(star)
    }
  }
}
