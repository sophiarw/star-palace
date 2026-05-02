import type { MapStats } from '@shared/types'
import type { VimMode } from '../../hooks/useVimMode'

interface Props {
  stats: MapStats | null
  starCount: number
  vimMode?: VimMode
}

const VIM_MODE_LABELS: Record<VimMode, string> = {
  normal: '-- NORMAL --',
  search: '-- SEARCH --',
}

export default function StatsBar({ stats, starCount, vimMode }: Props) {
  if (!stats) return null
  return (
    <div className="stats-bar">
      <span>{stats.total.toLocaleString()} stars</span>
      <span>{stats.clusterCount} constellations</span>
      {stats.layoutVersion > 0
        ? <span>layout v{stats.layoutVersion}</span>
        : <span>indexing... ({stats.indexedWithEmbedding}/200)</span>
      }
      {starCount > 0 && <span>{starCount} in view</span>}
      {vimMode && (
        <span className={`stats-bar-mode stats-bar-mode--${vimMode}`}>
          {VIM_MODE_LABELS[vimMode]}
        </span>
      )}
    </div>
  )
}
