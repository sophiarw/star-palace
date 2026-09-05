import { CELESTIAL_LABELS, CELESTIAL_REASONS, celestialType } from '@shared/celestial'
import { STAR_TYPES } from '@shared/types'
import { CelestialIcon } from './CelestialIcon'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { AtlasFile, AtlasHit, AtlasRegion, AtlasScope, AtlasSnapshot, AtlasSummary } from '@shared/atlas'
import type { CollectionSummary, FileCategory, GalaxySummary } from '@shared/types'
import { cancelIndex, createCollection, deleteCollection, fetchGalaxies, fetchIgnorePatterns, getCollection, listCollections, openFile, refreshCollection, removeCollectionMember, revealFile, saveIgnorePatterns, startIndex } from '../api'
import { useIndexProgress } from '../hooks/useIndexProgress'
import { atlasApi } from './api'
import { AtlasMap, type MapHandle, type MapMetrics } from './AtlasMap'
import { Highlighted } from './Highlighted'
import type { Camera } from './scene'
const Reader = lazy(() => import('./Reader').then(module => ({ default: module.Reader })))
import { Modal } from './Modal'
import { readStored, writeStored } from './storage'
import { useAtlasSearch } from './useAtlasSearch'
import './atlas.css'

type View = 'map' | 'list' | 'grid'
type Dialog = 'sources' | 'settings' | 'collection' | 'commands' | 'rename' | 'objects' | null
interface Place { name: string; scope: AtlasScope; selectedId: string | null; camera?: Camera; cameraKey?: string }
const EMPTY_HITS = new Set<string>()
const INITIAL: AtlasSummary = { revision: 0, total: 0, positioned: 0, searchable: 0, pending: 0, regions: [] }
const THEMES = [{ id: 'jwst', name: 'Atlas · Deep space' }, { id: 'vapor', name: 'Vapor · Rose & violet' }, { id: 'atari', name: 'Atari · Phosphor' }, { id: 'lost', name: 'Lost in space · Warm dusk' }, { id: 'bio', name: 'Bioluminescent · Tidal light' }]

export default function AtlasApp() {
  const [scope, setScope] = useState<AtlasScope>(() => readStored('scope', {})), [view, setView] = useState<View>(() => readStored('view', 'map'))
  const [summary, setSummary] = useState<AtlasSummary>(INITIAL), [galaxies, setGalaxies] = useState<GalaxySummary[]>([]), [collections, setCollections] = useState<CollectionSummary[]>([])
  const [files, setFiles] = useState<AtlasFile[]>([]), [fileTotal, setFileTotal] = useState(0), [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<AtlasFile | null>(null), [selectedId, setSelectedId] = useState<string | null>(() => readStored('selected', null))
  const [query, setQuery] = useState(''), [searchMode, setSearchMode] = useState<'all' | 'exact' | 'related'>('all'), [activeResult, setActiveResult] = useState(0)
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false), [dialog, setDialog] = useState<Dialog>(null), [sidebar, setSidebar] = useState(true)
  const [theme, setTheme] = useState<string>(() => readStored('theme', 'jwst')), [readerWidth, setReaderWidth] = useState<number>(() => readStored('readerWidth', 380))
  const [places, setPlaces] = useState<Place[]>(() => readStored('places', [])), [metrics, setMetrics] = useState<MapMetrics | null>(null), [showMetrics, setShowMetrics] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const map = useRef<MapHandle>(null), searchInput = useRef<HTMLInputElement>(null), history = useRef<AtlasScope[]>([]), future = useRef<AtlasScope[]>([])
  const progress = useIndexProgress(jobId)
  const scopeKey = JSON.stringify(scope)
  // Search honors all current filters. Clicking a result navigates the map
  // without replacing the scope under an in-progress search.
  const search = useAtlasSearch(query, scope, searchMode)
  const [searchDestination, setSearchDestination] = useState<AtlasRegion | null>(null)
  const baseScope = useMemo(() => { const { regionId: _r, neighborhoodId: _n, ...base } = JSON.parse(scopeKey) as AtlasScope; return base }, [scopeKey])
  const baseScopeKey = JSON.stringify(baseScope)

  const refreshLists = useCallback(async () => {
    const [sources, groups] = await Promise.all([fetchGalaxies(), listCollections()]); setGalaxies(sources); setCollections(groups)
  }, [])
  useEffect(() => { void refreshLists().catch(() => {}) }, [refreshLists, refresh])
  useEffect(() => {
    const abort = new AbortController()
    let inFlight = false
    const load = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const next = await atlasApi.summary(JSON.parse(baseScopeKey) as AtlasScope, abort.signal)
        if (abort.signal.aborted) return
        setSummary(previous => next.revision === previous.revision && JSON.stringify(previous.regions) === JSON.stringify(next.regions) ? previous : next)
        setError(current => current?.startsWith('The local library is unavailable.') ? null : current)
      } catch { if (!abort.signal.aborted) setError('The local library is unavailable. Start the daemon, then retry.') }
      finally { inFlight = false; if (!abort.signal.aborted) setLoading(false) }
    }
    void load(); const timer = setInterval(() => void load(), 2000)
    return () => { clearInterval(timer); abort.abort() }
  }, [baseScopeKey, refresh])

  const region = summary.regions.find(r => r.id === scope.regionId) ?? null
  const neighborhood = summary.regions.find(r => r.id === scope.neighborhoodId) ?? null
  const sceneGroup = searchDestination ?? neighborhood
  const fileScope = useMemo<AtlasScope>(() => searchDestination ? { ...baseScope, neighborhoodId: searchDestination.id } : JSON.parse(scopeKey) as AtlasScope, [searchDestination, baseScope, scopeKey])
  const fileScopeKey = JSON.stringify(fileScope)
  const needsFiles = view !== 'map' || !!sceneGroup
  useEffect(() => {
    if (!needsFiles) { setFiles([]); setFileTotal(0); return }
    const abort = new AbortController()
    atlasApi.files(JSON.parse(fileScopeKey) as AtlasScope, offset, 100, abort.signal).then(page => {
      if (!abort.signal.aborted) { setFiles(page.files); setFileTotal(page.total) }
    }).catch(e => { if (!abort.signal.aborted) setError(String(e)) })
    return () => abort.abort()
  }, [fileScopeKey, offset, needsFiles, summary.revision, refresh])
  useEffect(() => { setOffset(0); setSearchDestination(null); writeStored('scope', JSON.parse(scopeKey)) }, [scopeKey])
  useEffect(() => { writeStored('view', view) }, [view])
  useEffect(() => { writeStored('theme', theme) }, [theme])
  useEffect(() => { writeStored('readerWidth', readerWidth) }, [readerWidth])
  useEffect(() => { writeStored('places', places) }, [places])
  useEffect(() => {
    if (!selectedId) { setSelected(null); writeStored('selected', null); return }
    writeStored('selected', selectedId)
    const abort = new AbortController()
    atlasApi.file(selectedId, abort.signal).then(file => { if (!abort.signal.aborted) setSelected(file) }).catch(() => { if (!abort.signal.aborted) { setSelected(null); setSelectedId(null) } })
    return () => abort.abort()
  }, [selectedId, refresh])
  useEffect(() => {
    if (progress.status === 'done' || progress.status === 'cancelled') { setRefresh(n => n + 1); setNotice(progress.status === 'done' ? 'Source indexed. The atlas is updating.' : 'Indexing stopped. Completed files are kept.') }
    if (progress.status === 'error') { setError(progress.errorMessage ?? 'Indexing stopped. Completed files are kept.'); setRefresh(n => n + 1) }
  }, [progress.status, progress.errorMessage])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer) }, [notice])
  useEffect(() => { setActiveResult(0); if (!query) setSearchDestination(null) }, [query, scopeKey, searchMode])

  const navigate = useCallback((next: AtlasScope) => {
    history.current.push(scope); future.current = []; setScope(next); setExpanded(false); setSearchDestination(null)
  }, [scope])
  const selectFile = useCallback((file: AtlasFile) => { setSelected(file); setSelectedId(file.id) }, [])
  const selectId = useCallback(async (id: string) => {
    try { selectFile(await atlasApi.file(id)) } catch (e) { setError(String(e)) }
  }, [selectFile])
  const selectHit = useCallback((hit: AtlasHit) => {
    selectFile(hit.file)
    const group = summary.regions.find(r => r.id === hit.file.neighborhoodId)
    if (group) setSearchDestination(group)
  }, [selectFile, summary.regions])
  const changeFile = useCallback((file: AtlasFile) => {
    setSelected(file); setFiles(current => current.map(f => f.id === file.id ? file : f)); setRefresh(n => n + 1)
  }, [])
  const sequence = query.trim() ? search.results.map(h => h.file) : files
  const cycle = useCallback((step: number) => {
    if (!sequence.length) return
    const index = sequence.findIndex(f => f.id === selectedId)
    const next = sequence[(index + step + sequence.length) % sequence.length]
    selectFile(next)
  }, [sequence, selectedId, selectFile])
  const back = useCallback(() => {
    if (expanded) { setExpanded(false); return }
    if (searchDestination) { setSearchDestination(null); return }
    const previous = history.current.pop()
    if (previous) { future.current.push(scope); setScope(previous) }
    else if (scope.neighborhoodId) { const { neighborhoodId: _n, ...next } = scope; setScope(next) }
    else if (scope.regionId) { const { regionId: _r, ...next } = scope; setScope(next) }
    else setScope({})
  }, [expanded, searchDestination, scope])
  useEffect(() => {
    let previous = ''
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if ((event.metaKey || event.ctrlKey) && ['k', 'f'].includes(event.key.toLowerCase())) { event.preventDefault(); searchInput.current?.focus(); searchInput.current?.select(); return }
      if (target.closest('input,textarea,select,[contenteditable="true"],dialog')) return
      if (event.key === 'Escape') { if (query) setQuery(''); else back() }
      if (event.key === '?') setDialog('commands')
      if (event.key === 'P' && event.shiftKey) setShowMetrics(v => !v)
      if (event.key === 'n') cycle(1)
      if (event.key === 'N') cycle(-1)
      if (event.key === 'Enter' && selected) setExpanded(v => !v)
      if (event.key === 'o' && selected) void openFile(selected.id).catch(e => setError(String(e)))
      if (event.key === 'O' && selected) void revealFile(selected.id).catch(e => setError(String(e)))
      const directions: Record<string, [number, number]> = { h: [-70, 0], j: [0, 70], k: [0, -70], l: [70, 0] }
      const direction = directions[event.key.toLowerCase()]
      if (direction && !expanded) { event.preventDefault(); map.current?.pan(direction[0] * (event.shiftKey ? 4 : 1), direction[1] * (event.shiftKey ? 4 : 1)) }
      if (event.key === '+' || event.key === '=') map.current?.zoom(1.3)
      if (event.key === '-') map.current?.zoom(1 / 1.3)
      if (event.key === 'g' && previous === 'g') map.current?.fit()
      previous = event.key
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [back, cycle, query, selected, expanded])

  const sceneRegions = useMemo(() => sceneGroup ? [] : region
    ? summary.regions.filter(r => r.parentId === region.id)
    : summary.regions.filter(r => r.kind === 'region'), [summary.regions, sceneGroup, region])
  const highlights = useMemo(() => query ? new Set(search.results.map(h => h.file.id)) : EMPTY_HITS, [query, search.results])
  const mapFiles = useMemo(() => sceneGroup ? files : [], [sceneGroup, files])
  const displayFiles = query.trim() ? search.results.map(h => h.file) : files
  const title = searchDestination?.label ?? neighborhood?.label ?? region?.label ?? (scope.collectionId ? collections.find(c => c.id === scope.collectionId)?.name : null) ?? 'Your atlas'
  const act = async (operation: () => Promise<void>) => { setBusy(true); setError(null); try { await operation() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const showRegion = (r: AtlasRegion) => navigate(r.kind === 'region' ? { ...baseScope, regionId: r.id } : { ...baseScope, regionId: r.parentId ?? undefined, neighborhoodId: r.id })
  const cameraKey = sceneGroup?.id ?? scope.regionId ?? baseScopeKey
  const savePlace = () => {
    const savedScope = searchDestination ? { ...baseScope, regionId: searchDestination.parentId ?? undefined, neighborhoodId: searchDestination.id } : scope
    setPlaces(current => [...current.filter(p => p.name !== title), { name: title, scope: savedScope, selectedId, camera: map.current?.camera(), cameraKey }].slice(-20))
    setNotice('Place saved, including its current view.')
  }

  return <div className={`atlas-shell atlas-theme-${theme} ${expanded ? 'atlas-reading' : ''} ${sidebar ? '' : 'atlas-sidebar-hidden'}`} style={{ '--reader-width': `${Math.max(300, Math.min(650, readerWidth))}px` } as CSSProperties}>
    <header className="atlas-topbar"><button className="atlas-brand" onClick={() => navigate({})} aria-label="Star Palace home"><span aria-hidden="true">✳</span><strong>STAR PALACE</strong></button>
      <div className="atlas-search-field"><span aria-hidden="true">⌕</span><input ref={searchInput} value={query} placeholder="Find a file, a phrase, a place…" aria-label="Search library" onChange={e => setQuery(e.target.value)} onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); setQuery(''); e.currentTarget.blur() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const count = search.results.length; if (count) setActiveResult(n => (n + (e.key === 'ArrowDown' ? 1 : -1) + count) % count) }
        if (e.key === 'Enter' && search.results[activeResult]) { e.preventDefault(); selectHit(search.results[activeResult]) }
      }} />{query ? <button aria-label="Clear search" onClick={() => setQuery('')}>×</button> : <kbd>⌘ / Ctrl K</kbd>}</div>
      <button className="atlas-top-action" onClick={() => setDialog('commands')}>Commands <kbd>?</kbd></button><button className="atlas-icon-button" aria-label="Settings" onClick={() => setDialog('settings')}>⚙</button>
    </header>
    <div className="atlas-workspace">
      <nav className="atlas-sidebar" aria-label="Library navigation"><div className="atlas-eyebrow">Workspace</div><button className={`atlas-nav-item ${!scope.regionId && !scope.collectionId ? 'is-active' : ''}`} onClick={() => navigate({})}><span>✧ &nbsp; Your atlas</span><small>{summary.total.toLocaleString()}</small></button>
        <div className="atlas-sidebar-heading"><span className="atlas-eyebrow">Sources</span><button aria-label="Add source" onClick={() => setDialog('sources')}>+</button></div>
        {galaxies.filter(g => g.memberCount || !g.rootPath.startsWith('__default__')).map(g => <div className="atlas-source-row" key={g.id}><button className="atlas-nav-item" onClick={() => navigate({ galaxyIds: [g.id] })}><span>{g.name}</span><small>{g.memberCount.toLocaleString()}</small></button><button className="atlas-source-visibility" aria-label={`${scope.galaxyIds && !scope.galaxyIds.includes(g.id) ? 'Show' : 'Hide'} ${g.name}`} aria-pressed={!scope.galaxyIds || scope.galaxyIds.includes(g.id)} onClick={() => {
          const ids = scope.galaxyIds ?? galaxies.map(s => s.id); navigate({ ...baseScope, galaxyIds: ids.includes(g.id) ? ids.filter(id => id !== g.id) : [...ids, g.id] })
        }}>{!scope.galaxyIds || scope.galaxyIds.includes(g.id) ? '◉' : '○'}</button></div>)}
        <div className="atlas-sidebar-heading"><span className="atlas-eyebrow">Regions</span></div><div className="atlas-region-nav">{summary.regions.filter(r => r.kind === 'region').map(r => <button key={r.id} className={`atlas-nav-item ${scope.regionId === r.id ? 'is-active' : ''}`} onClick={() => showRegion(r)}><span><i style={{ background: r.color }} />{r.label}</span><small>{r.count}</small></button>)}</div>
        <div className="atlas-sidebar-heading"><span className="atlas-eyebrow">Collections</span><button aria-label="Create collection" onClick={() => setDialog('collection')}>+</button></div>{collections.map(c => <button key={c.id} className={`atlas-nav-item ${scope.collectionId === c.id ? 'is-active' : ''}`} onClick={() => navigate({ collectionId: c.id })}><span>{c.kind === 'dynamic' ? '⌕' : '◇'} &nbsp;{c.name}</span><small>{c.memberCount}</small></button>)}
        {!!places.length && <><div className="atlas-sidebar-heading"><span className="atlas-eyebrow">Saved places</span></div>{places.map((p, i) => <button className="atlas-nav-item" key={i} onClick={() => { if (p.camera && p.cameraKey) writeStored('camera.' + p.cameraKey, p.camera); navigate(p.scope); setSelectedId(p.selectedId); if (p.camera && p.cameraKey === cameraKey) map.current?.restore(p.camera) }}><span>⌖ &nbsp;{p.name}</span></button>)}</>}
        <footer><span className="atlas-status-dot" />{loading ? 'Connecting to your library' : `${summary.positioned.toLocaleString()} files in view`}<br />{summary.pending ? `Placing ${summary.pending.toLocaleString()} files…` : `${summary.searchable.toLocaleString()} previews indexed`}<button onClick={() => setDialog('sources')}>Manage sources ↗</button></footer>
      </nav>
      <main className="atlas-main"><div className="atlas-context"><div><div className="atlas-breadcrumb"><button onClick={() => navigate(baseScope)}>Library</button><span>/</span>{region && <><button onClick={() => navigate({ ...baseScope, regionId: region.id })}>{region.label}</button><span>/</span></>}<span>{sceneGroup ? 'Neighborhood' : region ? 'Regions within' : 'Overview'}</span></div><h1>{title}</h1></div><div className="atlas-view-switch">{(['map', 'list', 'grid'] as const).map(v => <button key={v} aria-pressed={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>{v === 'map' ? 'Map' : v === 'list' ? 'List' : 'Grid'}</button>)}</div></div>
        <div className="atlas-filterbar"><button className="atlas-icon-button" aria-label="Toggle sidebar" onClick={() => setSidebar(v => !v)}>☷</button><select aria-label="Filter by file type" value={scope.category ?? ''} onChange={e => navigate({ ...scope, category: e.target.value ? e.target.value as FileCategory : undefined })}><option value="">All file types</option>{['document', 'code', 'data', 'media', 'unknown'].map(t => <option key={t} value={t}>{t === 'unknown' ? 'Other files' : t[0].toUpperCase() + t.slice(1)}</option>)}</select>
          {query && <select aria-label="Search mode" value={searchMode} onChange={e => setSearchMode(e.target.value as typeof searchMode)}><option value="all">Text + related</option><option value="exact">Names & text</option><option value="related">Related meaning</option></select>}
          {(region || neighborhood) && <button onClick={() => setDialog('rename')}>Rename region</button>}<button onClick={savePlace}>⌖ Save place</button><button onClick={() => setDialog('objects')}>Object guide</button>
          {scope.collectionId && <button onClick={() => setDialog('collection')}>Manage collection</button>}
        </div>
        <div className="atlas-stage">
          {view === 'map' ? <AtlasMap ref={map} scopeKey={sceneGroup?.id ?? scope.regionId ?? baseScopeKey} regions={sceneRegions} files={mapFiles} selectedId={selectedId} highlights={highlights} theme={theme}
            onRegion={showRegion} onBack={back} onSelect={selectFile} onRead={() => setExpanded(true)} onPin={(id, x, y) => void act(async () => { const result = await atlasApi.pin(id, x, y); changeFile(result.file) })} onMetrics={setMetrics} />
            : <div className={`atlas-file-browser atlas-file-browser-${view}`} aria-label="Files">{displayFiles.map(file => <button key={file.id} className={`atlas-file-tile ${selectedId === file.id ? 'is-selected' : ''}`} onClick={() => selectFile(file)} onDoubleClick={() => setExpanded(true)}>
              <span className={`atlas-tile-icon atlas-type-${file.category}`}>{file.mimeType.startsWith('image/') && view === 'grid' ? <img src={`http://127.0.0.1:${((import.meta as ImportMeta & { env: { VITE_DAEMON_PORT?: string } }).env.VITE_DAEMON_PORT) ?? 7373}/api/file/${file.id}/raw`} alt="" loading="lazy" /> : <CelestialIcon type={celestialType(file)} size={view === 'grid' ? 90 : 40} />}</span>
              <span className="atlas-tile-title"><Highlighted text={file.name} query={query} /><small>{file.path}</small></span><span className="atlas-tile-meta">{file.isPinned ? '⌖ ' : ''}{new Date(file.modifiedAt).toLocaleDateString()}</span>
            </button>)}{!displayFiles.length && <div className="atlas-empty"><h2>{query ? 'No matching files' : 'No files in this scope'}</h2><p>Choose another region or adjust your filters.</p></div>}</div>}
          {view === 'map' && query.trim() && <section className="atlas-results" aria-label="Search results"><header><span>{search.results.length} matches</span><button onClick={() => setDialog('collection')}>Save results</button></header>
            {search.status === 'searching' && <p className="atlas-results-state">Searching your library…</p>}
            {search.results.map((hit, i) => <button key={hit.file.id} className={`atlas-result ${i === activeResult ? 'is-active' : ''} ${hit.file.id === selectedId ? 'is-selected' : ''}`} onClick={() => { setActiveResult(i); selectHit(hit) }}><strong><Highlighted text={hit.file.name} query={query} /></strong><small>{hit.reason === 'related' ? 'Related by meaning' : `Matches ${hit.reason}`}</small><p><Highlighted text={hit.snippet} query={query} /></p></button>)}
            {search.status === 'enriching' && <p className="atlas-results-state">Looking for related files…</p>}{search.error && <p className="atlas-results-state">{search.error}</p>}{search.status === 'ready' && !search.results.length && <p className="atlas-results-state">No matches. Try a filename, a phrase, or a broader scope.</p>}
          </section>}
          {!loading && !summary.positioned && !query && <div className="atlas-empty"><span>✧</span><h2>{summary.total ? 'No visible regions' : 'A universe waiting to be discovered.'}</h2><p>{summary.total ? 'Show a source or clear your filters to return to your files.' : 'Add a folder. Your files will find a place in the atlas.'}</p><button className="atlas-primary-button" onClick={() => summary.total ? navigate({}) : setDialog('sources')}>{summary.total ? 'Show all files' : 'Add your first folder'}</button></div>}
          {loading && <div className="atlas-loading atlas-stage-loading">Opening your atlas…</div>}
        </div>
        <div className="atlas-map-footer"><div><button onClick={back}>← Back</button><button onClick={() => { const next = future.current.pop(); if (next) { history.current.push(scope); setScope(next) } }} disabled={!future.current.length}>Forward →</button></div>{view === 'map' ? <div><button onClick={() => map.current?.fit()}>Fit view</button><button onClick={() => map.current?.zoom(1 / 1.4)} aria-label="Zoom out">−</button><span>{sceneGroup ? 'Files' : region ? 'Neighborhoods' : 'Overview'}</span><button onClick={() => map.current?.zoom(1.4)} aria-label="Zoom in">+</button></div> : <div><button disabled={offset === 0 || !!query} onClick={() => setOffset(n => Math.max(0, n - 100))}>Previous</button><span>{query ? search.results.length : `${offset + (files.length ? 1 : 0)}–${offset + files.length} of ${fileTotal}`}</span><button disabled={offset + files.length >= fileTotal || !!query} onClick={() => setOffset(n => n + 100)}>Next</button></div>}</div>
        {showMetrics && metrics && <div className="atlas-metrics">{metrics.renderer} · {metrics.points} points · {metrics.labels} labels · {metrics.drawMs.toFixed(2)}ms draw · {(metrics.bytes / 1048576).toFixed(1)} MiB buffers</div>}
      </main>
      <div className="atlas-reader-resizer" role="separator" aria-label="Reader width" aria-orientation="vertical" tabIndex={0} onKeyDown={e => { if (e.key === 'ArrowLeft') setReaderWidth(w => Math.min(650, w + 20)); if (e.key === 'ArrowRight') setReaderWidth(w => Math.max(300, w - 20)) }} onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.dragging = 'true'
      }} onPointerMove={e => { if (e.currentTarget.dataset.dragging === 'true') setReaderWidth(Math.min(650, Math.max(300, window.innerWidth - e.clientX))) }} onPointerUp={e => { e.currentTarget.dataset.dragging = 'false'; e.currentTarget.releasePointerCapture(e.pointerId) }} />
      <Suspense key={selected ? 'reading' : 'empty'} fallback={<aside className="atlas-reader"><p className="atlas-muted">Opening reader…</p></aside>}>{selected ? <Reader key={selected.id} file={selected} expanded={expanded} query={query} collections={collections} onExpand={() => setExpanded(v => !v)} onClose={() => { setSelectedId(null); setExpanded(false) }} onSelect={id => void selectId(id)} onChange={changeFile} hasSequence={sequence.length > 1} onPrevious={() => cycle(-1)} onNext={() => cycle(1)} /> : <aside className="atlas-reader atlas-reader-empty"><span>✧</span><h2>Room to think.</h2><p>Select a file to preview it here.<br />Your place in the atlas stays close.</p></aside>}</Suspense>
    </div>
    {error && <div className="atlas-toast atlas-toast-error" role="alert">{error}<button onClick={() => { setError(null); setRefresh(n => n + 1) }}>Retry</button><button aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}
    {notice && <div className="atlas-toast" role="status">{notice}</div>}
    {progress.status === 'running' && <div className="atlas-index-status" role="status"><span className="atlas-status-dot" />Indexing · {progress.scanned} files{progress.stalled ? ' · Waiting for model' : ''}<button onClick={() => jobId && void cancelIndex(jobId)}>Stop</button></div>}
    {dialog === 'objects' && <Modal title="A sky full of different things" onClose={() => setDialog(null)}><p className="atlas-muted">File types have their own celestial identities. They share the same neighborhoods. You can also choose any object in a file’s details.</p><div className="atlas-object-guide">{STAR_TYPES.map(type => <div key={type}><CelestialIcon type={type} /><span><strong>{CELESTIAL_LABELS[type]}</strong><small>{CELESTIAL_REASONS[type]}</small></span></div>)}</div></Modal>}
    {dialog === 'sources' && <Modal title="Your sources" onClose={() => setDialog(null)}><p className="atlas-muted">Index a folder to add its files. Names and previews work even when the embedding model is offline.</p><form className="atlas-form" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); void act(async () => { const job = await startIndex(String(form.get('path')), String(form.get('name')) || undefined); setJobId(job.jobId); setDialog(null); setNotice('Indexing started'); setRefresh(n => n + 1) }) }}><label>Folder path<input name="path" placeholder="/Users/you/Documents" required /></label><label>Name <span className="atlas-muted">optional</span><input name="name" placeholder="My library" /></label><button className="atlas-primary-button" disabled={busy}>{busy ? 'Starting…' : 'Index folder'}</button></form><div className="atlas-source-list">{galaxies.filter(g => !g.rootPath.startsWith('__default__')).map(g => <div key={g.id}><strong>{g.name}</strong><small>{g.rootPath}</small><button disabled={busy} onClick={() => void act(async () => { const job = await startIndex(g.rootPath, g.name); setJobId(job.jobId); setDialog(null) })}>Reindex</button></div>)}</div></Modal>}
    {dialog === 'collection' && <CollectionDialog activeId={scope.collectionId} selectedId={selectedId} hits={search.results} query={query} busy={busy} onClose={() => setDialog(null)} onAction={act} onDone={() => { setRefresh(n => n + 1); setDialog(null); setNotice('Collection updated') }} />}
    {dialog === 'settings' && <SettingsDialog theme={theme} onTheme={setTheme} onClose={() => setDialog(null)} onNotice={setNotice} onRefresh={() => setRefresh(n => n + 1)} />}
    {dialog === 'rename' && <Modal title="Name this region" onClose={() => setDialog(null)}><form className="atlas-form" onSubmit={e => { e.preventDefault(); const group = neighborhood ?? region; const label = String(new FormData(e.currentTarget).get('label')); if (group) void act(async () => { await atlasApi.rename(group.id, label); setRefresh(n => n + 1); setDialog(null) }) }}><label>Region name<input name="label" defaultValue={(neighborhood ?? region)?.label} maxLength={120} required /></label><button className="atlas-primary-button" disabled={busy}>Save name</button></form></Modal>}
    {dialog === 'commands' && <Modal title="Your atlas, at your fingertips" onClose={() => setDialog(null)}><div className="atlas-command-list"><button onClick={() => { setDialog(null); searchInput.current?.focus() }}>Search library <kbd>⌘ / Ctrl K</kbd></button><button onClick={() => { setDialog(null); map.current?.fit() }}>Fit the current map <kbd>g g</kbd></button><button onClick={() => setDialog('sources')}>Add or reindex a source <span>↗</span></button><button onClick={() => setDialog('collection')}>Create a collection <span>↗</span></button><button onClick={() => { setExpanded(true); setDialog(null) }} disabled={!selected}>Expand the reader <kbd>Enter</kbd></button><button onClick={() => { setShowMetrics(v => !v); setDialog(null) }}>Toggle render metrics <kbd>Shift P</kbd></button><a href="?view=classic">Embedding lab, PCA & classic themes <span>↗</span></a></div><p className="atlas-muted">Pan: h j k l · Zoom: + / − · Next / previous file: n / N · Open / reveal: o / O · Back: Escape. Text fields always accept ordinary typing.</p></Modal>}
    <div className="atlas-sr-only" aria-live="polite">{query && search.status !== 'searching' ? `${search.results.length} results` : ''}</div>
  </div>
}

function CollectionDialog({ activeId, selectedId, hits, query, busy, onClose, onAction, onDone }: { activeId?: number; selectedId: string | null; hits: AtlasHit[]; query: string; busy: boolean; onClose: () => void; onAction: (op: () => Promise<void>) => Promise<void>; onDone: () => void }) {
  const [active, setActive] = useState<CollectionSummary | null>(null), [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { if (activeId) void getCollection(activeId).then(setActive).catch(() => {}) }, [activeId])
  return <Modal title={active ? active.name : 'Create a collection'} onClose={onClose}>{active ? <div className="atlas-form"><p>{active.memberCount} files · {active.kind === 'dynamic' ? 'Saved semantic query' : 'Hand-picked collection'}</p>{active.kind === 'dynamic' && <button disabled={busy} onClick={() => void onAction(async () => { await refreshCollection(active.id); onDone() })}>Refresh saved query</button>}{selectedId && <button disabled={busy} onClick={() => void onAction(async () => { await removeCollectionMember(active.id, selectedId); onDone() })}>Remove selected file from collection</button>}<button className="atlas-danger" onClick={() => setConfirmDelete(true)}>Delete collection…</button>{confirmDelete && <div className="atlas-notice"><p>Delete “{active.name}”? The original files will remain on disk.</p><button disabled={busy} onClick={() => void onAction(async () => { await deleteCollection(active.id); onDone() })}>Delete collection</button><button onClick={() => setConfirmDelete(false)}>Keep it</button></div>}</div> : <form className="atlas-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget), dynamic = data.get('kind') === 'dynamic'; void onAction(async () => { await createCollection({ name: String(data.get('name')), kind: dynamic ? 'dynamic' : 'static', ...(dynamic ? { query: String(data.get('query')) } : { fileIds: hits.length ? hits.map(h => h.file.id) : selectedId ? [selectedId] : [] }) }); onDone() }) }}><label>Name<input name="name" required placeholder="A useful collection" /></label><label>Type<select name="kind" defaultValue="static"><option value="static">Save {hits.length || (selectedId ? 1 : 0)} selected results</option><option value="dynamic">Saved semantic query</option></select></label><label>Query <span className="atlas-muted">for saved semantic queries</span><input name="query" defaultValue={query} placeholder="Notes about spatial memory" /></label><button className="atlas-primary-button" disabled={busy}>Create collection</button></form>}</Modal>
}

function SettingsDialog({ theme, onTheme, onClose, onNotice, onRefresh }: { theme: string; onTheme: (id: string) => void; onClose: () => void; onNotice: (text: string) => void; onRefresh: () => void }) {
  const [patterns, setPatterns] = useState(''), [snapshots, setSnapshots] = useState<AtlasSnapshot[]>([]), [pending, setPending] = useState<number | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => { void Promise.all([fetchIgnorePatterns(), atlasApi.snapshots()]).then(([p, s]) => { setPatterns(p); setSnapshots(s) }).catch(e => setError(String(e))) }, [])
  const act = async (op: () => Promise<void>) => { setBusy(true); setError(null); try { await op() } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  return <Modal title="Make yourself at home" onClose={onClose}><div className="atlas-form"><label>Atmosphere<select value={theme} onChange={e => onTheme(e.target.value)}>{THEMES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Rendering<select value={new URLSearchParams(location.search).get('renderer') === 'canvas' ? 'canvas' : 'gpu'} onChange={e => { const url = new URL(location.href); if (e.target.value === 'canvas') url.searchParams.set('renderer', 'canvas'); else url.searchParams.delete('renderer'); location.href = url.toString() }}><option value="gpu">Automatic · GPU when available</option><option value="canvas">Canvas · compatibility mode</option></select></label>
    <details><summary>Ignored files and folders</summary><p className="atlas-muted">One pattern per line. Saving removes matching entries from the index; files on disk remain intact.</p><textarea rows={6} value={patterns} onChange={e => setPatterns(e.target.value)} aria-label="Ignore patterns" /><button disabled={busy} onClick={() => void act(async () => { const result = await saveIgnorePatterns(patterns); onRefresh(); onNotice(`Ignore rules saved · ${result.removed} entries removed`) })}>Save ignore rules</button></details>
    <details><summary>Atlas snapshots</summary><p className="atlas-muted">Save positions, pins, and region names before rearranging your atlas. Restoring keeps newly indexed files and creates a backup first.</p><form onSubmit={e => { e.preventDefault(); const name = String(new FormData(e.currentTarget).get('name')); void act(async () => { await atlasApi.snapshot(name); setSnapshots(await atlasApi.snapshots()); onNotice('Atlas snapshot saved') }) }}><input name="name" placeholder="Before rearranging" required maxLength={120} /><button disabled={busy}>Save snapshot</button></form>{snapshots.map(s => <div className="atlas-snapshot" key={s.id}><span>{s.name}<small>{s.count} files · {new Date(s.createdAt).toLocaleString()}</small></span><button onClick={() => setPending(s.id)}>Restore…</button></div>)}{pending !== null && <div className="atlas-notice"><p>Restore this snapshot’s pins and region names?</p><button disabled={busy} onClick={() => void act(async () => { await atlasApi.restore(pending); setSnapshots(await atlasApi.snapshots()); setPending(null); onRefresh(); onNotice('Atlas snapshot restored') })}>Restore snapshot</button><button onClick={() => setPending(null)}>Cancel</button></div>}</details>
    <a className="atlas-advanced-link" href="?view=classic">Open advanced workspace ↗<small>Embedding experiments, PCA axes, procedural themes, and the original map</small></a>{error && <div className="atlas-notice" role="alert">{error}</div>}
  </div></Modal>
}
