import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Star, Cluster, MapStats, SearchResult, StarType, GalaxySummary } from '@shared/types'
import { CONSTELLATION_PALETTE } from '@shared/types'
import { fetchAll, fetchStats, fetchGalaxies, getCollection, fetchPositionsSince } from './api'
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
import { useGalaxyVisibility } from './hooks/useGalaxyVisibility'
import PerfOverlay from './components/PerfOverlay/PerfOverlay'
import EmbeddingLab, { type ExperimentPreview } from './components/EmbeddingLab/EmbeddingLab'

const GALAXY_FLY_TO_ZOOM = 0.3

const STATS_POLL_MS = 10_000  // re-poll stats every 10s

export default function App() {
  const [stars, setStars] = useState<Star[]>([])
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [stats, setStats] = useState<MapStats | null>(null)
  const [highlights, setHighlights] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Hover id is intentionally a ref, not React state: the cursor produces a
  // change ~60 Hz during a pan and we don't want every star prop down to
  // SearchBar / GalaxyPanel / DetailPanel to re-render that often. StarMap
  // owns the in-canvas hover visualisation (HoverCard is rendered inside
  // StarMap's component subtree); App only needs hover for vim's Enter
  // (select hovered) binding, which reads via getHoveredId().
  const hoveredIdRef = useRef<string | null>(null)
  const handleHoveredChange = useCallback((id: string | null) => {
    hoveredIdRef.current = id
  }, [])
  const getHoveredId = useCallback(() => hoveredIdRef.current, [])
  const [showCheatsheet, setShowCheatsheet] = useState(true)
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false)
  const [galaxies, setGalaxies] = useState<GalaxySummary[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [showCollectionsPanel, setShowCollectionsPanel] = useState(true)
  const [showPerf, setShowPerf] = useState(false)
  // B3 — EmbeddingLab visibility + the lifted preview state. Preview lives
  // here (not inside the panel) so StarMap can read it for the overlay
  // overrides, and `Back to production` can clear it from either place.
  const [showEmbeddingLab, setShowEmbeddingLab] = useState(false)
  const [experimentPreview, setExperimentPreview] = useState<ExperimentPreview | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const layoutVersionRef = useRef<number>(-1)

  // Ref to focus the search input from vim Cmd/Ctrl+F
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Pending vim action to send to StarMap (new object ref each dispatch so the same action fires repeatedly)
  const [vimAction, setVimAction] = useState<VimAction | null>(null)

  // F5 — Collections. Hook owns the list cache + active-collection state
  // (persisted to localStorage). Member positions and the highlight set used
  // by StarMap are derived per-render from the active collection's id.
  const collections = useCollections()

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
      // On relayout, fetch only the position delta (cheap) instead of the
      // full /api/map/all payload, and patch existing stars in place so
      // unchanged rows keep their Star object identity. Identity preserved
      // here means downstream memos (`rawStarsById`, `projectedStars`,
      // `starsById`) only rebuild the entries that actually moved.
      // Falls back to full loadMap on the very first version observation
      // (layoutVersionRef === -1) and on any error from the delta path.
      if (layoutVersionRef.current >= 0 && s.layoutVersion > layoutVersionRef.current) {
        try {
          const delta = await fetchPositionsSince(layoutVersionRef.current)
          if (delta.positions.length > 0) {
            const patch = new Map(delta.positions.map(p => [p.id, p]))
            setStars(prev => prev.map(star => {
              const upd = patch.get(star.id)
              if (!upd) return star
              if (star.x === upd.x && star.y === upd.y && star.layoutVersion === upd.layoutVersion) return star
              return { ...star, x: upd.x, y: upd.y, layoutVersion: upd.layoutVersion }
            }))
          }
          setClusters(delta.clusters)
        } catch {
          // Network blip or endpoint unavailable — fall back to a full reload.
          await loadMap()
        }
      }
      layoutVersionRef.current = s.layoutVersion
    } catch { /* daemon may not be running */ }
  }, [loadMap])

  // Shift+P toggles the perf overlay. Capture phase + key='P' (uppercase
  // implies Shift held). Skipped when an input/textarea has focus so typing
  // a capital 'P' in the search box doesn't open the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'P' || !e.shiftKey) return
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      setShowPerf(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // B3 — Shift+E mirrors the perf-overlay pattern. Same input-focus skip
  // so typing a capital 'E' in a text field doesn't open the lab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'E' || !e.shiftKey) return
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      setShowEmbeddingLab(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // F16 — per-galaxy visibility filter (renderer-only). Drives projected
  // stars, search highlights, and the percentile-bucket input below.
  // `knownIds` is the canonical list so the hook can prune stale entries
  // (galaxy deleted between sessions).
  const knownGalaxyIds = useMemo(() => galaxies.map(g => g.id), [galaxies])
  const galaxyVis = useGalaxyVisibility(knownGalaxyIds)

  // F16 — a star is visible iff its galaxy is visible. Defaults to true
  // for legacy rows with galaxyId === null (predate F9; can't be hidden
  // without a backfill) and for galaxy ids the hook hasn't seen yet
  // (e.g. before /api/galaxies finishes loading on first paint).
  const isStarVisible = useCallback((galaxyId: number | null): boolean => {
    if (galaxyId === null) return true
    return galaxyVis.isVisible(galaxyId)
  }, [galaxyVis])

  const visibleStars = useMemo(
    () => stars.filter(s => isStarVisible(s.galaxyId)),
    [stars, isStarVisible],
  )

  // F10 — corpus-wide percentile thresholds for the usage classifier.
  // Recomputed whenever the visible star set mutates (re-index, daemon
  // poll, F16 visibility flip). The classifier reads buckets at draw time
  // so the sky re-skins instantly on mode flip without paying the sort
  // cost again. Hidden galaxies are excluded so they don't influence
  // others' classification (per F16 spec).
  const percentileBuckets = useMemo(() => {
    const scores: number[] = []
    for (const s of visibleStars) {
      // Treat null importance_score (pre-walker-pass legacy rows) as 0 so
      // they land in the bottom bucket. Matches the "babies" intuition.
      scores.push(s.importanceScore ?? 0)
    }
    return computePercentileBuckets(scores)
  }, [visibleStars])

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

  // O(1) id lookup over the raw star list. Used by `galaxyOffsetForStarId`
  // and `projectedHighlights` below in place of the previous `stars.find`
  // linear scans, which were O(N) per call and ran on every search-hit
  // projection.
  const rawStarsById = useMemo(() => new Map(stars.map(s => [s.id, s])), [stars])

  // For SearchResult we need a fallback galaxy lookup (search payload doesn't
  // carry galaxyId). The raw-stars Map is the source of truth.
  const galaxyOffsetForStarId = useCallback((id: string): [number, number] => {
    const star = rawStarsById.get(id)
    if (!star || star.galaxyId === null) return [0, 0]
    return galaxyOffsetById.get(star.galaxyId) ?? [0, 0]
  }, [rawStarsById, galaxyOffsetById])

  // F16 — `visibleStars` already excludes hidden galaxies, so projection
  // here only sees what the renderer should draw.
  const projectedStars = useMemo(() => {
    return visibleStars.map(s => {
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
  }, [visibleStars, pcDial.ready, pcDial.scaledById, galaxyOffsetById])

  // F16 — drop search hits whose underlying star lives in a hidden galaxy.
  // The daemon still scans everything (cheaper than rewriting /api/search);
  // we filter client-side so hidden hits don't show up in highlight cycling.
  const projectedHighlights = useMemo(() => {
    return highlights.flatMap(h => {
      const star = rawStarsById.get(h.id)
      if (star && !isStarVisible(star.galaxyId)) return []
      const local = pcDial.ready && pcDial.scaledById.size > 0
        ? pcDial.scaledById.get(h.id) ?? null
        : null
      const baseX = local ? local[0] : h.x
      const baseY = local ? local[1] : h.y
      const [ox, oy] = galaxyOffsetForStarId(h.id)
      return [{ ...h, x: baseX + ox, y: baseY + oy }]
    })
  }, [highlights, rawStarsById, isStarVisible, pcDial.ready, pcDial.scaledById, galaxyOffsetForStarId])

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
    collections.setActiveCollectionId(null)
  }, [handleClearSearch, collections])

  const handleSelectHovered = useCallback(() => {
    const id = hoveredIdRef.current
    if (id !== null) setSelectedId(id)
  }, [])

  const handleToggleCheatsheet = useCallback(() => {
    setShowCheatsheet(v => !v)
  }, [])

  const handleOpenTypeDropdown = useCallback(() => {
    setTypeDropdownOpen(true)
  }, [])

  const handleToggleCollections = useCallback(() => {
    setShowCollectionsPanel(p => !p)
  }, [])

  const handleGalaxyIndexed = useCallback(() => {
    loadGalaxies()
    loadMap()
  }, [loadGalaxies, loadMap])

  const handleGalaxyFlyTo = useCallback((wx: number, wy: number) => {
    setVimAction({ type: 'panTo', wx, wy, zoom: GALAXY_FLY_TO_ZOOM })
  }, [])

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

  // F5 — props bundle for StarMap. The hull color comes from the same
  // CONSTELLATION_PALETTE used for clusters, indexed by the collection's
  // colorIndex so collections visually match constellation hues. Returns
  // null when no collection is active so StarMap skips both the hull and
  // the dim/highlight focus path.
  const starMapActiveCollection = useMemo(() => {
    if (!activeCollection) return null
    const color = CONSTELLATION_PALETTE[activeCollection.colorIndex % CONSTELLATION_PALETTE.length]
    return { color, memberIds: activeMemberIds }
  }, [activeCollection, activeMemberIds])

  // B3 — preview overlay for StarMap. The color tracks the active theme
  // accent so the experimental ring reads as "warm warning" without
  // hardcoding a hex. Position offset matches the same galaxy-offset
  // logic projectedStars uses, so an experimental position lands in the
  // same world space as the production position it's replacing.
  const starMapExperimentPreview = useMemo(() => {
    if (!experimentPreview) return null
    const adjusted = new Map<string, [number, number]>()
    for (const [id, [x, y]] of experimentPreview.positions) {
      const star = rawStarsById.get(id)
      const offset = star && star.galaxyId !== null
        ? galaxyOffsetById.get(star.galaxyId) ?? [0, 0]
        : [0, 0]
      adjusted.set(id, [x + offset[0], y + offset[1]])
    }
    return {
      ids: experimentPreview.ids,
      positions: adjusted,
      color: themeCtx.theme.ui.accentColor,
    }
  }, [experimentPreview, rawStarsById, galaxyOffsetById, themeCtx.theme.ui.accentColor])

  const { mode } = useVimMode({
    onAction: dispatchVimAction,
    onToggleSearch: handleToggleSearch,
    onEscape: handleEscape,
    onSelectHovered: handleSelectHovered,
    onSelectStar: handleSelectStar,
    getHoveredId,
    selectedId,
    selectedStar,
    searchHighlights: projectedHighlights,
    onStarTypeChange: handleStarTypeChange,
    onToggleCheatsheet: handleToggleCheatsheet,
    onOpenTypeDropdown: handleOpenTypeDropdown,
    onToggleCollections: handleToggleCollections,
  })

  const showEmpty = stars.length === 0
  // F16 — distinct empty state when the user has indexed galaxies but
  // hidden every one. Only triggers once the user has actually toggled
  // something (galaxies known but visibleSet empty).
  const allHidden = stars.length > 0
    && knownGalaxyIds.length > 0
    && galaxyVis.visibleSet.size === 0
  // F16 — count of stars residing in hidden galaxies. Drives the
  // "(M hidden)" suffix in StatsBar.
  const hiddenStarCount = stars.length - visibleStars.length

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: '#020b18' }}>
      <StarMap
        stars={projectedStars}
        clusters={clusters}
        searchHighlights={projectedHighlights}
        selectedId={selectedId}
        onSelect={handleSelect}
        vimAction={vimAction}
        onHoveredChange={handleHoveredChange}
        theme={themeCtx.theme}
        classMode={classCtx.mode}
        percentileBuckets={percentileBuckets}
        onPinFile={(id, wx, wy) => {
          pcDial.pinFile(id, wx, wy).catch(err => console.warn('pinFile failed:', err))
        }}
        activeCollection={starMapActiveCollection}
        experimentPreview={starMapExperimentPreview}
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
          collections={collections.collections}
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
        starCount={visibleStars.length}
        hiddenStarCount={hiddenStarCount}
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
        isVisible={galaxyVis.isVisible}
        onToggleVisible={galaxyVis.toggle}
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
        onOpen={() => setShowCollectionsPanel(true)}
        onClose={() => setShowCollectionsPanel(false)}
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

      <PerfOverlay visible={showPerf} onClose={() => setShowPerf(false)} />

      <EmbeddingLab
        visible={showEmbeddingLab}
        onClose={() => setShowEmbeddingLab(false)}
        stars={stars}
        preview={experimentPreview}
        onPreview={setExperimentPreview}
        onMutated={() => {
          // Snapshot promote/revert mutates server-side embeddings; nudge
          // pollStats so the version delta path picks up the new positions
          // and refreshes the sky.
          pollStats().catch(() => { /* surfaced elsewhere */ })
        }}
      />

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

      {!showEmpty && allHidden && (
        <div className="empty-state">
          <h2>All galaxies hidden</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Toggle visibility in the panel to bring stars back.
          </p>
        </div>
      )}
    </div>
  )
}
