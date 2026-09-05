import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtlasFile, AtlasHit, AtlasScope } from '@shared/atlas'
import { atlasApi } from './api'

export function mergeResults(exact: AtlasHit[], related: AtlasHit[]): AtlasHit[] {
  const ids = new Set(exact.map(h => h.file.id))
  return [...exact, ...related.filter(hit => !ids.has(hit.file.id))]
}

export function useAtlasSearch(query: string, scope: AtlasScope, mode: 'all' | 'exact' | 'related') {
  const [results, setResults] = useState<AtlasHit[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'enriching' | 'ready'>('idle')
  const [error, setError] = useState<string | null>(null)
  const updatedFiles = useRef(new Map<string, AtlasFile>())
  const updateFile = useCallback((file: AtlasFile) => {
    updatedFiles.current.set(file.id, file)
    if (updatedFiles.current.size > 100) updatedFiles.current.delete(updatedFiles.current.keys().next().value!)
    setResults(current => current.map(hit => hit.file.id === file.id ? { ...hit, file } : hit))
  }, [])
  const generation = useRef(0)
  const scopeKey = JSON.stringify(scope)
  useEffect(() => {
    const current = ++generation.current, abort = new AbortController()
    const valid = () => generation.current === current && !abort.signal.aborted
    setResults([]); setError(null); updatedFiles.current.clear()
    const latestFiles = (hits: AtlasHit[]) => hits.map(hit => ({ ...hit, file: updatedFiles.current.get(hit.file.id) ?? hit.file }))
    if (!query.trim()) { setStatus('idle'); return () => abort.abort() }
    setStatus('searching')
    const timer = setTimeout(async () => {
      const activeScope = JSON.parse(scopeKey) as AtlasScope
      let exact: AtlasHit[] = []
      try {
        if (mode !== 'related') {
          const response = await atlasApi.search(query.trim(), activeScope, 'exact', abort.signal)
          if (!valid()) return
          exact = response.results; setResults(latestFiles(exact))
        }
        if (mode !== 'exact') {
          if (valid()) setStatus('enriching')
          const response = await atlasApi.search(query.trim(), activeScope, 'related', abort.signal)
          if (!valid()) return
          setResults(latestFiles(mergeResults(exact, response.results)))
          if (!response.semanticAvailable) setError('Related search is unavailable. Name and text matches still work.')
        }
      } catch (e) { if (valid()) setError(e instanceof Error ? e.message : 'Search is unavailable') }
      finally { if (valid()) setStatus('ready') }
    }, mode === 'related' ? 160 : 25)
    return () => { clearTimeout(timer); abort.abort() }
  }, [query, scopeKey, mode])
  return { results, status, error, updateFile }
}
