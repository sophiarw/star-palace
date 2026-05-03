import { useEffect, useRef, useState } from 'react'
import type { MapStats } from '@shared/types'
import type { VimMode } from '../../hooks/useVimMode'
import type { ThemeSummary } from '../../themes/types'
import type { ClassificationMode } from '../../hooks/useClassificationMode'

interface Props {
  stats: MapStats | null
  starCount: number
  vimMode?: VimMode
  // F11 — theme picker. `themes` and `currentThemeId` together drive the
  // dropdown; `onThemeChange` fires on click. Optional so existing call
  // sites compile during the rollout.
  themes?: ThemeSummary[]
  currentThemeId?: string
  onThemeChange?: (id: string) => void
  // F10 — classification mode toggle. Two pills (Type / Usage) right next
  // to the theme picker. Optional during rollout so existing call sites
  // still compile.
  classMode?: ClassificationMode
  onClassModeChange?: (m: ClassificationMode) => void
}

const VIM_MODE_LABELS: Record<VimMode, string> = {
  normal: '-- NORMAL --',
  search: '-- SEARCH --',
}

const CLASS_MODE_LABELS: Record<ClassificationMode, string> = {
  type: 'Type',
  usage: 'Usage',
}

const CLASS_MODE_ORDER: ClassificationMode[] = ['type', 'usage']

export default function StatsBar({ stats, starCount, vimMode, themes, currentThemeId, onThemeChange, classMode, onClassModeChange }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  // Close on outside click — picker shouldn't trap focus.
  useEffect(() => {
    if (!pickerOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [pickerOpen])

  if (!stats) return null

  const current = themes?.find((t) => t.id === currentThemeId) ?? null

  return (
    <div className="stats-bar">
      <span>{stats.total.toLocaleString()} stars</span>
      <span>{stats.clusterCount} constellations</span>
      {stats.layoutVersion > 0
        ? <span>layout v{stats.layoutVersion}</span>
        : <span>indexing... ({stats.indexedWithEmbedding}/200)</span>
      }
      {starCount > 0 && <span>{starCount} in view</span>}
      {vimMode && (
        <span className={`stats-bar-mode stats-bar-mode--${vimMode}`}>
          {VIM_MODE_LABELS[vimMode]}
        </span>
      )}
      {classMode && onClassModeChange && (
        // F10 — segmented control. Sits next to the theme picker. Two pills
        // total; one-click flip; whole sky re-renders via the consumer's
        // mode-change handler.
        <div className="stats-bar-classmode" role="group" aria-label="Classification mode">
          <span className="stats-bar-classmode-prefix">Color by</span>
          <div className="stats-bar-classmode-pills">
            {CLASS_MODE_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                className={`classification-toggle-pill${m === classMode ? ' classification-toggle-pill--active' : ''}`}
                onClick={() => onClassModeChange(m)}
                aria-pressed={m === classMode}
              >
                {CLASS_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      )}
      {themes && themes.length > 0 && current && onThemeChange && (
        <div className="stats-bar-theme" ref={pickerRef}>
          <button
            type="button"
            className="stats-bar-theme-button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            Theme: <span className="stats-bar-theme-label">{current.name}</span>
            <span className="stats-bar-theme-caret">{pickerOpen ? '▴' : '▾'}</span>
          </button>
          {pickerOpen && (
            <ul className="stats-bar-theme-menu" role="listbox">
              {themes.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onThemeChange(t.id)
                      setPickerOpen(false)
                    }}
                    aria-current={t.id === currentThemeId ? 'true' : 'false'}
                  >
                    <span className="stats-bar-theme-menu-name">{t.name}</span>
                    <span className="stats-bar-theme-menu-desc">{t.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
