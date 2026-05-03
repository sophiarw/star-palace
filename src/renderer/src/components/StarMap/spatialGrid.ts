// Bucketed spatial grid over star world positions. Lets the draw loop iterate
// only the cells touched by the visible viewport instead of the full corpus —
// at 5k+ stars zoomed in to a small region, this drops per-frame work from
// O(N) to O(visible_cells).
//
// Cells are square `CELL_SIZE` world units. Keys are int-packed:
// `(cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET)`. KEY_OFFSET handles
// negative coords (galaxy origins push positions outside any single positive
// offset). Avoids the per-lookup string concat allocation that the prior
// `${cx}|${cy}` keying paid.

import type { Star } from '@shared/types'

export const CELL_SIZE = 100

// Tuning: KEY_OFFSET must exceed the largest |cell index| we expect. World
// coords sit in [-500, 500] for the local-PCA layer and are then offset
// per-galaxy by spiral coords usually within a few thousand world units —
// well under 32k cells per axis. KEY_STRIDE of 65536 = 2 ** 16 means the
// packed key is < 2 ** 32; Map handles uint32 fine without de-opt.
const KEY_OFFSET = 32768
const KEY_STRIDE = 65536

export interface SpatialGrid {
  readonly cells: ReadonlyMap<number, Star[]>
  readonly cellSize: number
}

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET)
}

export function buildSpatialGrid(stars: readonly Star[]): SpatialGrid {
  const cells = new Map<number, Star[]>()
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
