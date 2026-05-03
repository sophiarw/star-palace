/**
 * Graphics-quality setting (`low` | `medium` | `high` | `ultra`).
 *
 * Drives renderer LOD trade-offs the user can dial up/down based on hardware:
 * - `ultra` keeps every sprite at full procedural detail at every zoom.
 * - `high`, `medium`, `low` swap heavy procedural sprites for cheap halo+core
 *   variants when the on-screen size falls below progressively larger
 *   thresholds; `low` additionally falls back to tiny dots for very small
 *   sprites and trims the animation overlay + DPR backing-store at deep
 *   zoom-out.
 *
 * Persisted in localStorage under `starpalace.gfx.v1`. Default: `high`.
 */

import { useCallback, useEffect, useState } from 'react'

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra'

const STORAGE_KEY = 'starpalace.gfx.v1'
const DEFAULT_QUALITY: GraphicsQuality = 'high'
const VALID_QUALITIES: GraphicsQuality[] = ['low', 'medium', 'high', 'ultra']

function isQuality(value: unknown): value is GraphicsQuality {
  return typeof value === 'string' && (VALID_QUALITIES as readonly string[]).includes(value)
}

function readStored(): GraphicsQuality | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isQuality(raw) ? raw : null
  } catch {
    return null
  }
}

function writeStored(q: GraphicsQuality): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, q)
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

export interface UseGraphicsQualityResult {
  quality: GraphicsQuality
  setQuality: (q: GraphicsQuality) => void
  available: GraphicsQuality[]
}

export function useGraphicsQuality(): UseGraphicsQualityResult {
  const [quality, setQualityState] = useState<GraphicsQuality>(() => {
    return readStored() ?? DEFAULT_QUALITY
  })

  // Clear corrupt persisted value post-mount in case the initial useState
  // resolver ran without window access.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (raw !== null && !isQuality(raw)) clearStored()
    } catch {
      /* ignore */
    }
  }, [])

  const setQuality = useCallback((q: GraphicsQuality) => {
    if (!isQuality(q)) return
    setQualityState(q)
    writeStored(q)
  }, [])

  return { quality, setQuality, available: VALID_QUALITIES }
}
