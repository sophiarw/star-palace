import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Star, Cluster, MapStats, SearchResult } from '@shared/types'
import { fetchAll, fetchStats } from './api'
import StarMap from './components/StarMap/StarMap'
import SearchBar from './components/SearchBar/SearchBar'
import StatsBar from './components/StatsBar/StatsBar'
import DetailPanel from './components/DetailPanel/DetailPanel'

const STATS_POLL_MS = 10_000  // re-poll stats every 10s

export default function App() {
  const [stars, setStars] = useState<Star[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [stats, setStats] = useState<MapStats | null>(null)
  const [highlights, setHighlights] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const layoutVersionRef = useRef<number>(-1)

  const loadMap = useCallback(async () => {
    try {
      const data = await fetchAll()
      setStars(data.stars)
      setClusters(data.clusters)
      setError(null)
    } catch {
      setError('Cannot reach daemon. Start it with: npm run dev:daemon')
    }
  }, [])

  const pollStats = useCallback(async () => {
    try {
      const s = await fetchStats()
      setStats(s)
      // Re-fetch map if layout version bumped
      if (layoutVersionRef.current >= 0 && s.layoutVersion > layoutVersionRef.current) {
        await loadMap()
      }
      layoutVersionRef.current = s.layoutVersion
    } catch { /* daemon may not be running */ }
  }, [loadMap])

  useEffect(() => {
    loadMap()
    pollStats()
    const interval = setInterval(pollStats, STATS_POLL_MS)
    return () => clearInterval(interval)
  }, [loadMap, pollStats])

  const handleSearchResults = useCallback((results: SearchResult[]) => {
    setHighlights(results)
  }, [])

  const handleClearSearch = useCallback(() => {
    setHighlights([])
  }, [])

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id)
  }, [])

  // Esc closes the detail panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const starsById = useMemo(() => new Map(stars.map(s => [s.id, s])), [stars])
  const clustersById = useMemo(() => new Map(clusters.map(c => [c.id, c])), [clusters])

  const selectedStar = selectedId ? starsById.get(selectedId) ?? null : null
  const selectedCluster = selectedStar?.clusterId !== null && selectedStar?.clusterId !== undefined
    ? clustersById.get(selectedStar.clusterId) ?? null
    : null

  const showEmpty = stars.length === 0

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#020b18' }}>
      <StarMap
        stars={stars}
        clusters={clusters}
        searchHighlights={highlights}
        selectedId={selectedId}
        onSelect={handleSelect}
      />

      <SearchBar
        onResults={handleSearchResults}
        onClear={handleClearSearch}
      />

      <StatsBar stats={stats} starCount={stars.length} />

      {selectedStar && (
        <DetailPanel
          star={selectedStar}
          clusterColorIndex={selectedCluster?.colorIndex ?? null}
          clusterMemberCount={selectedCluster?.memberCount ?? null}
          onClose={() => setSelectedId(null)}
          onSelectNeighbor={(id) => setSelectedId(id)}
        />
      )}

      {showEmpty && (
        <div className="empty-state">
          {error
            ? <>
                <h2>Daemon not running</h2>
                <code>{error}</code>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Then: <code>npm run dev:web</code></p>
              </>
            : <>
                <h2>No stars yet</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Index a directory to populate the sky</p>
                <code>npm run seed:demo</code>
              </>
          }
        </div>
      )}
    </div>
  )
}
