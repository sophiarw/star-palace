import type { AtlasRegion } from '@shared/atlas'

/** One stable heading per leaf cluster; don't swap parent/child names on zoom. */
export function clusterLabelRegions(regions: AtlasRegion[]): AtlasRegion[] {
  const parents = new Set(regions.map(region => region.parentId).filter(Boolean))
  return regions.filter(region => !parents.has(region.id))
}

/** Screen-space type stays small at overview and grows gently to 14px. */
export function regionLabelSize(zoom: number): number {
  return 10 + 4 * Math.max(0, zoom) / (Math.max(0, zoom) + .3)
}
