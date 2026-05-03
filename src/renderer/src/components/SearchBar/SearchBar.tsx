import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { search } from '../../api'
import type { SearchResult, CollectionSummary } from '@shared/types'

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
  // F5 — collections list, used to resolve the `c:name` / `#name` prefix to a
  // collection id. Optional so call sites without a collections cache (e.g.
  // tests) still compile.
  collections?: CollectionSummary[]
}

// F5 — parse a leading `c:foo ` or `#foo ` token off a search string. The
// matched name keeps its case so we can echo it back in the UI badge, but
// matching against the collections list is case-insensitive (matches the
// way Slack-style "#channel" feels to users).
//
// The trailing space is required so a user typing `c:tax` mid-keystroke
// doesn't break — we only treat it as a filter once they've moved past the
// name. If no space is present yet, we strip nothing and pass the full
// query through; the renderer just searches without filtering until they
// commit the prefix.
const PREFIX_RE = /^(?:c:|#)([^\s]+)\s+(.*)$/

interface ParsedPrefix {
  collectionName: string
  rest: string
}

function parsePrefix(raw: string): ParsedPrefix | null {
  const m = raw.match(PREFIX_RE)
  if (!m) return null
  return { collectionName: m[1], rest: m[2] }
}

export default function SearchBar({
  value, onValueChange, onResults, onClear, onClose, onSubmit, inputRef, onQueryChange,
  collections,
}: Props) {
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

  // F5 — resolve the parsed prefix (if any) against the collections cache.
  // Drives both the badge UI and the collectionId argument passed to
  // /api/search. Memoised on (value, collections) so the debounced search
  // closure below sees a stable reference per render.
  const collectionFilter = useMemo(() => {
    const parsed = parsePrefix(value)
    if (!parsed) return { parsed: null, match: null, rest: value }
    const lower = parsed.collectionName.toLowerCase()
    const match = collections?.find(c => c.name.toLowerCase() === lower) ?? null
    return { parsed, match, rest: parsed.rest }
  }, [value, collections])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    onValueChange(q)
    onQueryChange?.(q)

    if (debounce.current) clearTimeout(debounce.current)

    // Strip the prefix before deciding "is the query empty?" so typing
    // `c:foo ` (with nothing after) still clears results instead of firing a
    // search for the literal "c:foo".
    const parsed = parsePrefix(q)
    const effective = parsed ? parsed.rest : q
    if (!effective.trim()) {
      onClear()
      return
    }

    // Resolve collection id (if any) at fire-time rather than capturing the
    // memoised value, so a user who edits the prefix after typing the body
    // still gets the latest match. Re-parse — collections may have changed.
    const resolveCollectionId = (): number | undefined => {
      if (!parsed) return undefined
      const lower = parsed.collectionName.toLowerCase()
      const match = collections?.find(c => c.name.toLowerCase() === lower) ?? null
      return match?.id
    }

    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await search(effective.trim(), 30, resolveCollectionId())
        onResults(results)
      } catch {
        // daemon may not be running yet
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [onResults, onClear, onValueChange, onQueryChange, collections])

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

  // Badge: show the resolved collection (green) or the unresolved name (red)
  // so the user sees instantly whether their prefix actually filtered.
  const badge = collectionFilter.parsed
    ? (collectionFilter.match
        ? { label: `in: ${collectionFilter.match.name}`, kind: 'ok' as const }
        : { label: `?: ${collectionFilter.parsed.collectionName}`, kind: 'miss' as const })
    : null

  return (
    <div className="search-bar">
      <input
        ref={resolvedRef}
        className="search-input"
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={searching ? 'Searching…' : 'Search the sky…   (c:name or #name to scope)'}
        spellCheck={false}
        autoComplete="off"
      />
      {badge && (
        <div className={badge.kind === 'ok' ? 'search-collection-badge' : 'search-collection-badge search-collection-badge--miss'}>
          {badge.label}
        </div>
      )}
      {value && (
        <div className="search-hint">Enter: hide bar, n/N to cycle · Esc: clear</div>
      )}
    </div>
  )
}
