import type { MapStats } from '@shared/types'

interface Props {
  stats: MapStats | null
  starCount: number
}

export default function StatsBar({ stats, starCount }: Props) {
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
    </div>
  )
}
