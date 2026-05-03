import { useCallback, useState } from 'react'
import type { GalaxySummary } from '@shared/types'
import { indexPath } from '../../api'

interface Props {
  galaxies: GalaxySummary[]
  onIndexed: () => void
  onFlyTo: (originX: number, originY: number) => void
}

const FLY_TO_ZOOM = 0.3

export default function GalaxyPanel({ galaxies, onIndexed, onFlyTo }: Props) {
  const [path, setPath] = useState('')
  const [galaxyName, setGalaxyName] = useState('')
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const handleIndex = useCallback(async () => {
    const p = path.trim()
    if (!p) return
    setBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      const result = await indexPath(p, galaxyName.trim() || undefined)
      setOkMsg(`Indexed ${result.indexed} files into ${result.galaxyName}`)
      setPath('')
      setGalaxyName('')
      onIndexed()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }, [path, galaxyName, onIndexed])

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
        <button
          className="galaxy-panel-index-btn"
          type="button"
          onClick={handleIndex}
          disabled={busy || !path.trim()}
        >
          {busy ? 'Indexing…' : 'Index'}
        </button>
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
