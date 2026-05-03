/**
 * F10 — composite "importance" score combining intrinsic engagement
 * (view_count from in-app opens) with OS-derived signals.
 *
 * Formula (from REQUIREMENTS § F10):
 *   importance_score = view_count
 *                    + log2(os_use_count + 1) * 4
 *                    + recency_boost
 *   recency_boost    = clamp(1 - (now - os_last_used) / SEVEN_DAYS_MS, 0, 1) * 5
 *
 * - `os_use_count` defaulting to 0 when null
 * - `recency_boost` defaulting to 0 when `os_last_used` is null
 *
 * Computed once at index/re-index time and stored in `files.importance_score`
 * so the renderer's percentile classifier doesn't have to recompute on every
 * data load. Recompute on every walker pass — usage decays/grows continuously.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export interface ImportanceInputs {
  viewCount: number
  osUseCount: number | null
  osLastUsed: number | null  // Unix epoch ms
  now: number                 // Unix epoch ms; pass `Date.now()` from the caller
}

export function computeImportanceScore(inputs: ImportanceInputs): number {
  const { viewCount, osUseCount, osLastUsed, now } = inputs

  const useCount = osUseCount ?? 0
  // log2(0 + 1) = 0, so a never-opened file contributes 0 from this term.
  const useTerm = Math.log2(useCount + 1) * 4

  let recencyBoost = 0
  if (osLastUsed !== null && Number.isFinite(osLastUsed)) {
    const ageMs = now - osLastUsed
    // clamp(1 - ageMs/SEVEN_DAYS_MS, 0, 1)
    const fresh = 1 - ageMs / SEVEN_DAYS_MS
    recencyBoost = Math.max(0, Math.min(1, fresh)) * 5
  }

  return viewCount + useTerm + recencyBoost
}
