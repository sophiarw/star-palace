// F5 — Andrew's monotone chain convex hull. Returns the hull vertices in
// counter-clockwise order. Behaviour for degenerate inputs:
//   - 0 points → []
//   - 1 point  → [pt]
//   - 2 points → [a, b]   (caller draws as a line; rendering treats this as
//                          a "circle around the single line" gracefully)
//   - all collinear → [endpoint, endpoint] (two-point hull)
// Numeric stability: cross-product is computed in plain f64; for the world-
// unit ranges used by the renderer (±500 to ±5000) the products stay well
// within safe-integer territory.
//
// Time complexity: O(n log n) from the sort; O(n) chain construction.

export type Pt = readonly [number, number]

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

export function convexHull(points: Pt[]): Pt[] {
  const n = points.length
  if (n <= 1) return points.slice()

  // Sort lexicographically by x, then by y. Stable sort isn't required for
  // correctness; the algorithm tolerates ties.
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])

  if (n === 2) return sorted

  const lower: Pt[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }

  const upper: Pt[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }

  // Drop the last point of each half because it's repeated at the start of
  // the other half. Result is the closed hull as a CCW vertex list.
  lower.pop()
  upper.pop()
  const hull = lower.concat(upper)

  // All-collinear case collapses to a duplicate first/last; return the
  // unique extreme pair so callers can still draw something sensible.
  if (hull.length < 3) return [sorted[0], sorted[sorted.length - 1]]
  return hull
}
