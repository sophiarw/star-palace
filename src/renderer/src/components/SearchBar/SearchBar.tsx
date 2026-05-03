import { useState, useRef, useCallback, useEffect } from 'react'
import { search } from '../../api'
import type { SearchResult } from '@shared/types'

interface Props {
  value: string
  onValueChange: (v: string) => void
  onResults: (results: SearchResult[]) => void
  onClear: () => void
  onClose?: () => void
  onSubmit?: () => void
  inputRef?: React.RefObject<HTMLInputElement>
  // F5 — bubble the live query text up so the CollectionsPanel can offer
  // "Save current search as collection" with a sensible default name and so
  // dynamic-collection creation can capture the query string.
  onQueryChange?: (query: string) => void
}

export default function SearchBar({ value, onValueChange, onResults, onClear, onClose, onSubmit, inputRef, onQueryChange }: Props) {
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const internalRef = useRef<HTMLInputElement>(null)
  const resolvedRef = inputRef ?? internalRef

  useEffect(() => {
    const el = resolvedRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [resolvedRef])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    onValueChange(q)
    onQueryChange?.(q)

    if (debounce.current) clearTimeout(debounce.current)

    if (!q.trim()) {
      onClear()
      return
    }

    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await search(q.trim(), 30)
        onResults(results)
      } catch {
        // daemon may not be running yet
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [onResults, onClear, onValueChange, onQueryChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onValueChange('')
      onQueryChange?.('')
      onClear()
      onClose?.()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit?.()
    }
  }, [onClear, onClose, onSubmit, onValueChange, onQueryChange])

  return (
    <div className="search-bar">
      <input
        ref={resolvedRef}
        className="search-input"
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={searching ? 'Searching…' : 'Search the sky…'}
        spellCheck={false}
        autoComplete="off"
      />
      {value && (
        <div className="search-hint">Enter: hide bar, n/N to cycle · Esc: clear</div>
      )}
    </div>
  )
}
