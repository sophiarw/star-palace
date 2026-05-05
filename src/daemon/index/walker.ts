import { readdir, readFile, stat } from 'fs/promises'
import { join, basename, relative } from 'path'
import { createHash } from 'crypto'
import type { FileNode, WalkStats } from '../../shared/types'
import { categoryFromPath, mimeFromPath } from './extractors/category'
import { MAX_FILE_BYTES } from '../../shared/types'
import { readUsageMetadata, type UsageMetadata } from './usageMetadata'
import type { IgnoreMatcher } from './ignoreMatcher'

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'dist-electron', 'dist-web',
  '.cache', '.next', 'out', 'build', '.venv', '__pycache__', 'coverage',
])

export interface WalkOptions {
  ignore?: Set<string>
  maxBytes?: number
  // F9 — galaxy scope mixed into the file ID hash so the same path indexed
  // under two different galaxies produces two distinct stars. When undefined
  // the legacy path-only ID is used.
  galaxyScope?: string | number
  // User-managed gitignore-style patterns layered on top of DEFAULT_IGNORE.
  // Applied per-entry against the path relative to `root`. No matcher == no
  // extra rules.
  matcher?: IgnoreMatcher
}

export interface FileWithContent {
  node: FileNode
  content: Buffer
  // F10 — OS-derived usage signals attached at walk time so the Insert
  // pipeline can compute importance_score without a second per-file fork.
  usage: UsageMetadata
}

export function fileIdFromPath(path: string, galaxyScope?: string | number): string {
  const seed = galaxyScope === undefined ? path : `${galaxyScope}\0${path}`
  return createHash('sha1').update(seed).digest('hex').slice(0, 16)
}

export async function walkDirectory(
  root: string,
  opts: WalkOptions = {}
): Promise<AsyncGenerator<FileWithContent>> {
  const ignore = opts.ignore ?? DEFAULT_IGNORE
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES
  const galaxyScope = opts.galaxyScope
  const matcher = opts.matcher

  async function* gen(): AsyncGenerator<FileWithContent> {
    yield* walkDir(root, root, ignore, maxBytes, galaxyScope, matcher)
  }
  return gen()
}

async function* walkDir(
  dir: string,
  root: string,
  ignore: Set<string>,
  maxBytes: number,
  galaxyScope: string | number | undefined,
  matcher: IgnoreMatcher | undefined,
): AsyncGenerator<FileWithContent> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (ignore.has(entry.name) || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (matcher?.active) {
      const rel = relative(root, full)
      if (rel && !rel.startsWith('..') && matcher.matchesRelative(rel, entry.isDirectory())) continue
    }
    if (entry.isDirectory()) {
      yield* walkDir(full, root, ignore, maxBytes, galaxyScope, matcher)
    } else if (entry.isFile()) {
      try {
        const s = await stat(full)
        if (s.size > maxBytes) continue
        const category = categoryFromPath(full)
        if (category === 'unknown') continue
        const content = category === 'media' ? Buffer.alloc(0) : await readFile(full)
        const node: FileNode = {
          id: fileIdFromPath(full, galaxyScope),
          name: basename(full),
          path: full,
          platform: 'local',
          mimeType: mimeFromPath(full),
          category,
          size: s.size,
          createdAt: s.birthtimeMs,
          modifiedAt: s.mtimeMs,
        }
        // F10 — read Spotlight (macOS) or atime (other OS) usage signals.
        // Always resolves; per-file fork ~1ms on local FS per spec.
        const usage = await readUsageMetadata(full)
        yield { node, content, usage }
      } catch {
        // skip unreadable files
      }
    }
  }
}

export async function countWalk(root: string, opts: WalkOptions = {}): Promise<WalkStats> {
  const start = Date.now()
  const stats: WalkStats = { scanned: 0, indexed: 0, skipped: 0, errors: 0, durationMs: 0 }
  const ignore = opts.ignore ?? DEFAULT_IGNORE
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES
  const matcher = opts.matcher

  async function count(dir: string): Promise<void> {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) }
    catch { stats.errors++; return }
    for (const entry of entries) {
      if (ignore.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (matcher?.active) {
        const rel = relative(root, full)
        if (rel && !rel.startsWith('..') && matcher.matchesRelative(rel, entry.isDirectory())) continue
      }
      if (entry.isDirectory()) {
        await count(full)
      } else if (entry.isFile()) {
        stats.scanned++
        try {
          const s = await stat(full)
          const category = categoryFromPath(full)
          if (s.size > maxBytes || category === 'unknown') { stats.skipped++; continue }
          stats.indexed++
        } catch { stats.errors++ }
      }
    }
  }

  await count(root)
  stats.durationMs = Date.now() - start
  return stats
}
