import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtlasFile, AtlasHit, AtlasScope } from '@shared/atlas'
import { atlasApi } from './api'

export function mergeResults(exact: AtlasHit[], related: AtlasHit[]): AtlasHit[] {
  const ids = new Set(exact.map(h => h.file.id))
  return [...exact, ...related.filter(hit => !ids.has(hit.file.id))]
}

export function useAtlasSearch(query: string, scope: AtlasScope, mode: 'all' | 'exact' | 'related', revision = 0) {
  const [results, setResults] = useState<AtlasHit[]>([])
  const [status, setStatus] = useState<'idle' | 'searching' | 'enriching' | 'ready'>('idle')
  const [error, setError] = useState<string | null>(null)
  const updatedFiles = useRef(new Map<string, AtlasFile>())
  const updateFile = useCallback((file: AtlasFile) => {
    updatedFiles.current.set(file.id, file)
    if (updatedFiles.current.size > 100) updatedFiles.current.delete(updatedFiles.current.keys().next().value!)
    setResults(current => current.map(hit => hit.file.id === file.id ? { ...hit, file } : hit))
  }, [])
  const generation = useRef(0), lexicalGeneration = useRef(0)
  const exactResults = useRef<AtlasHit[]>([]), relatedResults = useRef<AtlasHit[]>([])
  const previousRevision = useRef<{ revision: number; key: string } | null>(null)
  const scopeKey = JSON.stringify(scope)
  useEffect(() => {
    const current = ++generation.current, abort = new AbortController()
    const valid = () => generation.current === current && !abort.signal.aborted
    setResults([]); setError(null); updatedFiles.current.clear(); exactResults.current = []; relatedResults.current = []
    const latestFiles = (hits: AtlasHit[]) => hits.map(hit => ({ ...hit, file: updatedFiles.current.get(hit.file.id) ?? hit.file }))
    if (!query.trim()) { setStatus('idle'); return () => abort.abort() }
    setStatus('searching')
    const timer = setTimeout(async () => {
      const activeScope = JSON.parse(scopeKey) as AtlasScope
      try {
        if (mode !== 'related') {
          const request = ++lexicalGeneration.current
          const response = await atlasApi.search(query.trim(), activeScope, 'exact', abort.signal)
          if (!valid()) return
          if (request === lexicalGeneration.current) { exactResults.current = response.results; setResults(latestFiles(mergeResults(exactResults.current, relatedResults.current))) }
        }
        if (mode !== 'exact') {
          if (valid()) setStatus('enriching')
          const response = await atlasApi.search(query.trim(), activeScope, 'related', abort.signal)
          if (!valid()) return
          relatedResults.current = response.results
          setResults(latestFiles(mergeResults(exactResults.current, relatedResults.current)))
          if (!response.semanticAvailable) setError('Related search is unavailable. Name and text matches still work.')
        }
      } catch (e) { if (valid()) setError(e instanceof Error ? e.message : 'Search is unavailable') }
      finally { if (valid()) setStatus('ready') }
    }, mode === 'related' ? 160 : 25)
    return () => { clearTimeout(timer); abort.abort() }
  }, [query, scopeKey, mode])
  useEffect(() => {
    const key = JSON.stringify([query.trim(), scopeKey, mode]), previous = previousRevision.current
    previousRevision.current = { revision, key }
    if (!previous || previous.key !== key || previous.revision === revision || !query.trim() || mode === 'related') return
    // Indexing may finish after a query returned no results. Refresh lexical
    // matches without clearing the current results or rerunning the local model.
    const current = generation.current, abort = new AbortController()
    const timer = setTimeout(async () => {
      const request = ++lexicalGeneration.current
      try {
        const response = await atlasApi.search(query.trim(), JSON.parse(scopeKey) as AtlasScope, 'exact', abort.signal)
        if (abort.signal.aborted || current !== generation.current || request !== lexicalGeneration.current) return
        exactResults.current = response.results
        setResults(mergeResults(exactResults.current, relatedResults.current).map(hit => ({ ...hit, file: updatedFiles.current.get(hit.file.id) ?? hit.file })))
      } catch { /* Keep the current results; the next index revision can retry. */ }
    }, 200)
    return () => { clearTimeout(timer); abort.abort() }
  }, [revision, query, scopeKey, mode])
  return { results, status, error, updateFile }
}
