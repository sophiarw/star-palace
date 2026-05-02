import { useState, useRef, useCallback } from 'react'
import { search } from '../../api'
import type { SearchResult } from '@shared/types'

interface Props {
  onResults: (results: SearchResult[]) => void
  onClear: () => void
}

export default function SearchBar({ onResults, onClear }: Props) {
  const [value, setValue] = useState('')
  const [searching, setSearching] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setValue(q)

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
  }, [onResults, onClear])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setValue('')
      onClear()
    }
  }, [onClear])

  return (
    <div className="search-bar">
      <input
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
        <div className="search-hint">ESC to clear · searching {value.length > 0 ? 'for "' + value + '"' : ''}</div>
      )}
    </div>
  )
}
