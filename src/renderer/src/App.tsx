import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Star, Cluster, MapStats, SearchResult, StarType, GalaxySummary } from '@shared/types'
import { fetchAll, fetchStats, fetchGalaxies, getCollection } from './api'
import StarMap from './components/StarMap/StarMap'
import SearchBar from './components/SearchBar/SearchBar'
import StatsBar from './components/StatsBar/StatsBar'
import DetailPanel from './components/DetailPanel/DetailPanel'
import Cheatsheet from './components/Cheatsheet/Cheatsheet'
import { useVimMode } from './hooks/useVimMode'
import type { VimAction } from './hooks/useVimMode'
import PCDial from './components/PCDial/PCDial'
import { usePcDial } from './hooks/usePcDial'
import GalaxyPanel from './components/GalaxyPanel/GalaxyPanel'
import { useTheme } from './hooks/useTheme'
import { useClassificationMode } from './hooks/useClassificationMode'
import { computePercentileBuckets } from './components/StarMap/usageStarType'
import CollectionsPanel from './components/CollectionsPanel/CollectionsPanel'
import { useCollections } from './hooks/useCollections'

const GALAXY_FLY_TO_ZOOM = 0.3

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
  const [galaxies, setGalaxies] = useState<GalaxySummary[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [showCollectionsPanel, setShowCollectionsPanel] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const layoutVersionRef = useRef<number>(-1)

  // Ref to focus the search input from vim Cmd/Ctrl+F
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

  const loadGalaxies = useCallback(async () => {
    try {
      const list = await fetchGalaxies()
      setGalaxies(list)
    } catch { /* daemon may not be running */ }
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
    loadGalaxies()
    const interval = setInterval(pollStats, STATS_POLL_MS)
    return () => clearInterval(interval)
  }, [loadMap, pollStats, loadGalaxies])

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
  const themeCtx = useTheme()
  const classCtx = useClassificationMode()

  // F10 — corpus-wide percentile thresholds for the usage classifier.
  // Recomputed whenever the star list mutates (re-index, daemon poll). The
  // classifier reads buckets at draw time so the sky re-skins instantly on
  // mode flip without paying the sort cost again.
  const percentileBuckets = useMemo(() => {
    const scores: number[] = []
    for (const s of stars) {
      // Treat null importance_score (pre-walker-pass legacy rows) as 0 so
      // they land in the bottom bucket. Matches the "babies" intuition.
      scores.push(s.importanceScore ?? 0)
    }
    return computePercentileBuckets(scores)
  }, [stars])

  // F11 — propagate active theme into CSS so chrome (HoverCard ring,
  // DetailPanel pin badge, SearchBar highlight, StarMap selection ring)
  // can read --starpalace-accent / --starpalace-font without needing the
  // theme object in every leaf component.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--starpalace-accent', themeCtx.theme.ui.accentColor)
    root.style.setProperty('--starpalace-font', themeCtx.theme.ui.fontStack)
    root.style.setProperty('--starpalace-title-transform', themeCtx.theme.ui.titleTransform ?? 'none')
    root.style.setProperty('--starpalace-title-letter-spacing', themeCtx.theme.ui.titleLetterSpacing ?? 'normal')
  }, [themeCtx.theme])

  // F9: each star's displayed position is its local PCA position (or daemon-
  // provided fallback) + its galaxy's origin offset. Galaxies live at distinct
  // origins on the spiral so multiple indexed roots show as separate clusters
  // the user can pan between.
  const galaxyOffsetById = useMemo(() => {
    const m = new Map<number, [number, number]>()
    for (const g of galaxies) m.set(g.id, [g.originX, g.originY])
    return m
  }, [galaxies])

  // For SearchResult we need a fallback galaxy lookup (search payload doesn't
  // carry galaxyId). starsById is keyed by id and is the source of truth.
  const galaxyOffsetForStarId = useCallback((id: string): [number, number] => {
    const star = stars.find(s => s.id === id)  // small set; linear scan OK
    if (!star || star.galaxyId === null) return [0, 0]
    return galaxyOffsetById.get(star.galaxyId) ?? [0, 0]
  }, [stars, galaxyOffsetById])

  const projectedStars = useMemo(() => {
    return stars.map(s => {
      const local = pcDial.ready && pcDial.scaledById.size > 0
        ? pcDial.scaledById.get(s.id) ?? null
        : null
      const baseX = local ? local[0] : s.x
      const baseY = local ? local[1] : s.y
      const offset = s.galaxyId !== null
        ? galaxyOffsetById.get(s.galaxyId) ?? [0, 0]
        : [0, 0]
      return { ...s, x: baseX + offset[0], y: baseY + offset[1] }
    })
  }, [stars, pcDial.ready, pcDial.scaledById, galaxyOffsetById])

  const projectedHighlights = useMemo(() => {
    return highlights.map(h => {
      const local = pcDial.ready && pcDial.scaledById.size > 0
        ? pcDial.scaledById.get(h.id) ?? null
        : null
      const baseX = local ? local[0] : h.x
      const baseY = local ? local[1] : h.y
      const [ox, oy] = galaxyOffsetForStarId(h.id)
      return { ...h, x: baseX + ox, y: baseY + oy }
    })
  }, [highlights, pcDial.ready, pcDial.scaledById, galaxyOffsetForStarId])

  const projectedHighlightsRef = useRef<{ id: string; x: number; y: number }[]>([])
  projectedHighlightsRef.current = projectedHighlights

  // Auto-select top result whenever a new search returns hits, and pan to it.
  useEffect(() => {
    if (highlights.length === 0) return
    const top = projectedHighlightsRef.current[0]
    if (!top) return
    setSelectedId(top.id)
    setVimAction({ type: 'panTo', wx: top.x, wy: top.y })
  }, [highlights])

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

  const handleToggleSearch = useCallback(() => {
    setShowSearch(prev => !prev)
  }, [])

  const handleHideSearch = useCallback(() => {
    setShowSearch(false)
  }, [])

  const handleCloseSearch = useCallback(() => {
    setShowSearch(false)
    setSearchQuery('')
    handleClearSearch()
  }, [handleClearSearch])

  const handleSelectStar = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const handleEscape = useCallback(() => {
    setSelectedId(null)
    setHighlights([])
    setShowSearch(false)
    setSearchQuery('')
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

  const handleGalaxyIndexed = useCallback(() => {
    loadGalaxies()
    loadMap()
  }, [loadGalaxies, loadMap])

  const handleGalaxyFlyTo = useCallback((wx: number, wy: number) => {
    setVimAction({ type: 'panTo', wx, wy, zoom: GALAXY_FLY_TO_ZOOM })
  }, [])

  // F5 — Collections. Hook owns the list cache + active-collection state
  // (persisted to localStorage). Member positions and the highlight set used
  // by StarMap are derived per-render from the active collection's id.
  const collections = useCollections()
  const activeCollection = useMemo(() => {
    if (collections.activeCollectionId === null) return null
    return collections.collections.find(c => c.id === collections.activeCollectionId) ?? null
  }, [collections.activeCollectionId, collections.collections])

  // Member id set for the active collection — fetched lazily on demand. We
  // keep it in App-level state so DetailPanel can show "Remove from
  // collection" without re-fetching, and so StarMap (commit 5) can read the
  // hull membership without piercing the daemon API every frame.
  const [activeMemberIds, setActiveMemberIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (collections.activeCollectionId === null) {
      setActiveMemberIds(new Set())
      return
    }
    let cancelled = false
    getCollection(collections.activeCollectionId)
      .then(detail => { if (!cancelled) setActiveMemberIds(new Set(detail.memberIds)) })
      .catch(() => { if (!cancelled) setActiveMemberIds(new Set()) })
    return () => { cancelled = true }
  // Depend on collections.collections so adds/removes update the highlight
  // set; the list ref changes on every refresh after a mutation.
  }, [collections.activeCollectionId, collections.collections])

  const handleRemoveFromActiveCollection = useCallback((fileId: string) => {
    if (collections.activeCollectionId === null) return
    collections.removeMember(collections.activeCollectionId, fileId)
      .catch(err => console.warn('removeMember failed:', err))
  }, [collections])

  const { mode } = useVimMode({
    onAction: dispatchVimAction,
    onToggleSearch: handleToggleSearch,
    onEscape: handleEscape,
    onSelectHovered: handleSelectHovered,
    onSelectStar: handleSelectStar,
    hoveredId,
    selectedId,
    selectedStar,
    searchHighlights: projectedHighlights,
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
        theme={themeCtx.theme}
        classMode={classCtx.mode}
        percentileBuckets={percentileBuckets}
        onPinFile={(id, wx, wy) => {
          pcDial.pinFile(id, wx, wy).catch(err => console.warn('pinFile failed:', err))
        }}
      />

      {showSearch && (
        <SearchBar
          inputRef={searchInputRef}
          value={searchQuery}
          onValueChange={setSearchQuery}
          onResults={handleSearchResults}
          onClear={handleClearSearch}
          onClose={handleCloseSearch}
          onSubmit={handleHideSearch}
        />
      )}

      <PCDial
        axisX={pcDial.axisX}
        axisY={pcDial.axisY}
        componentCount={pcDial.componentCount}
        onChange={pcDial.setAxes}
      />

      <StatsBar
        stats={stats}
        starCount={stars.length}
        vimMode={mode}
        themes={themeCtx.available}
        currentThemeId={themeCtx.theme.id}
        onThemeChange={themeCtx.setTheme}
        classMode={classCtx.mode}
        onClassModeChange={classCtx.setMode}
      />

      <GalaxyPanel
        galaxies={galaxies}
        onIndexed={handleGalaxyIndexed}
        onFlyTo={handleGalaxyFlyTo}
      />

      <CollectionsPanel
        collections={collections.collections}
        activeCollectionId={collections.activeCollectionId}
        onSetActive={collections.setActiveCollectionId}
        onCreate={collections.create}
        onRefreshDynamic={collections.refreshDynamic}
        onDelete={collections.delete}
        searchResults={highlights}
        searchQuery={searchQuery}
        open={showCollectionsPanel}
        onClose={() => setShowCollectionsPanel(p => !p)}
      />

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
          onUnpin={(id) => {
            pcDial.unpinFile(id).catch(err => console.warn('unpinFile failed:', err))
          }}
          activeCollectionName={activeCollection?.name ?? null}
          isMemberOfActive={activeMemberIds.has(selectedStar.id)}
          onRemoveFromCollection={handleRemoveFromActiveCollection}
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
