import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Star, Cluster, MapStats, SearchResult, StarType } from '@shared/types'
import { fetchAll, fetchStats } from './api'
import StarMap from './components/StarMap/StarMap'
import SearchBar from './components/SearchBar/SearchBar'
import StatsBar from './components/StatsBar/StatsBar'
import DetailPanel from './components/DetailPanel/DetailPanel'
import Cheatsheet from './components/Cheatsheet/Cheatsheet'
import { useVimMode } from './hooks/useVimMode'
import type { VimAction } from './hooks/useVimMode'
import PCDial from './components/PCDial/PCDial'
import { usePcDial } from './hooks/usePcDial'

const STATS_POLL_MS = 10_000  // re-poll stats every 10s

export default function App() {
  const [stars, setStars] = useState<Star[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [stats, setStats] = useState<MapStats | null>(null)
  const [highlights, setHighlights] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [showCheatsheet, setShowCheatsheet] = useState(true)
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const layoutVersionRef = useRef<number>(-1)

  // Ref to focus the search input from vim '/'
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Pending vim action to send to StarMap (new object ref each dispatch so the same action fires repeatedly)
  const [vimAction, setVimAction] = useState<VimAction | null>(null)

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

  const handleStarTypeChange = useCallback((id: string, starType: StarType | null) => {
    setStars(prev => prev.map(s => s.id === id ? { ...s, starType } : s))
  }, [])

  const pcDial = usePcDial()

  const projectedStars = useMemo(() => {
    if (!pcDial.ready || pcDial.scaledById.size === 0) return stars
    return stars.map(s => {
      const proj = pcDial.scaledById.get(s.id)
      return proj ? { ...s, x: proj[0], y: proj[1] } : s
    })
  }, [stars, pcDial.ready, pcDial.scaledById])

  const projectedHighlights = useMemo(() => {
    if (!pcDial.ready || pcDial.scaledById.size === 0) return highlights
    return highlights.map(h => {
      const proj = pcDial.scaledById.get(h.id)
      return proj ? { ...h, x: proj[0], y: proj[1] } : h
    })
  }, [highlights, pcDial.ready, pcDial.scaledById])

  const starsById = useMemo(() => new Map(projectedStars.map(s => [s.id, s])), [projectedStars])
  const clustersById = useMemo(() => new Map(clusters.map(c => [c.id, c])), [clusters])

  const selectedStar = selectedId ? starsById.get(selectedId) ?? null : null
  const selectedCluster = selectedStar?.clusterId !== null && selectedStar?.clusterId !== undefined
    ? clustersById.get(selectedStar.clusterId) ?? null
    : null

  // Each dispatch spreads into a new object so repeated identical actions still
  // trigger the StarMap useEffect (React bails out when state is the same ref).
  const dispatchVimAction = useCallback((action: VimAction) => {
    setVimAction({ ...action })
  }, [])

  const handleFocusSearch = useCallback(() => {
    searchInputRef.current?.focus()
  }, [])

  const handleEscape = useCallback(() => {
    setSelectedId(null)
    setHighlights([])
    handleClearSearch()
  }, [handleClearSearch])

  const handleSelectHovered = useCallback(() => {
    if (hoveredId) setSelectedId(hoveredId)
  }, [hoveredId])

  const handleToggleCheatsheet = useCallback(() => {
    setShowCheatsheet(v => !v)
  }, [])

  const handleOpenTypeDropdown = useCallback(() => {
    setTypeDropdownOpen(true)
  }, [])

  const { mode } = useVimMode({
    onAction: dispatchVimAction,
    onFocusSearch: handleFocusSearch,
    onEscape: handleEscape,
    onSelectHovered: handleSelectHovered,
    hoveredId,
    selectedId,
    selectedStar,
    searchHighlights: highlights,
    onStarTypeChange: handleStarTypeChange,
    onToggleCheatsheet: handleToggleCheatsheet,
    onOpenTypeDropdown: handleOpenTypeDropdown,
  })

  const showEmpty = stars.length === 0

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#020b18' }}>
      <StarMap
        stars={projectedStars}
        clusters={clusters}
        searchHighlights={projectedHighlights}
        selectedId={selectedId}
        onSelect={handleSelect}
        vimAction={vimAction}
        onHoveredChange={setHoveredId}
      />

      <SearchBar
        inputRef={searchInputRef}
        onResults={handleSearchResults}
        onClear={handleClearSearch}
        onFocus={() => { /* mode transitions handled in useVimMode */ }}
      />

      <PCDial
        axisX={pcDial.axisX}
        axisY={pcDial.axisY}
        componentCount={pcDial.componentCount}
        onChange={pcDial.setAxes}
      />

      <StatsBar stats={stats} starCount={stars.length} vimMode={mode} />

      {selectedStar && (
        <DetailPanel
          star={selectedStar}
          clusterColorIndex={selectedCluster?.colorIndex ?? null}
          clusterMemberCount={selectedCluster?.memberCount ?? null}
          onClose={() => setSelectedId(null)}
          onSelectNeighbor={(id) => setSelectedId(id)}
          onStarTypeChange={handleStarTypeChange}
          typeDropdownOpen={typeDropdownOpen}
          onTypeDropdownChange={setTypeDropdownOpen}
        />
      )}

      {showCheatsheet && (
        <Cheatsheet onClose={() => setShowCheatsheet(false)} />
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
