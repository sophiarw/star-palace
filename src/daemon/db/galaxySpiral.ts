import { GALAXY_SPIRAL_STEP } from '../../shared/types'

// Deterministic square spiral around (0, 0). Returns the (offsetX, offsetY)
// world-unit coordinates for the n-th galaxy (1-indexed). The first slot is
// the origin so the default galaxy lives at (0, 0).
//
// Walk pattern (in step units, where step = GALAXY_SPIRAL_STEP):
//   n=1 -> ( 0,  0)
//   n=2 -> ( 1,  0)   right 1
//   n=3 -> ( 1,  1)   up    1
//   n=4 -> ( 0,  1)   left  2 (cell 1 of 2)
//   n=5 -> (-1,  1)   left  2 (cell 2 of 2)
//   n=6 -> (-1,  0)   down  2 (cell 1 of 2)
//   n=7 -> (-1, -1)   down  2 (cell 2 of 2)
//   n=8 -> ( 0, -1)   right 3 (cell 1 of 3)
//   n=9 -> ( 1, -1)   right 3 (cell 2 of 3)
//   n=10-> ( 2, -1)   right 3 (cell 3 of 3)
//   n=11-> ( 2,  0)   up    3 …
//
// Leg lengths increase as 1, 1, 2, 2, 3, 3, 4, 4, … and the direction cycles
// right → up → left → down.
export function galaxySpiralOffset(n: number): [number, number] {
  if (n < 1 || !Number.isInteger(n)) {
    throw new Error(`galaxySpiralOffset: n must be a positive integer, got ${n}`)
  }
  if (n === 1) return [0, 0]

  // direction order: right, up, left, down
  const dirs: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [0, 1], [-1, 0], [0, -1],
  ]

  let x = 0, y = 0
  let i = 1
  let dirIdx = 0
  let legLen = 1
  let legsAtThisLen = 0

  while (i < n) {
    const [dx, dy] = dirs[dirIdx]
    for (let k = 0; k < legLen && i < n; k++) {
      x += dx
      y += dy
      i++
    }
    dirIdx = (dirIdx + 1) % 4
    legsAtThisLen++
    if (legsAtThisLen === 2) {
      legsAtThisLen = 0
      legLen++
    }
  }

  return [x * GALAXY_SPIRAL_STEP, y * GALAXY_SPIRAL_STEP]
}
