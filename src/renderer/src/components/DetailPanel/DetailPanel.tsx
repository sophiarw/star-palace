import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Star, FileContent, StarType } from '@shared/types'
import { CONSTELLATION_PALETTE, STAR_TYPES } from '@shared/types'
import {
  fetchContent, openFile, revealFile, rawUrl, fetchNeighborhood,
  setStarType as apiSetStarType,
  getTags, setTags as apiSetTags, reindexFile,
} from '../../api'
import { defaultStarType, defaultStarTypeReason } from '../StarMap/autoStarType'
import type { Theme } from '../../themes/types'

const ASTRONOMY_LABELS: Record<StarType, string> = {
  'red-giant': 'Red giant',
  'blue-supergiant': 'Blue supergiant',
  'white-dwarf': 'White dwarf',
  'main-sequence': 'Main sequence',
  'neutron-star': 'Neutron star',
  'pulsar': 'Pulsar',
  'binary': 'Binary',
  'quasar': 'Quasar',
  'black-hole': 'Black hole',
  'nebula': 'Nebula',
}

function labelForType(theme: Theme | undefined, type: StarType): string {
  return theme?.labels?.[type] ?? ASTRONOMY_LABELS[type]
}

interface NeighborSummary {
  id: string
  name: string
  weight: number
}

interface Props {
  star: Star
  clusterColorIndex: number | null
  clusterMemberCount: number | null
  /** Active theme — supplies per-theme star_type label overrides. */
  theme?: Theme
  onClose: () => void
  onSelectNeighbor: (id: string) => void
  onStarTypeChange: (id: string, type: StarType | null) => void
  typeDropdownOpen?: boolean
  onTypeDropdownChange?: (open: boolean) => void
  // F4 — fired when the user clicks "Unpin"; parent triggers a projection
  // refetch so the star slides back to its natural position.
  onUnpin?: (id: string) => void
  // F5 — when an active collection is set and the current star is a member,
  // surface a "Remove from collection" action. All three props travel
  // together: name labels the action, isMember decides visibility, the
  // callback runs the mutation through useCollections.
  activeCollectionName?: string | null
  isMemberOfActive?: boolean
  onRemoveFromCollection?: (id: string) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function isMarkdown(name: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(name)
}

function isImage(mimeType: string): boolean {
  return /^image\//.test(mimeType)
}

export default function DetailPanel({
  star,
  clusterColorIndex,
  clusterMemberCount,
  theme,
  onClose,
  onSelectNeighbor,
  onStarTypeChange,
  typeDropdownOpen,
  onTypeDropdownChange,
  onUnpin,
  activeCollectionName,
  isMemberOfActive,
  onRemoveFromCollection,
}: Props) {
  const [content, setContent] = useState<FileContent | null>(null)
  const [contentError, setContentError] = useState<string | null>(null)
  const [neighbors, setNeighbors] = useState<NeighborSummary[]>([])
  const [typeOpenInternal, setTypeOpenInternal] = useState(false)
  const [typeSaving, setTypeSaving] = useState(false)
  // F14 — separate in-flight flags so the Open and Reveal buttons disable
  // independently while their daemon roundtrips are pending.
  const [openInFlight, setOpenInFlight] = useState(false)
  const [revealInFlight, setRevealInFlight] = useState(false)

  // B3 — tag editor state. Tags are lazy-fetched per selection (cheap GET
  // separate from /api/file/:id so a selection click doesn't pay for it
  // when the user never opens the editor). `tagsError` surfaces a 404 when
  // B2's endpoint isn't live yet — the panel still renders the input.
  const [tags, setTagsState] = useState<string[] | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [tagsSaving, setTagsSaving] = useState(false)
  const [tagsError, setTagsError] = useState<string | null>(null)

  // Allow external control of the type dropdown (for vim 't' binding)
  const typeOpen = typeDropdownOpen !== undefined ? typeDropdownOpen : typeOpenInternal
  const setTypeOpen = (open: boolean) => {
    setTypeOpenInternal(open)
    onTypeDropdownChange?.(open)
  }

  useEffect(() => {
    setContent(null)
    setContentError(null)
    setNeighbors([])
    setTagsState(null)
    setTagInput('')
    setTagsError(null)

    let cancelled = false

    fetchContent(star.id)
      .then(c => { if (!cancelled) setContent(c) })
      .catch(err => { if (!cancelled) setContentError(String(err)) })

    fetchNeighborhood(star.id)
      .then(hood => {
        if (cancelled) return
        const summary = hood.neighbors.slice(0, 10).map(n => ({
          id: n.file.id,
          name: n.file.name,
          weight: n.weight,
        }))
        setNeighbors(summary)
      })
      .catch(() => { /* neighborhood is optional */ })

    // B3 — tags. If the daemon endpoint isn't shipped yet we still render
    // the editor but seed it from the empty list and surface a soft error
    // beneath the input.
    getTags(star.id)
      .then(t => { if (!cancelled) setTagsState(t) })
      .catch((err: unknown) => {
        if (cancelled) return
        setTagsState([])
        setTagsError(`Tags endpoint unavailable: ${String(err)}`)
      })

    return () => { cancelled = true }
  }, [star.id])

  const clusterColor = clusterColorIndex !== null
    ? CONSTELLATION_PALETTE[clusterColorIndex % CONSTELLATION_PALETTE.length]
    : null

  return (
    <aside className="detail-panel" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <header className="detail-panel-header">
        <div className="detail-panel-title">
          <h3 className="detail-panel-name">{star.name}</h3>
          {clusterColor && clusterMemberCount !== null && (
            <span className="detail-panel-cluster-chip" style={{ color: clusterColor, borderColor: clusterColor }}>
              ★ {clusterMemberCount}
            </span>
          )}
        </div>
        <button className="detail-panel-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="detail-panel-path" title={star.path}>{star.path}</div>

      <div className="detail-panel-meta">
        <span>{star.category}</span>
        <span>{formatBytes(star.size)}</span>
        <span>Modified {formatDate(star.modifiedAt)}</span>
        <span>{star.viewCount} views</span>
        {star.isStale && <span className="detail-panel-stale">stale</span>}
      </div>

      <div className="detail-panel-actions">
        <button
          disabled={openInFlight}
          onClick={() => {
            setOpenInFlight(true)
            openFile(star.id)
              .catch((err) => console.warn('openFile failed:', err))
              .finally(() => setOpenInFlight(false))
          }}
        >
          Open in default app ↗
        </button>
        <button
          disabled={revealInFlight}
          onClick={() => {
            setRevealInFlight(true)
            revealFile(star.id)
              .catch((err) => console.warn('revealFile failed:', err))
              .finally(() => setRevealInFlight(false))
          }}
        >
          Reveal in Finder ↗
        </button>
      </div>

      <div className="detail-panel-startype">
        <span className="detail-panel-startype-label">Star type</span>
        <button
          className="detail-panel-startype-chip"
          disabled={typeSaving}
          onClick={() => setTypeOpen(!typeOpen)}
        >
          {star.starType
            ? labelForType(theme, star.starType)
            : (() => {
                const auto = defaultStarType(star.name, star.mimeType)
                return auto
                  ? `Default → ${labelForType(theme, auto)} (from ${defaultStarTypeReason(star.name)})`
                  : 'Default (cluster hue)'
              })()}
          <span className="detail-panel-startype-caret">▾</span>
        </button>
        {typeOpen && (
          <ul className="detail-panel-startype-menu">
            <li>
              <button
                onClick={async () => {
                  setTypeOpen(false)
                  setTypeSaving(true)
                  try {
                    await apiSetStarType(star.id, null)
                    onStarTypeChange(star.id, null)
                  } catch (err) {
                    console.error(err)
                  } finally {
                    setTypeSaving(false)
                  }
                }}
                aria-current={star.starType === null}
              >
                {(() => {
                  const auto = defaultStarType(star.name, star.mimeType)
                  return auto
                    ? `Default → ${labelForType(theme, auto)} (from ${defaultStarTypeReason(star.name)})`
                    : 'Default (cluster hue)'
                })()}
              </button>
            </li>
            {STAR_TYPES.map(t => (
              <li key={t}>
                <button
                  onClick={async () => {
                    setTypeOpen(false)
                    setTypeSaving(true)
                    try {
                      await apiSetStarType(star.id, t)
                      onStarTypeChange(star.id, t)
                    } catch (err) {
                      console.error(err)
                    } finally {
                      setTypeSaving(false)
                    }
                  }}
                  aria-current={star.starType === t}
                >
                  {labelForType(theme, t)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-panel-tags">
        <span className="detail-panel-tags-label">Tags</span>
        <div className="detail-panel-tags-chips">
          {(tags ?? []).length === 0 && (
            <span className="detail-panel-tags-empty">no tags</span>
          )}
          {(tags ?? []).map(t => (
            <span key={t} className="detail-panel-tags-chip">
              {t}
              <button
                type="button"
                className="detail-panel-tags-chip-remove"
                aria-label={`Remove tag ${t}`}
                disabled={tagsSaving}
                onClick={async () => {
                  if (!tags) return
                  const next = tags.filter(x => x !== t)
                  setTagsSaving(true)
                  setTagsError(null)
                  try {
                    await apiSetTags(star.id, next)
                    setTagsState(next)
                    // Re-embed so the next strategy run picks up the change.
                    reindexFile(star.id).catch(() => { /* best-effort */ })
                  } catch (err) {
                    setTagsError(`Save failed: ${String(err)}`)
                  } finally {
                    setTagsSaving(false)
                  }
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          className="detail-panel-tags-input"
          type="text"
          placeholder="press enter to add a tag"
          value={tagInput}
          disabled={tagsSaving || tags === null}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={async e => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const trimmed = tagInput.trim()
            if (!trimmed) return
            const existing = tags ?? []
            if (existing.includes(trimmed)) {
              // Dedupe silently — clear the input so the user knows it landed
              // even if the chip was already there.
              setTagInput('')
              return
            }
            const next = [...existing, trimmed]
            setTagsSaving(true)
            setTagsError(null)
            try {
              await apiSetTags(star.id, next)
              setTagsState(next)
              setTagInput('')
              // Trigger a re-embed so the new tag flows into the next vector.
              reindexFile(star.id).catch(() => { /* best-effort */ })
            } catch (err) {
              setTagsError(`Save failed: ${String(err)}`)
            } finally {
              setTagsSaving(false)
            }
          }}
        />
        {tagsError && <span className="detail-panel-tags-error">{tagsError}</span>}
      </div>

      <div className="detail-panel-pin">
        {star.isPinned && star.pinAxisA !== null && star.pinAxisB !== null ? (
          <>
            <span className="detail-panel-pin-status">
              {`\u{1F512} Pinned at PC${star.pinAxisA + 1} × PC${star.pinAxisB + 1}`}
            </span>
            <button
              className="detail-panel-pin-unpin"
              onClick={() => onUnpin?.(star.id)}
            >
              Unpin
            </button>
          </>
        ) : (
          <span className="detail-panel-pin-hint">Shift-drag to pin this star</span>
        )}
      </div>

      {activeCollectionName && isMemberOfActive && onRemoveFromCollection && (
        <div className="detail-panel-collection-action">
          <button onClick={() => onRemoveFromCollection(star.id)}>
            Remove from “{activeCollectionName}”
          </button>
        </div>
      )}

      <section className="detail-panel-content">
        <ContentViewer star={star} content={content} error={contentError} />
      </section>

      {neighbors.length > 0 && (
        <section className="detail-panel-neighbors">
          <h4>Nearby stars</h4>
          <ul>
            {neighbors.map(n => (
              <li key={n.id}>
                <button onClick={() => onSelectNeighbor(n.id)}>
                  <span className="detail-panel-neighbor-name">{n.name}</span>
                  <span className="detail-panel-neighbor-weight">{(n.weight * 100).toFixed(0)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}

interface ContentViewerProps {
  star: Star
  content: FileContent | null
  error: string | null
}

function ContentViewer({ star, content, error }: ContentViewerProps) {
  if (error) return <div className="detail-panel-empty">Could not load content: {error}</div>
  if (isImage(star.mimeType)) {
    return <img className="detail-panel-image" src={rawUrl(star.id)} alt={star.name} />
  }
  if (content === null) return <div className="detail-panel-empty">Loading…</div>
  if (content.content === null) {
    return <div className="detail-panel-empty">Binary file ({formatBytes(content.size)}). Use “Open in default app”.</div>
  }
  if (content.content === '') {
    return <div className="detail-panel-empty">Empty file.</div>
  }

  const body = isMarkdown(star.name)
    ? <div className="detail-panel-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content.content}</ReactMarkdown></div>
    : <pre className="detail-panel-pre">{content.content}</pre>

  return (
    <>
      {body}
      {content.truncated && (
        <div className="detail-panel-truncation">
          Truncated at {formatBytes(content.content.length)} of {formatBytes(content.size)}.
        </div>
      )}
    </>
  )
}
