/**
 * Spotlight-backed literal search.
 *
 * macOS only. Shells out to `mdfind -onlyin <galaxy.root_path> <query>` per
 * indexed galaxy and joins the returned absolute paths back to indexed files
 * via the same id-derivation the walker uses (sha1(galaxyId + '\0' + path)).
 *
 * Output shape mirrors `/api/search` exactly so the renderer can swap which
 * endpoint it calls without touching highlight / cycle / pan state.
 *
 * Tested via dependency injection: `runMdfind` is replaceable so unit tests
 * never fork a real subprocess and can run on any platform.
 */

import { promisify } from 'util'
import { execFile } from 'child_process'
import { platform } from 'os'
import type { FileIndex } from '../db/FileIndex'
import type { SearchResult, GalaxySummary } from '../../shared/types'
import { fileIdFromPath } from '../index/walker'

const execFileAsync = promisify(execFile)

export class SpotlightUnavailable extends Error {
  reason: 'not-macos' | 'mdfind-failed'
  constructor(reason: 'not-macos' | 'mdfind-failed', message?: string) {
    super(message ?? reason)
    this.name = 'SpotlightUnavailable'
    this.reason = reason
  }
}

export interface SpotlightDeps {
  db: FileIndex
  // Replaceable runner for tests. Returns absolute paths mdfind matched
  // within `root` for `query`. Real implementation shells out to mdfind.
  runMdfind?: (root: string, query: string) => Promise<string[]>
}

export interface SpotlightOpts {
  query: string
  limit: number
  galaxyId?: number | null
  collectionId?: number | null
}

const IS_MACOS = platform() === 'darwin'

let mdfindWarned = false

async function defaultRunMdfind(root: string, query: string): Promise<string[]> {
  // execFile (not exec) — query never hits a shell, so quotes / backticks /
  // $(…) in the user's input cannot become RCE. mdfind treats a bare
  // argument as a substring search across kMDItemDisplayName + content.
  try {
    const { stdout } = await execFileAsync('mdfind', ['-onlyin', root, query], {
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout.split('\n').map(s => s.trim()).filter(s => s.length > 0)
  } catch (err) {
    if (!mdfindWarned) {
      mdfindWarned = true
      console.warn('[spotlight] mdfind failed:', err instanceof Error ? err.message : err)
    }
    throw new SpotlightUnavailable('mdfind-failed', err instanceof Error ? err.message : String(err))
  }
}

export async function searchSpotlight(
  deps: SpotlightDeps,
  opts: SpotlightOpts,
): Promise<SearchResult[]> {
  // Tests inject `runMdfind` to bypass the real subprocess; in that case we
  // also skip the platform check so the suite stays cross-platform. Real
  // daemon callers leave `runMdfind` undefined, hit the default runner, and
  // are gated by IS_MACOS here.
  const runMdfind = deps.runMdfind ?? defaultRunMdfind
  if (!deps.runMdfind && !IS_MACOS) {
    throw new SpotlightUnavailable('not-macos')
  }

  const { db } = deps
  const { query, limit } = opts
  if (limit <= 0) return []

  const allGalaxies: GalaxySummary[] = db.listGalaxies()
  const targets = opts.galaxyId != null
    ? allGalaxies.filter(g => g.id === opts.galaxyId)
    : allGalaxies

  // Spotlight only sees the local filesystem; non-local galaxies (future
  // google-drive / confluence / etc.) cannot use this path. Today walker only
  // writes platform: 'local' but the schema permits others, so filter
  // defensively. Sentinel galaxy with root_path '__default__:default' has no
  // real on-disk root either — skip.
  const localTargets = targets.filter(g => !g.rootPath.startsWith('__default__:'))

  const memberSet = opts.collectionId != null
    ? new Set(db.getCollectionMembers(opts.collectionId))
    : null

  const perGalaxy = await Promise.all(
    localTargets.map(async g => {
      try {
        const paths = await runMdfind(g.rootPath, query)
        return { galaxy: g, paths }
      } catch (err) {
        if (err instanceof SpotlightUnavailable && err.reason === 'mdfind-failed') {
          // One galaxy mdfind failure (e.g. Spotlight index missing on that
          // volume) shouldn't take the whole search down. Treat as zero hits.
          return { galaxy: g, paths: [] as string[] }
        }
        throw err
      }
    }),
  )

  // Preserve mdfind's per-galaxy order; flatten with galaxies in their own
  // order. Dedupe by id in case a path somehow shows up twice.
  const seen = new Set<string>()
  const ordered: { id: string; rank: number }[] = []
  for (const { galaxy, paths } of perGalaxy) {
    for (const p of paths) {
      const id = fileIdFromPath(p, galaxy.id)
      if (seen.has(id)) continue
      const file = db.get(id)
      if (!file) continue                              // not indexed
      if (file.platform !== 'local') continue          // future-proof guard
      if (file.x === null || file.y === null) continue // not yet projected
      if (memberSet && !memberSet.has(id)) continue
      seen.add(id)
      ordered.push({ id, rank: ordered.length })
      if (ordered.length >= limit) break
    }
    if (ordered.length >= limit) break
  }

  if (ordered.length === 0) return []

  // Score: rank-based descending. First hit gets 1, last gets ~0. Keeps
  // n/N cycle order stable; not a real similarity.
  const denom = Math.max(ordered.length, 1)
  return ordered.map(({ id, rank }) => {
    const file = db.get(id)!
    const score = 1 - rank / denom
    return {
      id,
      x: file.x!,
      y: file.y!,
      score,
      name: file.name,
      path: file.path,
      galaxyId: file.galaxyId,
      isPinned: file.isPinned,
      pinAlpha: file.pinAlpha,
      pinBeta: file.pinBeta,
      pinAxisA: file.pinAxisA,
      pinAxisB: file.pinAxisB,
    }
  })
}
