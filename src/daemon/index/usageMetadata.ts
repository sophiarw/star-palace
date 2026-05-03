/**
 * F10 — OS-derived usage signals for the importance score.
 *
 * macOS: Spotlight stores per-file kMDItemUseCount and kMDItemUseDate that
 * GUI apps update when a user opens the file. We shell out to `mdls -raw`
 * once per file (~1ms fork on local FS — acceptable per spec).
 *
 * Other platforms: fall back to `fs.stat().atimeMs` for a recency proxy;
 * leave the use count NULL (the importance formula treats null count as 0).
 *
 * Spotlight returns the literal string `(null)` for files it has no record
 * of. Translate that to `null` so the renderer can distinguish "never opened"
 * (count 0, time null) from "no data" cleanly downstream.
 */

import { promisify } from 'util'
import { execFile } from 'child_process'
import { stat } from 'fs/promises'
import { platform } from 'os'

const execFileAsync = promisify(execFile)

export interface UsageMetadata {
  osUseCount: number | null
  osLastUsed: number | null  // Unix epoch ms; null if unknown
}

const SPOTLIGHT_NULL = '(null)'

/** True on macOS where mdls is available; cached so we only check once. */
const IS_MACOS = platform() === 'darwin'

// Spotlight is occasionally unreachable (e.g. background indexing churn).
// Log the first failure per session so logs aren't spammed; subsequent calls
// silently fall back. Reset by restarting the daemon.
let spotlightWarned = false

/**
 * Read OS usage metadata for a single file path. Always resolves; errors
 * become null metadata (callers treat null as "no signal yet").
 */
export async function readUsageMetadata(filePath: string): Promise<UsageMetadata> {
  if (IS_MACOS) {
    try {
      const { stdout } = await execFileAsync('mdls', [
        '-raw',
        '-name', 'kMDItemUseCount',
        '-name', 'kMDItemUseDate',
        filePath,
      ])
      // mdls -raw with two -name args concatenates the values back-to-back
      // with no separator. We rely on the values being either a string of
      // digits, an ISO-ish date, or the literal '(null)'. Parse defensively.
      return parseSpotlightOutput(stdout)
    } catch {
      if (!spotlightWarned) {
        spotlightWarned = true
        console.warn('[F10] Spotlight (mdls) unreachable; falling back to atime for usage metadata')
      }
      return await readAtimeFallback(filePath)
    }
  }
  return await readAtimeFallback(filePath)
}

/**
 * Parse `mdls -raw -name kMDItemUseCount -name kMDItemUseDate` output.
 *
 * `mdls -raw` concatenates the two values back-to-back with NO separator.
 * Each value is one of:
 *   - a positive integer (use count)
 *   - a string `YYYY-MM-DD HH:MM:SS +ZZZZ` (last-used timestamp)
 *   - the literal `(null)` (no data)
 *
 * The date format is fixed-width and ends in a timezone — parse it from
 * the END of the buffer first, then everything before is the count token.
 * This avoids the greedy-digit ambiguity where the count's trailing digits
 * could be mistaken for the date's leading year (`424` + `2025-…`).
 *
 * Exported for unit tests.
 */
export function parseSpotlightOutput(stdout: string): UsageMetadata {
  const trimmed = stdout.trim()

  // Case 1: both null
  if (trimmed === `${SPOTLIGHT_NULL}${SPOTLIGHT_NULL}`) {
    return { osUseCount: null, osLastUsed: null }
  }

  // Match the date pattern at the END of the buffer (or '(null)' at end).
  // ISO-ish: 'YYYY-MM-DD HH:MM:SS +ZZZZ' — fixed width.
  const datePattern = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[-+]\d{4})$/
  let dateToken: string | null = null
  let countPart: string
  if (trimmed.endsWith(SPOTLIGHT_NULL)) {
    dateToken = SPOTLIGHT_NULL
    countPart = trimmed.slice(0, trimmed.length - SPOTLIGHT_NULL.length)
  } else {
    const dateMatch = trimmed.match(datePattern)
    if (dateMatch) {
      dateToken = dateMatch[1]
      countPart = trimmed.slice(0, trimmed.length - dateMatch[1].length)
    } else {
      countPart = trimmed
    }
  }

  // What remains is the count token: either digits or '(null)' (or empty).
  const countTrimmed = countPart.trim()
  let osUseCount: number | null
  if (countTrimmed === '' || countTrimmed === SPOTLIGHT_NULL) {
    osUseCount = null
  } else {
    osUseCount = /^\d+$/.test(countTrimmed) ? parseSafeInt(countTrimmed) : null
  }

  const osLastUsed = dateToken === null || dateToken === SPOTLIGHT_NULL
    ? null
    : parseSpotlightDate(dateToken)

  return { osUseCount, osLastUsed }
}

function parseSafeInt(s: string): number | null {
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function parseSpotlightDate(s: string): number | null {
  // 'YYYY-MM-DD HH:MM:SS +ZZZZ' — Date.parse accepts it on V8.
  const ms = Date.parse(s)
  return Number.isFinite(ms) ? ms : null
}

async function readAtimeFallback(filePath: string): Promise<UsageMetadata> {
  try {
    const s = await stat(filePath)
    return { osUseCount: null, osLastUsed: Number.isFinite(s.atimeMs) ? s.atimeMs : null }
  } catch {
    return { osUseCount: null, osLastUsed: null }
  }
}
