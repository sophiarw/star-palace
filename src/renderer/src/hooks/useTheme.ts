/**
 * F11 — `useTheme` hook.
 *
 * Returns the active `Theme` plus a setter and a list of all registered
 * themes. Persists the selection to localStorage under
 * `starpalace.theme.v1`. Unknown / corrupt values fall back to the default
 * and the bad entry is cleared.
 *
 * Renderer-only; no daemon round-trip. Themes are global to the app, not
 * per-galaxy or per-cluster (per F11 spec out-of-scope).
 */

import { useCallback, useEffect, useState } from 'react'
import type { Theme, ThemeSummary } from '../themes/types'
import { defaultThemeId, getTheme, listThemes } from '../themes/registry'

const STORAGE_KEY = 'starpalace.theme.v1'

function readStoredId(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredId(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* quota / private mode — silently ignore */
  }
}

function clearStoredId(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Resolve a candidate id to a valid Theme (with default fallback). */
function resolveInitial(): { theme: Theme; cleared: boolean } {
  const stored = readStoredId()
  if (stored) {
    const t = getTheme(stored)
    if (t) return { theme: t, cleared: false }
    // Bad value: clear so next session reads cleanly.
    return { theme: getTheme(defaultThemeId)!, cleared: true }
  }
  return { theme: getTheme(defaultThemeId)!, cleared: false }
}

export interface UseThemeResult {
  theme: Theme
  setTheme: (id: string) => void
  available: ThemeSummary[]
}

export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(() => {
    const { theme: t, cleared } = resolveInitial()
    if (cleared) clearStoredId()
    return t
  })

  // If the initial resolve cleared a bad value, run that side-effect once
  // post-mount as well (resolveInitial may have been invoked during SSR
  // where window is missing). Cheap to repeat.
  useEffect(() => {
    const stored = readStoredId()
    if (stored && !getTheme(stored)) clearStoredId()
  }, [])

  const setTheme = useCallback((id: string) => {
    const next = getTheme(id)
    if (!next) return
    setThemeState(next)
    writeStoredId(next.id)
  }, [])

  return { theme, setTheme, available: listThemes() }
}
