import ignore, { type Ignore } from 'ignore'
import { relative, sep } from 'path'

// Wrap the gitignore-spec `ignore` package with star-palace conventions:
//   - Matcher always operates on POSIX-separated paths relative to a root.
//   - Empty / whitespace-only sources produce a no-op matcher (always returns
//     false) so callers don't need a null branch.
//   - `matches()` accepts an absolute path + the root it's relative to and
//     handles the path math + separator normalisation for the caller.
//
// gitignore semantics matter here: `node_modules/` matches the directory
// anywhere in the tree, `*.log` matches any file with the extension,
// `vendor/**` matches every file under vendor/, and `!keep.txt` re-includes.

export interface IgnoreMatcher {
  /** True when the path (absolute or relative) should be excluded. */
  matches(absPath: string, root: string): boolean
  /** Convenience for the walker hot path where we already have the rel-to-root path. */
  matchesRelative(relPath: string, isDir: boolean): boolean
  /** True when the matcher has at least one user pattern. */
  active: boolean
}

const NOOP: IgnoreMatcher = {
  matches: () => false,
  matchesRelative: () => false,
  active: false,
}

export function buildIgnoreMatcher(source: string): IgnoreMatcher {
  if (!source.trim()) return NOOP
  const ig: Ignore = ignore().add(source)

  const toPosix = (p: string): string => sep === '/' ? p : p.split(sep).join('/')

  return {
    active: true,
    matches(absPath, root) {
      const rel = relative(root, absPath)
      // Paths outside the root cannot be matched relative to it; treat as not
      // ignored. Caller can sweep against multiple roots if needed.
      if (!rel || rel.startsWith('..')) return false
      return ig.ignores(toPosix(rel))
    },
    matchesRelative(relPath, isDir) {
      // gitignore distinguishes file vs dir matches via the trailing slash on
      // the test input (e.g. `build/` only matches when the input ends in /).
      const posix = toPosix(relPath)
      const test = isDir ? `${posix}/` : posix
      return ig.ignores(test)
    },
  }
}
