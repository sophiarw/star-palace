import { readdir, readFile, stat } from 'fs/promises'
import { join, basename } from 'path'
import { createHash } from 'crypto'
import type { FileNode, WalkStats } from '../../shared/types'
import { categoryFromPath, mimeFromPath } from './extractors/category'
import { MAX_FILE_BYTES } from '../../shared/types'

const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', '.DS_Store', 'dist', 'dist-electron', 'dist-web',
  '.cache', '.next', 'out', 'build', '.venv', '__pycache__', 'coverage',
])

export interface WalkOptions {
  ignore?: Set<string>
  maxBytes?: number
}

export interface FileWithContent {
  node: FileNode
  content: Buffer
}

export function fileIdFromPath(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 16)
}

export async function walkDirectory(
  root: string,
  opts: WalkOptions = {}
): Promise<AsyncGenerator<FileWithContent>> {
  const ignore = opts.ignore ?? DEFAULT_IGNORE
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES

  async function* gen(): AsyncGenerator<FileWithContent> {
    yield* walkDir(root, ignore, maxBytes)
  }
  return gen()
}

async function* walkDir(
  dir: string,
  ignore: Set<string>,
  maxBytes: number
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
    if (entry.isDirectory()) {
      yield* walkDir(full, ignore, maxBytes)
    } else if (entry.isFile()) {
      try {
        const s = await stat(full)
        if (s.size > maxBytes) continue
        const category = categoryFromPath(full)
        if (category === 'unknown') continue
        const content = category === 'media' ? Buffer.alloc(0) : await readFile(full)
        const node: FileNode = {
          id: fileIdFromPath(full),
          name: basename(full),
          path: full,
          platform: 'local',
          mimeType: mimeFromPath(full),
          category,
          size: s.size,
          createdAt: s.birthtimeMs,
          modifiedAt: s.mtimeMs,
        }
        yield { node, content }
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

  async function count(dir: string): Promise<void> {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) }
    catch { stats.errors++; return }
    for (const entry of entries) {
      if (ignore.has(entry.name) || entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
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
