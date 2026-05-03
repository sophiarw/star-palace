/**
 * F16 — `useGalaxyVisibility` hook.
 *
 * Per-galaxy show/hide that is purely a renderer-side filter. Hidden
 * galaxies stay indexed in the daemon; they're just absent from the
 * StarMap, search highlights, percentile bucketing, and stats counts.
 *
 * Persists `Record<galaxyId, boolean>` (true = visible) under
 * `starpalace.galaxyVisibility.v1`. Default for an unseen galaxy is
 * visible. Stale entries (galaxy id no longer in the indexer) are dropped
 * the next time we read; this matches the spec's edge-case handling.
 *
 * Same persistence pattern as useTheme / useClassificationMode: corrupt
 * JSON falls back to "all visible" and silently clears the bad entry.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'starpalace.galaxyVisibility.v1'

type VisibilityMap = Record<string, boolean>

function isVisibilityMap(value: unknown): value is VisibilityMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== 'boolean') return false
  }
  return true
}

function readStored(): VisibilityMap {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    return isVisibilityMap(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeStored(map: VisibilityMap): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode — best-effort */
  }
}

/**
 * Drop entries from `map` whose id is not present in `knownIds`. Pure;
 * exported for unit testing the stale-entry contract.
 */
export function pruneStaleVisibility(
  map: VisibilityMap,
  knownIds: Iterable<number>,
): VisibilityMap {
  const known = new Set<string>()
  for (const id of knownIds) known.add(String(id))
  const out: VisibilityMap = {}
  for (const [k, v] of Object.entries(map)) {
    if (known.has(k)) out[k] = v
  }
  return out
}

export interface UseGalaxyVisibilityResult {
  /** Set of galaxy ids that are currently visible. Defaults to all known ids. */
  visibleSet: Set<number>
  /** True iff `id` is visible. Unknown ids resolve to true (default-on). */
  isVisible: (id: number) => boolean
  /** Toggle the visibility of `id`. */
  toggle: (id: number) => void
  /** Set the visibility of `id` to `visible`. */
  setVisible: (id: number, visible: boolean) => void
}

/**
 * Manage per-galaxy visibility. Pass the current list of known galaxy ids
 * so the hook can (a) fall back to "visible" for any galaxy we haven't
 * seen, and (b) prune stored entries for galaxies that disappeared.
 */
export function useGalaxyVisibility(knownIds: number[]): UseGalaxyVisibilityResult {
  const [map, setMap] = useState<VisibilityMap>(() => readStored())

  // Prune stale entries whenever the set of known galaxies changes. The
  // canonical fingerprint is a sorted CSV of ids — using `knownIds`
  // directly would over-trigger when only the array reference changes.
  const knownKey = useMemo(
    () => [...knownIds].sort((a, b) => a - b).join(','),
    [knownIds],
  )

  useEffect(() => {
    if (knownKey === '') return
    const ids = knownKey.split(',').map(s => Number(s))
    setMap(prev => {
      const pruned = pruneStaleVisibility(prev, ids)
      if (Object.keys(pruned).length === Object.keys(prev).length) return prev
      writeStored(pruned)
      return pruned
    })
  }, [knownKey])

  const isVisible = useCallback((id: number): boolean => {
    const v = map[String(id)]
    return v === undefined ? true : v
  }, [map])

  const visibleSet = useMemo(() => {
    const s = new Set<number>()
    for (const id of knownIds) {
      const v = map[String(id)]
      if (v === undefined || v === true) s.add(id)
    }
    return s
  }, [map, knownIds])

  const setVisible = useCallback((id: number, visible: boolean) => {
    setMap(prev => {
      const next = { ...prev, [String(id)]: visible }
      writeStored(next)
      return next
    })
  }, [])

  const toggle = useCallback((id: number) => {
    setMap(prev => {
      const cur = prev[String(id)]
      const nextVal = cur === undefined ? false : !cur
      const next = { ...prev, [String(id)]: nextVal }
      writeStored(next)
      return next
    })
  }, [])

  return { visibleSet, isVisible, toggle, setVisible }
}
