// Shared constants + parser for the JWST renderer perf-test corpus.
//
// Mirror of auditCorpus.ts, sized at 750 files per star type (10 × 750 = 7500)
// to reproduce the typed sprite cache thrash that drove the bake-budget fix.
// See:
//   - scripts/build-perf-corpus.mjs   (writes perf-corpus/)
//   - scripts/seed-perf.ts            (indexes + assigns star_types)
//   - scripts/perf-jwst-7500.sh       (full local workflow)

import { STAR_TYPES, type StarType, isStarType } from './types'

export const PERF_PER_TYPE = 750
export const PERF_TOTAL = STAR_TYPES.length * PERF_PER_TYPE

/** Parse a perf-corpus filename ("red-giant-0007.md") into its star type. */
export function parsePerfCorpusType(filename: string): StarType | null {
  const match = filename.match(/^([a-z-]+)-\d{4}\.md$/)
  if (!match) return null
  const candidate = match[1]
  return isStarType(candidate) ? candidate : null
}
