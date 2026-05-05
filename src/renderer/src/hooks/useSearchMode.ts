/**
 * useSearchMode — toggles the SearchBar between semantic (current
 * embedding-based /api/search) and literal (Spotlight-backed
 * /api/search/spotlight) modes. Persisted to localStorage so the toggle
 * survives reloads.
 *
 * Mirrors the useTheme persistence pattern: corrupt / unknown stored values
 * fall back to the default and the bad entry is cleared.
 */

import { useCallback, useEffect, useState } from 'react'

export type SearchMode = 'semantic' | 'literal'
export const DEFAULT_SEARCH_MODE: SearchMode = 'semantic'
const STORAGE_KEY = 'starpalace.searchMode.v1'

function isSearchMode(v: unknown): v is SearchMode {
  return v === 'semantic' || v === 'literal'
}

function readStored(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(mode: SearchMode): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* quota / private mode — silently ignore */
  }
}

function clearStored(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function resolveSearchMode(stored: string | null): SearchMode {
  if (stored !== null && isSearchMode(stored)) return stored
  return DEFAULT_SEARCH_MODE
}

export interface UseSearchModeResult {
  searchMode: SearchMode
  setSearchMode: (m: SearchMode) => void
}

export function useSearchMode(): UseSearchModeResult {
  const [searchMode, setSearchModeState] = useState<SearchMode>(() => {
    const stored = readStored()
    if (stored !== null && !isSearchMode(stored)) clearStored()
    return resolveSearchMode(stored)
  })

  useEffect(() => {
    const stored = readStored()
    if (stored !== null && !isSearchMode(stored)) clearStored()
  }, [])

  const setSearchMode = useCallback((m: SearchMode) => {
    if (!isSearchMode(m)) return
    setSearchModeState(m)
    writeStored(m)
  }, [])

  return { searchMode, setSearchMode }
}
