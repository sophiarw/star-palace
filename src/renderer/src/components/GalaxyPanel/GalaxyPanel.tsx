import { useCallback, useEffect, useRef, useState } from 'react'
import type { GalaxySummary } from '@shared/types'
import { startIndex, cancelIndex } from '../../api'
import { useIndexProgress } from '../../hooks/useIndexProgress'

interface Props {
  galaxies: GalaxySummary[]
  onIndexed: () => void
  onFlyTo: (originX: number, originY: number) => void
}

const FLY_TO_ZOOM = 0.3

// F17 — pull the path's basename for the "current/path/here.md" tail. Plain
// suffix slicing keeps the implementation OS-agnostic (the daemon ships
// platform-correct separators in `currentPath`).
function shortenPath(p: string | null, maxLen = 48): string {
  if (!p) return ''
  if (p.length <= maxLen) return p
  return '…' + p.slice(p.length - maxLen + 1)
}

export default function GalaxyPanel({ galaxies, onIndexed, onFlyTo }: Props) {
  const [path, setPath] = useState('')
  const [galaxyName, setGalaxyName] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  // F17 — only the most recent jobId drives the SSE subscription. Concurrent
  // index requests just overwrite this; the prior subscription is torn down by
  // the hook's effect cleanup.
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeJobName, setActiveJobName] = useState<string | null>(null)

  const progress = useIndexProgress(activeJobId)
  // Tracks whether the parent already saw the most recent finish so we only
  // call onIndexed once per job. Avoids a re-fire each time the snapshot
  // re-renders after the terminal frame.
  const finishedJobRef = useRef<string | null>(null)

  const busy = progress.status === 'running'

  useEffect(() => {
    if (!activeJobId) return
    if (progress.status === 'running') return
    if (finishedJobRef.current === activeJobId) return
    finishedJobRef.current = activeJobId

    if (progress.status === 'done') {
      setOkMsg(`Indexed ${progress.indexed} files into ${activeJobName ?? 'galaxy'}`)
      setError(null)
      setPath('')
      setGalaxyName('')
      onIndexed()
    } else if (progress.status === 'cancelled') {
      setOkMsg(`Cancelled after ${progress.indexed} files`)
      setError(null)
      // Still refresh so the user sees the partial galaxy.
      onIndexed()
    } else if (progress.status === 'error') {
      setError(progress.errorMessage ?? 'indexing failed')
      setOkMsg(null)
    }
  }, [activeJobId, activeJobName, progress.status, progress.indexed, progress.errorMessage, onIndexed])

  const handleIndex = useCallback(async () => {
    const p = path.trim()
    if (!p) return
    setError(null)
    setOkMsg(null)
    try {
      const handle = await startIndex(p, galaxyName.trim() || undefined)
      finishedJobRef.current = null
      setActiveJobName(handle.galaxyName)
      setActiveJobId(handle.jobId)
    } catch (err) {
      setError(String(err))
    }
  }, [path, galaxyName])

  const handleCancel = useCallback(async () => {
    if (!activeJobId) return
    try {
      await cancelIndex(activeJobId)
    } catch (err) {
      setError(String(err))
    }
  }, [activeJobId])

  if (collapsed) {
    return (
      <button
        className="galaxy-panel-collapsed"
        type="button"
        onClick={() => setCollapsed(false)}
        title="Show galaxies"
      >
        Galaxies ({galaxies.length})
      </button>
    )
  }

  // F17 — render the indeterminate stripe variant until `total` is known
  // (which, for v1, only happens at the terminal frame). The numeric percent
  // path is wired now so a future walker pre-count rolls out cleanly.
  const percentLabel = progress.percent !== null
    ? ` (${Math.round(progress.percent * 100)}%)`
    : ''
  const totalLabel = progress.total !== null ? `${progress.total}` : '?'
  const fillStyle = progress.percent !== null
    ? { width: `${Math.round(progress.percent * 100)}%` }
    : undefined

  return (
    <div className="galaxy-panel">
      <div className="galaxy-panel-header">
        <span className="galaxy-panel-title">Galaxies</span>
        <button
          className="galaxy-panel-collapse"
          type="button"
          onClick={() => setCollapsed(true)}
          title="Hide galaxy panel"
        >
          —
        </button>
      </div>

      <div className="galaxy-panel-form">
        <input
          id="galaxy-panel-path-input"
          className="galaxy-panel-input"
          type="text"
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="/path/to/index"
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        <input
          className="galaxy-panel-input galaxy-panel-input--name"
          type="text"
          value={galaxyName}
          onChange={e => setGalaxyName(e.target.value)}
          placeholder="galaxy name (optional)"
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
        />
        {busy ? (
          <div className="galaxy-panel-progress">
            <div
              className={
                progress.percent !== null
                  ? 'galaxy-panel-progress-bar'
                  : 'galaxy-panel-progress-bar galaxy-panel-progress-bar--indeterminate'
              }
            >
              <div className="galaxy-panel-progress-fill" style={fillStyle} />
            </div>
            <div className="galaxy-panel-progress-text">
              <span className="galaxy-panel-progress-counts">
                {progress.scanned} / {totalLabel}{percentLabel}
              </span>
              {progress.currentPath && (
                <span className="galaxy-panel-progress-path" title={progress.currentPath}>
                  {shortenPath(progress.currentPath)}
                </span>
              )}
            </div>
            {progress.stalled && (
              <div className="galaxy-panel-progress-hint galaxy-panel-progress-hint--stall">
                stalled? Ollama may be slow on this file.
              </div>
            )}
            {progress.errors > 0 && (
              <div className="galaxy-panel-progress-hint galaxy-panel-progress-hint--err">
                {progress.errors} error{progress.errors === 1 ? '' : 's'}
                {progress.indexed === 0 && ' — check `ollama serve`'}
              </div>
            )}
            <button
              className="galaxy-panel-progress-cancel"
              type="button"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="galaxy-panel-index-btn"
            type="button"
            onClick={handleIndex}
            disabled={!path.trim()}
          >
            Index
          </button>
        )}
      </div>
      {error && <div className="galaxy-panel-msg galaxy-panel-msg--err">{error}</div>}
      {okMsg && <div className="galaxy-panel-msg galaxy-panel-msg--ok">{okMsg}</div>}

      {galaxies.length > 0 && (
        <ul className="galaxy-panel-list">
          {galaxies.map(g => (
            <li key={g.id} className="galaxy-panel-row">
              <button
                type="button"
                className="galaxy-panel-fly"
                onClick={() => onFlyTo(g.originX, g.originY)}
                title={`Fly to (${g.originX.toFixed(0)}, ${g.originY.toFixed(0)}) at zoom ${FLY_TO_ZOOM}`}
              >
                <span className="galaxy-panel-name">{g.name}</span>
                <span className="galaxy-panel-count">{g.memberCount}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
