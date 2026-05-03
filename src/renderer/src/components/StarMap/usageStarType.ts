/**
 * F10 — usage-mode classifier.
 *
 * Maps a file's importance_score to a StarType using corpus-wide
 * percentile buckets (computed once per data load by the renderer).
 *
 * Buckets per spec:
 *   bottom 50%  → white-dwarf
 *   50% – 80%   → main-sequence
 *   80% – 95%   → red-giant
 *   top 5%      → blue-supergiant
 *
 * Boundaries use `<=` on the upper end of a bucket so a score that
 * lands exactly on the cutoff falls into the LOWER bucket (more
 * common, less dramatic visual). Ties at a boundary across many files
 * with identical scores (e.g. a brand-new corpus where every file has
 * importance_score=0) all collapse to white-dwarf — matches "babies"
 * intuition.
 */

import type { StarType } from '@shared/types'

export interface PercentileBuckets {
  /** importance_score at the 50th percentile (top of white-dwarf bucket) */
  p50: number
  /** importance_score at the 80th percentile (top of main-sequence bucket) */
  p80: number
  /** importance_score at the 95th percentile (top of red-giant bucket) */
  p95: number
}

/**
 * Compute the 50/80/95 percentile boundaries from a corpus of scores.
 * Empty input returns all-zero buckets so a still-loading sky degenerates
 * to all-white-dwarfs (consistent with the "no data" intuition).
 *
 * Sort + index-pick (linear-interpolation NOT applied) — matches the
 * spec's discrete percentile semantics.
 */
export function computePercentileBuckets(scores: number[]): PercentileBuckets {
  if (scores.length === 0) return { p50: 0, p80: 0, p95: 0 }
  const sorted = [...scores].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 0.5),
    p80: percentile(sorted, 0.8),
    p95: percentile(sorted, 0.95),
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  // Index of the score at percentile `p`. Use floor so a corpus of N=10
  // returns sorted[5] for p=0.5, sorted[8] for p=0.8 — the "score at or
  // below which X% of values fall" interpretation.
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[idx]
}

/**
 * Bucket a single score into a StarType using precomputed boundaries.
 *
 * Comparator note: `score <= p50` puts the boundary into the bottom
 * bucket. With the current Insert pipeline a brand-new file gets a
 * score of 0; the `p50` boundary on a fresh corpus is also 0, so all
 * files become white-dwarf. That's the intended "all babies" behaviour
 * for a single-file corpus or a freshly indexed sky.
 */
export function usageStarType(score: number, buckets: PercentileBuckets): StarType {
  if (score <= buckets.p50) return 'white-dwarf'
  if (score <= buckets.p80) return 'main-sequence'
  if (score <= buckets.p95) return 'red-giant'
  return 'blue-supergiant'
}
