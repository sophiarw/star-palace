import { useEffect, useRef, useState } from 'react'
import type { AtlasHit, AtlasScope } from '@shared/atlas'
import { atlasApi } from './api'

export function mergeResults(exact: AtlasHit[], related: AtlasHit[]): AtlasHit[] {
  const ids = new Set(exact.map(h => h.file.id))
  return [...exact, ...related.filter(hit => !ids.has(hit.file.id))]
}

export function useAtlasSearch(query: string, scope: AtlasScope, mode: 'all' | 'exact' | 'related') {
  const [results, setResults] = useState<AtlasHit[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'enriching' | 'ready'>('idle')
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const scopeKey = JSON.stringify(scope)
  useEffect(() => {
    const current = ++generation.current, abort = new AbortController()
    const valid = () => generation.current === current && !abort.signal.aborted
    setResults([]); setError(null)
    if (!query.trim()) { setStatus('idle'); return () => abort.abort() }
    setStatus('searching')
    const timer = setTimeout(async () => {
      const activeScope = JSON.parse(scopeKey) as AtlasScope
      let exact: AtlasHit[] = []
      try {
        if (mode !== 'related') {
          const response = await atlasApi.search(query.trim(), activeScope, 'exact', abort.signal)
          if (!valid()) return
          exact = response.results; setResults(exact)
        }
        if (mode !== 'exact') {
          if (valid()) setStatus('enriching')
          const response = await atlasApi.search(query.trim(), activeScope, 'related', abort.signal)
          if (!valid()) return
          setResults(mergeResults(exact, response.results))
          if (!response.semanticAvailable) setError('Related search is unavailable. Name and text matches still work.')
        }
      } catch (e) { if (valid()) setError(e instanceof Error ? e.message : 'Search is unavailable') }
      finally { if (valid()) setStatus('ready') }
    }, mode === 'related' ? 160 : 45)
    return () => { clearTimeout(timer); abort.abort() }
  }, [query, scopeKey, mode])
  return { results, status, error }
}
