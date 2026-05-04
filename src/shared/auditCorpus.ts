// Shared constants + helpers for the graphics audit corpus.
//
// The audit corpus is the lightweight test bed used to render every star type
// against every theme without touching the user's main DB. See:
//   - scripts/build-audit-corpus.mjs   (writes audit-corpus/)
//   - scripts/seed-audit.ts            (indexes + assigns star_types)
//   - scripts/dev-audit.sh             (full local workflow)
//   - docs/graphics-test-bed.md        (how it fits together)
//   - tests/graphics/auditCorpus.test.ts  (validates this parser)

import { STAR_TYPES, type StarType, isStarType } from './types'

/** Variants per star type. 10 types × 21 = 210 files, just over the
 * LAYOUT_THRESHOLD (200) so a fresh index trains PCA on the first pass. */
export const AUDIT_PER_TYPE = 21

/** Total file count expected in audit-corpus/. */
export const AUDIT_TOTAL = STAR_TYPES.length * AUDIT_PER_TYPE

/**
 * Parse an audit-corpus filename ("red-giant-07.md") into its star type.
 * Returns `null` if the prefix doesn't match a known star type or if the
 * filename doesn't fit the `<starType>-<NN>.md` shape.
 */
export function parseAuditCorpusType(filename: string): StarType | null {
  const match = filename.match(/^([a-z-]+)-\d{2}\.md$/)
  if (!match) return null
  const candidate = match[1]
  return isStarType(candidate) ? candidate : null
}
