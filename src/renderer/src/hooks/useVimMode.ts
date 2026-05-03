import { useCallback, useEffect, useRef, useState } from 'react'
import type { Star, StarType } from '@shared/types'
import { STAR_TYPES } from '@shared/types'
import { openFile, revealFile, setStarType } from '../api'

export type VimMode = 'normal' | 'search'

export type VimAction =
  | { type: 'panVelocity'; vx: number; vy: number }   // screen px/sec; held-key continuous pan
  | { type: 'zoom'; factor: number }
  | { type: 'fitAll' }
  | { type: 'fitCluster'; clusterId: number }
  | { type: 'panTo'; wx: number; wy: number; zoom?: number }

interface UseVimModeOptions {
  onAction: (action: VimAction) => void
  onToggleSearch: () => void
  onEscape: () => void
  onSelectHovered: () => void
  onSelectStar: (id: string) => void
  hoveredId: string | null
  selectedId: string | null
  selectedStar: Star | null
  searchHighlights: { id: string; x: number; y: number }[]
  onStarTypeChange: (id: string, type: StarType | null) => void
  onToggleCheatsheet: () => void
  onOpenTypeDropdown: () => void
  // F5 — toggle the Collections sidebar. The hook just forwards the keypress;
  // App owns the visibility state so it can also be toggled via the panel's
  // own close button.
  onToggleCollections: () => void
}

// Velocity in screen pixels per second. StarMap divides by zoom so screen-
// space pan speed stays constant regardless of how zoomed in the camera is.
const PAN_VEL_SLOW = 300    // hjkl
const PAN_VEL_FAST = 1200   // HJKL (4×)
const ZOOM_FACTOR = 1.1

// Maps each pan key to its (vx, vy) contribution. Held keys sum, so
// h+j → diagonal down-left.
const KEY_VEL: Record<string, [number, number]> = {
  h: [-PAN_VEL_SLOW, 0], H: [-PAN_VEL_FAST, 0],
  j: [0,  PAN_VEL_SLOW], J: [0,  PAN_VEL_FAST],
  k: [0, -PAN_VEL_SLOW], K: [0, -PAN_VEL_FAST],
  l: [ PAN_VEL_SLOW, 0], L: [ PAN_VEL_FAST, 0],
}

function isPanKey(k: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEY_VEL, k)
}

export function useVimMode({
  onAction,
  onToggleSearch,
  onEscape,
  onSelectHovered,
  onSelectStar,
  hoveredId,
  selectedId,
  selectedStar,
  searchHighlights,
  onStarTypeChange,
  onToggleCheatsheet,
  onOpenTypeDropdown,
  onToggleCollections,
}: UseVimModeOptions): { mode: VimMode; setMode: (m: VimMode) => void } {
  const [mode, setMode] = useState<VimMode>('normal')
  const modeRef = useRef<VimMode>('normal')
  const lastKeyRef = useRef<string>('')
  const lastKeyTimeRef = useRef<number>(0)
  const searchIndexRef = useRef<number>(-1)
  const heldPanKeysRef = useRef<Set<string>>(new Set())

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
      const isCmdF = (e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')

      // Don't capture while typing in input/textarea — but still handle Escape and Cmd/Ctrl+F
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          setModeSync('normal')
          onEscape()
          return
        }
        if (isCmdF) {
          e.preventDefault()
          // Stay in search mode; bar just hides so n/N can cycle.
          onToggleSearch()
          return
        }
        return
      }

      if (isCmdF) {
        e.preventDefault()
        setModeSync('search')
        onToggleSearch()
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

        // gh sequence: fit current cluster. Wins over the pan-key branch so
        // the user's "g then h" intent isn't swallowed by the velocity start.
        if (key === 'h' && prevWasG) {
          e.preventDefault()
          lastKeyRef.current = key
          lastKeyTimeRef.current = now
          if (selectedStar !== null && selectedStar.clusterId !== null) {
            onAction({ type: 'fitCluster', clusterId: selectedStar.clusterId })
          }
          return
        }

        // Pan keys: smooth velocity. First keydown for a pan key adds it to
        // the held set and emits an updated velocity vector. Subsequent
        // auto-repeat keydowns are no-ops (already in set).
        if (isPanKey(key)) {
          e.preventDefault()
          lastKeyRef.current = key
          lastKeyTimeRef.current = now
          if (!heldPanKeysRef.current.has(key)) {
            heldPanKeysRef.current.add(key)
            let vx = 0, vy = 0
            for (const k of heldPanKeysRef.current) {
              const v = KEY_VEL[k]
              if (v) { vx += v[0]; vy += v[1] }
            }
            onAction({ type: 'panVelocity', vx, vy })
          }
          return
        }

        // Update last key tracking
        lastKeyRef.current = key
        lastKeyTimeRef.current = now

        switch (key) {
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
          case 'Escape':
            e.preventDefault()
            onEscape()
            break
          case 'n': {
            e.preventDefault()
            if (searchHighlights.length === 0) break
            searchIndexRef.current = (searchIndexRef.current + 1) % searchHighlights.length
            const hitN = searchHighlights[searchIndexRef.current]
            onSelectStar(hitN.id)
            onAction({ type: 'panTo', wx: hitN.x, wy: hitN.y })
            break
          }
          case 'N': {
            e.preventDefault()
            if (searchHighlights.length === 0) break
            const len = searchHighlights.length
            searchIndexRef.current = ((searchIndexRef.current - 1) + len) % len
            const hitPrev = searchHighlights[searchIndexRef.current]
            onSelectStar(hitPrev.id)
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
          case 'O':
            // F14 — capital O reveals the selected file in the OS file
            // explorer (Finder / Explorer); arrives as a distinct e.key
            // value from lowercase 'o' so the switch handles it directly.
            e.preventDefault()
            if (selectedId) {
              revealFile(selectedId).catch((err) => console.warn('revealFile failed:', err))
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
          case 'c':
            // F5 — toggle the Collections sidebar. Lowercase only; uppercase C
            // is reserved in case we want a "create new collection" shortcut.
            e.preventDefault()
            onToggleCollections()
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
          e.preventDefault()
          setModeSync('normal')
          onEscape()
          return
        }
        if (key === 'n' || key === 'N') {
          e.preventDefault()
          if (searchHighlights.length === 0) return
          if (key === 'n') {
            searchIndexRef.current = (searchIndexRef.current + 1) % searchHighlights.length
          } else {
            const len = searchHighlights.length
            searchIndexRef.current = ((searchIndexRef.current - 1) + len) % len
          }
          const hit = searchHighlights[searchIndexRef.current]
          onSelectStar(hit.id)
          onAction({ type: 'panTo', wx: hit.x, wy: hit.y })
          return
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (heldPanKeysRef.current.has(e.key)) {
        heldPanKeysRef.current.delete(e.key)
        let vx = 0, vy = 0
        for (const k of heldPanKeysRef.current) {
          const v = KEY_VEL[k]
          if (v) { vx += v[0]; vy += v[1] }
        }
        onAction({ type: 'panVelocity', vx, vy })
      }
    }

    // Blur stops all pan velocity so keys don't get stuck if the user tabs
    // away while holding a direction.
    const onBlur = () => {
      if (heldPanKeysRef.current.size > 0) {
        heldPanKeysRef.current.clear()
        onAction({ type: 'panVelocity', vx: 0, vy: 0 })
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [
    setModeSync,
    onAction,
    onToggleSearch,
    onEscape,
    onSelectHovered,
    onSelectStar,
    hoveredId,
    selectedId,
    selectedStar,
    searchHighlights,
    onStarTypeChange,
    onToggleCheatsheet,
    onOpenTypeDropdown,
    onToggleCollections,
  ])

  return { mode, setMode: setModeSync }
}
