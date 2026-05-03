import { useCallback, useEffect, useRef, useState } from 'react'
import type { Star, StarType } from '@shared/types'
import { STAR_TYPES } from '@shared/types'
import { openFile, setStarType } from '../api'

export type VimMode = 'normal' | 'search'

export type VimAction =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number }
  | { type: 'fitAll' }
  | { type: 'fitCluster'; clusterId: number }
  | { type: 'panTo'; wx: number; wy: number; zoom?: number }

interface UseVimModeOptions {
  onAction: (action: VimAction) => void
  onFocusSearch: () => void
  onEscape: () => void
  onSelectHovered: () => void
  hoveredId: string | null
  selectedId: string | null
  selectedStar: Star | null
  searchHighlights: { id: string; x: number; y: number }[]
  onStarTypeChange: (id: string, type: StarType | null) => void
  onToggleCheatsheet: () => void
  onOpenTypeDropdown: () => void
}

const PAN_SMALL = 50   // world units per small step
const PAN_LARGE = 200  // world units per large step
const ZOOM_FACTOR = 1.2

export function useVimMode({
  onAction,
  onFocusSearch,
  onEscape,
  onSelectHovered,
  hoveredId,
  selectedId,
  selectedStar,
  searchHighlights,
  onStarTypeChange,
  onToggleCheatsheet,
  onOpenTypeDropdown,
}: UseVimModeOptions): { mode: VimMode; setMode: (m: VimMode) => void } {
  const [mode, setMode] = useState<VimMode>('normal')
  const modeRef = useRef<VimMode>('normal')
  const lastKeyRef = useRef<string>('')
  const lastKeyTimeRef = useRef<number>(0)
  const searchIndexRef = useRef<number>(-1)

  const setModeSync = useCallback((m: VimMode) => {
    modeRef.current = m
    setMode(m)
  }, [])

  // Reset cycle index whenever the highlight set changes by content, not just
  // by array reference. Keying on the joined IDs covers the case where a
  // memoised consumer hands us the same ref with different IDs — without that,
  // n/N would resume from a stale offset that no longer points at the same
  // result.
  const highlightsKey = searchHighlights.map(h => h.id).join('|')
  useEffect(() => {
    searchIndexRef.current = -1
  }, [highlightsKey])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as Element
      // Don't capture while typing in input/textarea — but still handle Escape
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          setModeSync('normal')
          onEscape()
        }
        return
      }

      const currentMode = modeRef.current
      const key = e.key
      const now = Date.now()

      if (currentMode === 'normal') {
        const timeSinceLast = now - lastKeyTimeRef.current
        const prevKey = lastKeyRef.current
        const prevWasG = prevKey === 'g' && timeSinceLast < 500
        const isDoubleG = key === 'g' && prevWasG

        // Update last key tracking
        lastKeyRef.current = key
        lastKeyTimeRef.current = now

        switch (key) {
          case 'h':
            e.preventDefault()
            if (prevWasG) {
              // gh = fit current cluster
              if (selectedStar !== null && selectedStar.clusterId !== null) {
                onAction({ type: 'fitCluster', clusterId: selectedStar.clusterId })
              }
            } else {
              onAction({ type: 'pan', dx: -PAN_SMALL, dy: 0 })
            }
            break
          case 'j':
            e.preventDefault()
            onAction({ type: 'pan', dx: 0, dy: PAN_SMALL })
            break
          case 'k':
            e.preventDefault()
            onAction({ type: 'pan', dx: 0, dy: -PAN_SMALL })
            break
          case 'l':
            e.preventDefault()
            onAction({ type: 'pan', dx: PAN_SMALL, dy: 0 })
            break
          case 'H':
            e.preventDefault()
            onAction({ type: 'pan', dx: -PAN_LARGE, dy: 0 })
            break
          case 'J':
            e.preventDefault()
            onAction({ type: 'pan', dx: 0, dy: PAN_LARGE })
            break
          case 'K':
            e.preventDefault()
            onAction({ type: 'pan', dx: 0, dy: -PAN_LARGE })
            break
          case 'L':
            e.preventDefault()
            onAction({ type: 'pan', dx: PAN_LARGE, dy: 0 })
            break
          case '+':
          case '=':
            e.preventDefault()
            onAction({ type: 'zoom', factor: ZOOM_FACTOR })
            break
          case '-':
          case '_':
            e.preventDefault()
            onAction({ type: 'zoom', factor: 1 / ZOOM_FACTOR })
            break
          case 'g':
            if (isDoubleG) {
              e.preventDefault()
              onAction({ type: 'fitAll' })
            }
            // If not double-g, wait — stored in lastKeyRef for the next keypress
            break
          case '/':
            e.preventDefault()
            setModeSync('search')
            onFocusSearch()
            break
          case 'Escape':
            e.preventDefault()
            onEscape()
            break
          case 'n': {
            e.preventDefault()
            if (searchHighlights.length === 0) break
            searchIndexRef.current = (searchIndexRef.current + 1) % searchHighlights.length
            const hitN = searchHighlights[searchIndexRef.current]
            onAction({ type: 'panTo', wx: hitN.x, wy: hitN.y })
            break
          }
          case 'N': {
            e.preventDefault()
            if (searchHighlights.length === 0) break
            const len = searchHighlights.length
            searchIndexRef.current = ((searchIndexRef.current - 1) + len) % len
            const hitPrev = searchHighlights[searchIndexRef.current]
            onAction({ type: 'panTo', wx: hitPrev.x, wy: hitPrev.y })
            break
          }
          case 'Enter':
            e.preventDefault()
            if (hoveredId) {
              onSelectHovered()
            }
            break
          case 'o':
            e.preventDefault()
            if (selectedId) {
              openFile(selectedId).catch((err) => console.warn('openFile failed:', err))
            }
            break
          case 't':
            e.preventDefault()
            if (selectedId) {
              onOpenTypeDropdown()
            }
            break
          case 'T': {
            e.preventDefault()
            if (!selectedId || !selectedStar) break
            const types = STAR_TYPES as readonly StarType[]
            const currentType = selectedStar.starType
            const currentIdx = currentType !== null ? types.indexOf(currentType) : -1
            const nextType = types[(currentIdx + 1) % types.length]
            setStarType(selectedId, nextType)
              .then(() => onStarTypeChange(selectedId, nextType))
              .catch((err) => console.warn('setStarType failed:', err))
            break
          }
          case '?':
            e.preventDefault()
            onToggleCheatsheet()
            break
          case 'i': {
            e.preventDefault()
            const focusInput = () => {
              const el = document.getElementById('galaxy-panel-path-input') as HTMLInputElement | null
              if (el) {
                el.focus()
                el.select()
              }
            }
            const input = document.getElementById('galaxy-panel-path-input')
            if (input) {
              focusInput()
            } else {
              const expand = document.querySelector<HTMLButtonElement>('.galaxy-panel-collapsed')
              expand?.click()
              setTimeout(focusInput, 0)
            }
            break
          }
        }
      } else if (currentMode === 'search') {
        if (key === 'Escape') {
          setModeSync('normal')
          onEscape()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    setModeSync,
    onAction,
    onFocusSearch,
    onEscape,
    onSelectHovered,
    hoveredId,
    selectedId,
    selectedStar,
    searchHighlights,
    onStarTypeChange,
    onToggleCheatsheet,
    onOpenTypeDropdown,
  ])

  return { mode, setMode: setModeSync }
}
