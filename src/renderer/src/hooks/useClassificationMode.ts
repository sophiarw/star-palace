/**
 * F10 — `useClassificationMode` hook.
 *
 * Returns the active classification mode plus a setter. Persists the
 * selection to localStorage under `starpalace.classMode.v1`. Default:
 * `'type'` (existing F2 extension-driven path). `'usage'` flips the
 * renderer to the percentile-driven lifecycle classifier on
 * importance_score.
 *
 * Renderer-only; no daemon round-trip. Same persistence pattern as
 * useTheme so corrupt values fall back to the default and clear the
 * stored entry.
 */

import { useCallback, useEffect, useState } from 'react'

export type ClassificationMode = 'type' | 'usage'

const STORAGE_KEY = 'starpalace.classMode.v1'
const DEFAULT_MODE: ClassificationMode = 'type'
const VALID_MODES: ClassificationMode[] = ['type', 'usage']

function isClassificationMode(value: unknown): value is ClassificationMode {
  return typeof value === 'string' && (VALID_MODES as readonly string[]).includes(value)
}

function readStoredMode(): ClassificationMode | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isClassificationMode(raw) ? raw : null
  } catch {
    return null
  }
}

function writeStoredMode(mode: ClassificationMode): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* quota / private mode — silently ignore */
  }
}

function clearStoredMode(): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export interface UseClassificationModeResult {
  mode: ClassificationMode
  setMode: (m: ClassificationMode) => void
  available: ClassificationMode[]
}

export function useClassificationMode(): UseClassificationModeResult {
  const [mode, setModeState] = useState<ClassificationMode>(() => {
    return readStoredMode() ?? DEFAULT_MODE
  })

  // Clear corrupt persisted value on first mount (the initial useState
  // resolver may have run during SSR where window is missing — repeat once
  // post-mount).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw !== null && !isClassificationMode(raw)) clearStoredMode()
    } catch {
      /* ignore */
    }
  }, [])

  const setMode = useCallback((m: ClassificationMode) => {
    if (!isClassificationMode(m)) return
    setModeState(m)
    writeStoredMode(m)
  }, [])

  return { mode, setMode, available: VALID_MODES }
}
