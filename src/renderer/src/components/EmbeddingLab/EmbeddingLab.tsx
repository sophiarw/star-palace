import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Star } from '@shared/types'
import {
  getEmbeddingStrategies,
  runEmbeddingExperiment,
  getExperimentPositions,
  promoteExperiment,
  revertExperiment,
  listSnapshots,
  prepareLabMix,
  runLabMix,
  releaseLabMix,
  type EmbeddingStrategy,
  type SnapshotSummary,
  type ExperimentPosition,
  HttpError,
} from '../../api'
import { useIndexProgress } from '../../hooks/useIndexProgress'

// B3 — minimum subdir size for an experiment. Mirrors B2's hard floor; if
// B2 ships a different number this constant is the single point to update.
const MIN_FILES_FOR_EXPERIMENT = 10

// Channels exposed as mix sliders. Order = render order in the panel.
const MIX_CHANNELS = ['dir-path', 'filename', 'top-dir', 'content-only', 'metadata-only'] as const
type MixChannel = (typeof MIX_CHANNELS)[number]

// How deeply to nest the subdir picker. Two segments past the galaxy root
// keep the tree small enough to scan visually without an explorer-style
// expander; users can refine further by re-running per leaf.
const TREE_DEPTH = 3

export interface ExperimentPreview {
  snapshotId: string
  ids: Set<string>
  positions: Map<string, [number, number]>
}

interface DirNode {
  // Full prefix path (e.g. "/Users/me/notes/work").
  path: string
  // Display label — the last segment of `path`, or the full path at depth 1.
  label: string
  count: number
  fileIds: string[]
  children: Map<string, DirNode>
}

interface Props {
  visible: boolean
  onClose: () => void
  // Snapshot of the in-app star list. The picker derives its tree from
  // these paths so it stays in sync with whatever galaxies the user has
  // visible right now.
  stars: Star[]
  // Lifted up to App-level state so StarMap can render the overlay and a
  // `Back to production` action can clear it without round-tripping
  // through this panel.
  preview: ExperimentPreview | null
  onPreview: (p: ExperimentPreview | null) => void
  // Pinged after promote / revert so App can refresh stars + snapshots.
  onMutated: () => void
}

function splitPath(p: string): string[] {
  // Renderer is platform-agnostic; the daemon stores forward slashes on
  // unix and backslashes on Windows, so split on either.
  return p.split(/[/\\]/).filter(Boolean)
}

// Build the tree once per stars-mutation. Keys are the prefix paths so
// React can use them as stable list keys.
function buildTree(stars: Star[]): DirNode {
  const root: DirNode = {
    path: '',
    label: '/',
    count: 0,
    fileIds: [],
    children: new Map(),
  }
  for (const s of stars) {
    const parts = splitPath(s.path)
    if (parts.length === 0) continue
    // Pop the file leaf — only directories form the picker.
    parts.pop()
    let node = root
    let prefix = ''
    const limit = Math.min(parts.length, TREE_DEPTH)
    for (let i = 0; i < limit; i++) {
      const seg = parts[i]
      prefix = prefix === '' ? `/${seg}` : `${prefix}/${seg}`
      let child = node.children.get(seg)
      if (!child) {
        child = {
          path: prefix,
          label: seg,
          count: 0,
          fileIds: [],
          children: new Map(),
        }
        node.children.set(seg, child)
      }
      child.count++
      child.fileIds.push(s.id)
      node = child
    }
  }
  return root
}

function flattenTree(root: DirNode): DirNode[] {
  // Depth-first walk that emits each non-root node once. Sort siblings
  // alphabetically so the picker reads stably across re-renders.
  const out: DirNode[] = []
  const walk = (node: DirNode, depth: number): void => {
    const sorted = [...node.children.values()].sort((a, b) => a.label.localeCompare(b.label))
    for (const child of sorted) {
      out.push(child)
      if (depth < TREE_DEPTH - 1) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return out
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function EmbeddingLab({ visible, onClose, stars, preview, onPreview, onMutated }: Props) {
  const [strategies, setStrategies] = useState<EmbeddingStrategy[]>([])
  const [defaultStrategy, setDefaultStrategy] = useState<string | null>(null)
  const [chosenStrategy, setChosenStrategy] = useState<string>('')
  const [scopePath, setScopePath] = useState<string>('')
  const [scopeCount, setScopeCount] = useState<number>(0)
  const [note, setNote] = useState('')
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([])
  const [loadingStrategies, setLoadingStrategies] = useState(false)
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  // Track which snapshot is being acted on so we can disable just its row's
  // buttons rather than all rows (a long promote shouldn't lock revert).
  const [busySnapshotId, setBusySnapshotId] = useState<string | null>(null)
  // B3 — active promote job. The promote endpoint kicks off a background
  // re-embed under the new strategy and returns its jobId; we subscribe
  // to the existing /api/index/progress SSE so the panel can show the
  // same progress UI used during indexing. Cleared on terminal frame.
  const [promoteJobId, setPromoteJobId] = useState<string | null>(null)
  const promoteJobFinishedRef = useRef<string | null>(null)

  // Mix workbench state. `prepId` is the daemon-side handle into the cached
  // per-channel vectors; sliders mutate `mixWeights` cheaply (local state
  // only), and the user clicks Engage to commit the current weights and pay
  // the daemon's PCA-refit cost once. `engagedWeights` records the snapshot
  // last sent to /api/embedding/lab/mix so the dirty indicator works.
  const [mixPrepId, setMixPrepId] = useState<string | null>(null)
  const [mixWeights, setMixWeights] = useState<Record<MixChannel, number>>(() => ({
    'dir-path': 1,
    'filename': 1,
    'top-dir': 1,
    'content-only': 1,
    'metadata-only': 1,
  }))
  const [engagedWeights, setEngagedWeights] = useState<Record<MixChannel, number> | null>(null)
  const [mixPreparing, setMixPreparing] = useState(false)
  const [mixing, setMixing] = useState(false)

  // True when the slider state diverges from the last engaged snapshot (or
  // nothing has been engaged yet). Drives the Engage button's disabled state
  // and dirty asterisk.
  const mixDirty = useMemo(() => {
    if (!engagedWeights) return true
    return MIX_CHANNELS.some(ch => mixWeights[ch] !== engagedWeights[ch])
  }, [mixWeights, engagedWeights])

  const tree = useMemo(() => buildTree(stars), [stars])
  const flatNodes = useMemo(() => flattenTree(tree), [tree])

  // Keep selected count in sync if the user picks then the underlying tree
  // mutates (e.g. background re-index landed).
  useEffect(() => {
    if (!scopePath) {
      setScopeCount(0)
      return
    }
    let count = 0
    for (const node of flatNodes) {
      if (node.path === scopePath) { count = node.count; break }
    }
    setScopeCount(count)
  }, [scopePath, flatNodes])

  const loadStrategies = useCallback(async () => {
    setLoadingStrategies(true)
    try {
      const res = await getEmbeddingStrategies()
      setStrategies(res.strategies)
      setDefaultStrategy(res.default)
      // If the user hasn't picked one yet, default to the daemon's default
      // so the dropdown isn't empty on first open.
      setChosenStrategy(prev => prev || res.default)
      setError(null)
    } catch (err) {
      setError(`Could not load strategies: ${String(err)}`)
    } finally {
      setLoadingStrategies(false)
    }
  }, [])

  const loadSnapshots = useCallback(async () => {
    setLoadingSnapshots(true)
    try {
      const list = await listSnapshots()
      setSnapshots(list)
    } catch (err) {
      // Soft error — empty history is the natural empty state.
      setError(`Could not load snapshots: ${String(err)}`)
    } finally {
      setLoadingSnapshots(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    loadStrategies()
    loadSnapshots()
  }, [visible, loadStrategies, loadSnapshots])

  // B3 — re-embed progress for the active promote. Hits the same endpoint
  // GalaxyPanel uses; B2 wires the promote job into the same progressStore.
  // If B2's progress feed isn't live, the snapshot stays at status=idle
  // indefinitely and we surface a spinner instead of a percentage.
  const promoteProgress = useIndexProgress(promoteJobId)

  useEffect(() => {
    if (!promoteJobId) return
    if (promoteProgress.status === 'running') return
    if (promoteJobFinishedRef.current === promoteJobId) return
    if (promoteProgress.status === 'idle') return
    promoteJobFinishedRef.current = promoteJobId
    if (promoteProgress.status === 'done') {
      setOkMsg(`Re-embed complete (${promoteProgress.indexed} files).`)
    } else if (promoteProgress.status === 'error') {
      setError(promoteProgress.errorMessage ?? 'Promote re-embed failed')
    }
    // Drop the subscription regardless of outcome and refresh the
    // snapshot list + parent stars so the new positions stream in.
    setPromoteJobId(null)
    loadSnapshots().catch(() => { /* surfaced */ })
    onMutated()
  }, [promoteJobId, promoteProgress.status, promoteProgress.indexed, promoteProgress.errorMessage, loadSnapshots, onMutated])

  const handleRun = useCallback(async () => {
    if (!scopePath || !chosenStrategy) return
    setRunning(true)
    setError(null)
    setOkMsg(null)
    try {
      const result = await runEmbeddingExperiment(scopePath, chosenStrategy, note.trim() || undefined)
      setOkMsg(`Snapshot ${result.snapshotId.slice(0, 8)} created (${result.affectedIds.length} files).`)
      setNote('')
      await loadSnapshots()
    } catch (err) {
      if (err instanceof HttpError) {
        setError(`Experiment failed: ${err.message}`)
      } else {
        setError(`Experiment failed: ${String(err)}`)
      }
    } finally {
      setRunning(false)
    }
  }, [scopePath, chosenStrategy, note, loadSnapshots])

  const handlePreview = useCallback(async (snap: SnapshotSummary) => {
    setBusySnapshotId(snap.snapshotId)
    setError(null)
    try {
      const positions: ExperimentPosition[] = await getExperimentPositions(snap.snapshotId)
      const ids = new Set<string>()
      const map = new Map<string, [number, number]>()
      for (const p of positions) {
        ids.add(p.id)
        map.set(p.id, [p.x, p.y])
      }
      onPreview({ snapshotId: snap.snapshotId, ids, positions: map })
    } catch (err) {
      setError(`Preview failed: ${String(err)}`)
    } finally {
      setBusySnapshotId(null)
    }
  }, [onPreview])

  const handlePromote = useCallback(async (snap: SnapshotSummary) => {
    if (typeof window !== 'undefined' && !window.confirm(
      'Adopt this strategy as the default? Existing files will re-embed in the background.',
    )) return
    setBusySnapshotId(snap.snapshotId)
    setError(null)
    setOkMsg(null)
    try {
      const result = await promoteExperiment(snap.snapshotId)
      setOkMsg(`Promoting ${snap.strategy}…`)
      onPreview(null)
      // Wire the SSE subscription so we can show progress + auto-clean
      // up when the daemon finishes the background re-embed.
      promoteJobFinishedRef.current = null
      setPromoteJobId(result.jobId)
      // Bump default state via a strategies refetch.
      await loadStrategies()
    } catch (err) {
      setError(`Promote failed: ${String(err)}`)
    } finally {
      setBusySnapshotId(null)
    }
  }, [onPreview, loadStrategies])

  const handleRevert = useCallback(async (snap: SnapshotSummary) => {
    if (typeof window !== 'undefined' && !window.confirm(
      'Restore previous embeddings? Their positions will revert too.',
    )) return
    setBusySnapshotId(snap.snapshotId)
    setError(null)
    setOkMsg(null)
    try {
      await revertExperiment(snap.snapshotId)
      setOkMsg('Reverted.')
      onPreview(null)
      // Refresh both lists: revert may roll the daemon's default back to
      // the prior strategy, and snapshot history reflects the change.
      await Promise.all([loadSnapshots(), loadStrategies()])
      onMutated()
    } catch (err) {
      setError(`Revert failed: ${String(err)}`)
    } finally {
      setBusySnapshotId(null)
    }
  }, [onPreview, loadSnapshots, loadStrategies, onMutated])

  // Shared engage path: POST /api/embedding/lab/mix and route the resulting
  // positions onto the shared experiment-preview overlay. Both the Engage
  // button and the auto-fire after a fresh prepare call this with explicit
  // (prepId, weights) so neither has to wait for closure deps to settle.
  const doEngage = useCallback(async (
    prepId: string,
    weights: Record<MixChannel, number>,
  ) => {
    setMixing(true)
    setError(null)
    try {
      const positions = await runLabMix(prepId, weights)
      const ids = new Set<string>()
      const map = new Map<string, [number, number]>()
      for (const p of positions) {
        ids.add(p.id)
        map.set(p.id, [p.x, p.y])
      }
      onPreview({ snapshotId: `live-mix:${prepId}`, ids, positions: map })
      setEngagedWeights({ ...weights })
    } catch (err) {
      if (err instanceof HttpError) {
        setError(`Mix failed: ${err.message}`)
      } else {
        setError(`Mix failed: ${String(err)}`)
      }
    } finally {
      setMixing(false)
    }
  }, [onPreview])

  const handleMixPrepare = useCallback(async () => {
    if (!scopePath) return
    setMixPreparing(true)
    setError(null)
    setOkMsg(null)
    setEngagedWeights(null)
    try {
      // Drop any existing workbench so we don't leak server memory.
      if (mixPrepId) {
        releaseLabMix(mixPrepId).catch(() => { /* best-effort */ })
      }
      const result = await prepareLabMix(scopePath, [...MIX_CHANNELS])
      setMixPrepId(result.prepId)
      setOkMsg(`Mix prepared (${result.count} files × ${result.channels.length} channels).`)
      // Auto-engage once with the current weights so the user sees an initial
      // baseline preview without having to click Engage. The PCA fit happens
      // inside the same wait window the user already accepted for prepare.
      void doEngage(result.prepId, mixWeights)
    } catch (err) {
      if (err instanceof HttpError) {
        setError(`Mix prepare failed: ${err.message}`)
      } else {
        setError(`Mix prepare failed: ${String(err)}`)
      }
    } finally {
      setMixPreparing(false)
    }
  }, [scopePath, mixPrepId, mixWeights, doEngage])

  const handleMixRelease = useCallback(async () => {
    if (!mixPrepId) return
    const id = mixPrepId
    setMixPrepId(null)
    setEngagedWeights(null)
    onPreview(null)
    try {
      await releaseLabMix(id)
    } catch {
      /* best-effort */
    }
  }, [mixPrepId, onPreview])

  const handleMixEngage = useCallback(() => {
    if (!mixPrepId || mixing) return
    void doEngage(mixPrepId, mixWeights)
  }, [mixPrepId, mixWeights, mixing, doEngage])

  // Free the workbench when the panel unmounts so the daemon can drop its
  // cached vectors.
  useEffect(() => {
    return () => {
      if (mixPrepId) {
        releaseLabMix(mixPrepId).catch(() => { /* best-effort */ })
      }
    }
  }, [mixPrepId])

  const previewCanvasRef = useRef<HTMLCanvasElement>(null)

  // Mini-canvas: ONLY the preview ids, scaled to fit. Re-runs whenever the
  // preview changes (or window is resized via dpr ref read). 300×200 logical
  // pixels keeps the preview cheap to repaint at native dpr.
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const wCss = 300, hCss = 160
    canvas.width = wCss * dpr
    canvas.height = hCss * dpr
    canvas.style.width = `${wCss}px`
    canvas.style.height = `${hCss}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#02060f'
    ctx.fillRect(0, 0, wCss, hCss)
    if (!preview || preview.positions.size === 0) {
      ctx.fillStyle = '#4a6a8a'
      ctx.font = '11px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('preview the experiment to see cluster shape', wCss / 2, hCss / 2)
      return
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const [, [x, y]] of preview.positions) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    if (!isFinite(minX) || maxX === minX || maxY === minY) {
      // Single point or degenerate — pad an arbitrary 1×1 box around it.
      minX -= 1; maxX += 1; minY -= 1; maxY += 1
    }
    const pad = 12
    const scaleX = (wCss - pad * 2) / (maxX - minX)
    const scaleY = (hCss - pad * 2) / (maxY - minY)
    const scale = Math.min(scaleX, scaleY)
    const offX = pad - minX * scale + (wCss - pad * 2 - (maxX - minX) * scale) / 2
    const offY = pad - minY * scale + (hCss - pad * 2 - (maxY - minY) * scale) / 2
    ctx.fillStyle = '#7fb6ff'
    for (const [, [x, y]] of preview.positions) {
      const px = x * scale + offX
      const py = y * scale + offY
      ctx.beginPath()
      ctx.arc(px, py, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#5d7299'
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.fillText(`${preview.positions.size} files`, 6, hCss - 6)
  }, [preview])

  if (!visible) return null

  const promoteInFlight = promoteJobId !== null
  const runDisabled = running || promoteInFlight
    || !scopePath || scopeCount < MIN_FILES_FOR_EXPERIMENT || !chosenStrategy
  const chosenMeta = strategies.find(s => s.id === chosenStrategy) ?? null

  return (
    <aside
      className="embedding-lab"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <header className="embedding-lab-header">
        <div className="embedding-lab-title">
          <h3>Embedding Lab</h3>
          {defaultStrategy && (
            <span className="embedding-lab-default" title="Daemon-side default strategy">
              default: {defaultStrategy}
            </span>
          )}
        </div>
        <button
          className="embedding-lab-close"
          type="button"
          onClick={onClose}
          aria-label="Close embedding lab"
        >×</button>
      </header>

      <section className="embedding-lab-section">
        <div className="embedding-lab-section-label">Subdir</div>
        {flatNodes.length === 0 ? (
          <div className="embedding-lab-empty">No indexed paths yet.</div>
        ) : (
          <ul className="embedding-lab-tree">
            {flatNodes.map(node => {
              const selected = node.path === scopePath
              const eligible = node.count >= MIN_FILES_FOR_EXPERIMENT
              return (
                <li key={node.path}>
                  <button
                    type="button"
                    className={
                      'embedding-lab-tree-row'
                      + (selected ? ' embedding-lab-tree-row--selected' : '')
                      + (eligible ? '' : ' embedding-lab-tree-row--ineligible')
                    }
                    onClick={() => setScopePath(node.path)}
                    title={node.path}
                  >
                    <span className="embedding-lab-tree-label">{node.label}</span>
                    <span className="embedding-lab-tree-count">{node.count}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {scopePath && (
          <div className="embedding-lab-scope-info">
            {scopePath} — {scopeCount} files
            {scopeCount < MIN_FILES_FOR_EXPERIMENT && (
              <span className="embedding-lab-scope-floor">
                {' '}(need ≥ {MIN_FILES_FOR_EXPERIMENT})
              </span>
            )}
          </div>
        )}
      </section>

      <section className="embedding-lab-section">
        <div className="embedding-lab-section-label">Strategy</div>
        <select
          className="embedding-lab-select"
          value={chosenStrategy}
          onChange={e => setChosenStrategy(e.target.value)}
          disabled={loadingStrategies || strategies.length === 0}
          title={chosenMeta?.description ?? ''}
        >
          {strategies.length === 0 && <option value="">{loadingStrategies ? 'loading…' : '(none)'}</option>}
          {strategies.map(s => (
            <option key={s.id} value={s.id} title={s.description}>{s.label}</option>
          ))}
        </select>
        {chosenMeta && (
          <div className="embedding-lab-strategy-desc">{chosenMeta.description}</div>
        )}
      </section>

      <section className="embedding-lab-section">
        <div className="embedding-lab-section-label">Note (optional)</div>
        <input
          className="embedding-lab-input"
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="why this experiment?"
          disabled={running}
        />
      </section>

      <button
        className="embedding-lab-run"
        type="button"
        onClick={handleRun}
        disabled={runDisabled}
      >
        {running ? 'Running…' : 'Run experiment'}
      </button>

      <section className="embedding-lab-section embedding-lab-mix">
        <div className="embedding-lab-section-label">
          Mix workbench
          {mixing && <span className="embedding-lab-loading"> · projecting…</span>}
        </div>
        <div className="embedding-lab-mix-controls">
          {!mixPrepId ? (
            <button
              type="button"
              className="embedding-lab-mix-prepare"
              onClick={handleMixPrepare}
              disabled={
                mixPreparing
                || !scopePath
                || scopeCount < MIN_FILES_FOR_EXPERIMENT
              }
              title="Pre-compute path/content/metadata embeddings on the chosen subdir"
            >
              {mixPreparing ? 'Preparing…' : 'Prepare mix'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="embedding-lab-mix-engage"
                onClick={handleMixEngage}
                disabled={!mixDirty || mixing}
                title="Apply current weights — refits the subset PCA on the daemon."
              >
                {mixing ? 'Projecting…' : (mixDirty ? 'Engage *' : 'Engaged')}
              </button>
              <button
                type="button"
                className="embedding-lab-mix-release"
                onClick={handleMixRelease}
              >
                Release
              </button>
            </>
          )}
        </div>
        {mixPrepId && (
          <div className="embedding-lab-mix-sliders">
            {MIX_CHANNELS.map(ch => (
              <label key={ch} className="embedding-lab-mix-row">
                <span className="embedding-lab-mix-channel">{ch}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={mixWeights[ch]}
                  onChange={e => {
                    const v = Number(e.target.value)
                    setMixWeights(prev => ({ ...prev, [ch]: v }))
                  }}
                />
                <span className="embedding-lab-mix-value">
                  {mixWeights[ch].toFixed(2)}
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      {preview && (
        <div className="embedding-lab-preview">
          <div className="embedding-lab-preview-header">
            <span>Preview: snapshot {preview.snapshotId.slice(0, 8)}</span>
            <button
              type="button"
              className="embedding-lab-preview-clear"
              onClick={() => onPreview(null)}
            >
              Back to production
            </button>
          </div>
          <canvas ref={previewCanvasRef} className="embedding-lab-preview-canvas" />
        </div>
      )}

      {promoteJobId && (
        <div className="embedding-lab-promote-progress">
          {/* `total` is null until B2's terminal frame fills it (matches
              GalaxyPanel's behaviour); show indeterminate stripes until
              percent flips numeric. If the SSE never connects (B2 not
              live), the bar stays indeterminate and the count stays at
              0 — still readable as "promote in flight". */}
          <div className="embedding-lab-promote-label">
            Re-embedding in background
            {promoteProgress.indexed > 0 && ` — ${promoteProgress.indexed} files`}
          </div>
          <div
            className={
              promoteProgress.percent !== null
                ? 'embedding-lab-promote-bar'
                : 'embedding-lab-promote-bar embedding-lab-promote-bar--indeterminate'
            }
          >
            <div
              className="embedding-lab-promote-fill"
              style={promoteProgress.percent !== null
                ? { width: `${Math.round(promoteProgress.percent * 100)}%` }
                : undefined}
            />
          </div>
        </div>
      )}

      {error && <div className="embedding-lab-msg embedding-lab-msg--err">{error}</div>}
      {okMsg && <div className="embedding-lab-msg embedding-lab-msg--ok">{okMsg}</div>}

      <section className="embedding-lab-section">
        <div className="embedding-lab-section-label">
          History {snapshots.length > 0 && <span>({snapshots.length})</span>}
          {loadingSnapshots && <span className="embedding-lab-loading"> · loading…</span>}
        </div>
        {snapshots.length === 0 && !loadingSnapshots && (
          <div className="embedding-lab-empty">No snapshots yet.</div>
        )}
        {snapshots.length > 0 && (
          <ul className="embedding-lab-history">
            {snapshots.map(snap => {
              const isPreviewed = preview?.snapshotId === snap.snapshotId
              const rowBusy = busySnapshotId === snap.snapshotId
              return (
                <li
                  key={snap.snapshotId}
                  className={
                    'embedding-lab-history-row'
                    + (isPreviewed ? ' embedding-lab-history-row--active' : '')
                  }
                >
                  <div className="embedding-lab-history-meta">
                    <span className="embedding-lab-history-strategy">{snap.strategy}</span>
                    <span className="embedding-lab-history-time">{formatTimestamp(snap.createdAt)}</span>
                  </div>
                  <div className="embedding-lab-history-scope" title={snap.scopePath}>{snap.scopePath}</div>
                  {snap.note && (
                    <div className="embedding-lab-history-note">{snap.note}</div>
                  )}
                  <div className="embedding-lab-history-actions">
                    <button
                      type="button"
                      onClick={() => handlePreview(snap)}
                      disabled={rowBusy}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePromote(snap)}
                      disabled={rowBusy}
                    >
                      Promote
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevert(snap)}
                      disabled={rowBusy}
                    >
                      Revert
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <div className="embedding-lab-hint">Shift+E to toggle</div>
    </aside>
  )
}
