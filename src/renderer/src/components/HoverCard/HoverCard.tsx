import type { Star } from '@shared/types'
import { CONSTELLATION_PALETTE } from '@shared/types'

interface Props {
  star: Star
  position: { x: number; y: number }
  clusterSize: number | null
  clusterColorIndex: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function HoverCard({ star, position, clusterSize, clusterColorIndex }: Props) {
  const clusterColor = clusterColorIndex !== null ? CONSTELLATION_PALETTE[clusterColorIndex % CONSTELLATION_PALETTE.length] : null

  let left = position.x + 16
  let top = position.y - 8
  if (left + 280 > window.innerWidth - 20) left = position.x - 296
  if (top + 160 > window.innerHeight - 20) top = window.innerHeight - 180

  return (
    <div className="hover-card" style={{ left, top }}>
      <div className="hover-card-header">
        <div className="hover-card-name">
          {star.isPinned && (
            <span
              className="hover-card-pin-badge"
              title="Pinned (F4)"
              aria-label="pinned"
              style={{ marginRight: 6 }}
            >
              {'\u{1F512}'}
            </span>
          )}
          {star.name}
        </div>
        <span className="hover-card-hint">click to open</span>
      </div>
      <div className="hover-card-path">{star.path}</div>
      <div className="hover-card-meta">
        <span>{star.category}</span>
        <span>{formatBytes(star.size)}</span>
        <span>Modified {formatDate(star.modifiedAt)}</span>
        {clusterSize !== null && clusterColor && (
          <span className="hover-card-constellation" style={{ color: clusterColor }}>
            ★ {clusterSize} stars
          </span>
        )}
        {star.isStale && <span className="hover-card-stale">stale</span>}
      </div>
    </div>
  )
}
