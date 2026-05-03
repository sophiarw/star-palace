import { useCallback, useState } from 'react'
import type { CollectionSummary, SearchResult, CollectionKind } from '@shared/types'
import { CONSTELLATION_PALETTE } from '@shared/types'
import type { CreateCollectionInput, RefreshResult } from '../../api'
import { HttpError } from '../../api'

interface Props {
  collections: CollectionSummary[]
  activeCollectionId: number | null
  onSetActive: (id: number | null) => void
  onCreate: (input: CreateCollectionInput) => Promise<CollectionSummary>
  onRefreshDynamic: (id: number) => Promise<RefreshResult>
  onDelete: (id: number) => Promise<void>
  // Latest search results — surfaces the "Save as collection" form when populated.
  searchResults: SearchResult[]
  // Latest search query string (so dynamic-collection creation can capture it).
  searchQuery: string
  open: boolean
  onClose: () => void
}

// Brief flash of {green, red} highlight when a refresh diff lands. Drives the
// .collections-panel-flash--add / --remove classes; CSS animates them with a
// 5s fade. Held in panel state because the flash should reset across refresh
// cycles.
interface FlashState { added: Set<string>; removed: Set<string>; ts: number }
const FLASH_DURATION_MS = 5_000

export default function CollectionsPanel({
  collections, activeCollectionId, onSetActive, onCreate, onRefreshDynamic, onDelete,
  searchResults, searchQuery, open, onClose,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createKind, setCreateKind] = useState<CollectionKind>('static')
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [flash, setFlash] = useState<Map<number, FlashState>>(new Map())
  const [refreshingId, setRefreshingId] = useState<number | null>(null)

  const handleSaveAsCollection = useCallback(async () => {
    setCreateOpen(true)
    setCreateKind('static')  // search-result captures should be static snapshots
    setCreateName(searchQuery.slice(0, 60).trim() || 'Untitled')
  }, [searchQuery])

  const handleCreate = useCallback(async () => {
    const name = createName.trim()
    if (!name) {
      setCreateError('name required')
      return
    }
    setCreateBusy(true)
    setCreateError(null)
    try {
      const input: CreateCollectionInput = {
        name,
        kind: createKind,
      }
      if (createKind === 'static') {
        input.fileIds = searchResults.map(r => r.id)
      } else {
        // Dynamic: capture the current query as the saved query.
        input.query = searchQuery.trim()
        if (!input.query) {
          setCreateError('dynamic needs an active search query')
          setCreateBusy(false)
          return
        }
      }
      const created = await onCreate(input)
      onSetActive(created.id)
      setCreateOpen(false)
      setCreateName('')
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setCreateError(`name "${name}" is already taken`)
      } else {
        setCreateError(String(err))
      }
    } finally {
      setCreateBusy(false)
    }
  }, [createName, createKind, searchResults, searchQuery, onCreate, onSetActive])

  const handleRefresh = useCallback(async (id: number) => {
    setRefreshingId(id)
    try {
      const diff = await onRefreshDynamic(id)
      const next = new Map(flash)
      next.set(id, {
        added: new Set(diff.added),
        removed: new Set(diff.removed),
        ts: Date.now(),
      })
      setFlash(next)
      // Auto-clear after the CSS animation completes so subsequent refreshes
      // get a clean slate rather than overlapping fades.
      setTimeout(() => {
        setFlash(prev => {
          const cur = prev.get(id)
          if (!cur || Date.now() - cur.ts < FLASH_DURATION_MS) return prev
          const after = new Map(prev)
          after.delete(id)
          return after
        })
      }, FLASH_DURATION_MS + 50)
    } catch (err) {
      console.warn('refresh failed:', err)
    } finally {
      setRefreshingId(null)
    }
  }, [flash, onRefreshDynamic])

  if (!open) {
    return (
      <button
        className="collections-panel-collapsed"
        type="button"
        onClick={() => onClose()}  // open is owned by parent; reuse onClose handler
        title="Show collections"
      >
        Collections ({collections.length})
      </button>
    )
  }

  const hasSearch = searchResults.length > 0

  return (
    <div className="collections-panel">
      <div className="collections-panel-header">
        <span className="collections-panel-title">Collections</span>
        <button
          className="collections-panel-collapse"
          type="button"
          onClick={onClose}
          title="Hide collections panel"
        >
          —
        </button>
      </div>

      {hasSearch && !createOpen && (
        <button
          className="collections-panel-save"
          type="button"
          onClick={handleSaveAsCollection}
        >
          + Save current search as collection ({searchResults.length})
        </button>
      )}

      {createOpen && (
        <div className="collections-panel-create">
          <input
            className="collections-panel-input"
            type="text"
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            placeholder="collection name"
            spellCheck={false}
            autoComplete="off"
            disabled={createBusy}
          />
          <div className="collections-panel-create-row">
            <label className="collections-panel-radio">
              <input
                type="radio"
                checked={createKind === 'static'}
                onChange={() => setCreateKind('static')}
                disabled={createBusy}
              /> static
            </label>
            <label className="collections-panel-radio">
              <input
                type="radio"
                checked={createKind === 'dynamic'}
                onChange={() => setCreateKind('dynamic')}
                disabled={createBusy || !searchQuery.trim()}
              /> dynamic
            </label>
          </div>
          {createError && <div className="collections-panel-msg collections-panel-msg--err">{createError}</div>}
          <div className="collections-panel-create-actions">
            <button
              type="button"
              className="collections-panel-btn collections-panel-btn--primary"
              onClick={handleCreate}
              disabled={createBusy}
            >
              {createBusy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="collections-panel-btn"
              onClick={() => { setCreateOpen(false); setCreateError(null) }}
              disabled={createBusy}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {collections.length === 0 ? (
        <div className="collections-panel-empty">
          No collections yet. Run a search and click <strong>Save</strong> above
          to capture a static snapshot, or use the <code>c:foo</code> search
          syntax to filter to an existing collection.
        </div>
      ) : (
        <ul className="collections-panel-list">
          {collections.map(c => {
            const isActive = c.id === activeCollectionId
            const fl = flash.get(c.id)
            const color = CONSTELLATION_PALETTE[c.colorIndex % CONSTELLATION_PALETTE.length]
            return (
              <li key={c.id} className="collections-panel-row">
                <button
                  type="button"
                  className={`collections-panel-row-main ${isActive ? 'collections-panel-row-main--active' : ''}`}
                  onClick={() => onSetActive(isActive ? null : c.id)}
                  title={c.kind === 'dynamic' ? `Dynamic: "${c.query ?? ''}"` : 'Static collection'}
                >
                  <span className="collections-panel-chip" style={{ background: color }} />
                  <span className="collections-panel-name">
                    {c.name}
                    {c.kind === 'dynamic' && <span className="collections-panel-glyph"> ↻</span>}
                  </span>
                  <span className="collections-panel-count">{c.memberCount}</span>
                </button>
                <div className="collections-panel-row-actions">
                  {c.kind === 'dynamic' && (
                    <button
                      type="button"
                      className="collections-panel-icon-btn"
                      onClick={() => handleRefresh(c.id)}
                      disabled={refreshingId === c.id}
                      title="Re-evaluate dynamic membership"
                    >
                      {refreshingId === c.id ? '…' : '↻'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="collections-panel-icon-btn collections-panel-icon-btn--danger"
                    onClick={() => onDelete(c.id)}
                    title="Delete collection (files unaffected)"
                  >
                    ×
                  </button>
                </div>
                {fl && (fl.added.size > 0 || fl.removed.size > 0) && (
                  <div className="collections-panel-flash" key={fl.ts}>
                    {fl.added.size > 0 && (
                      <span className="collections-panel-flash--add">+{fl.added.size}</span>
                    )}
                    {fl.removed.size > 0 && (
                      <span className="collections-panel-flash--remove">−{fl.removed.size}</span>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
