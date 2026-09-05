import type { AtlasScope } from '@shared/atlas'

/** Geographic navigation changes visibility, never persistent positions. */
export function geographicMatch(file: { regionId: string; neighborhoodId: string }, scope: AtlasScope): boolean {
  return (!scope.regionId || file.regionId === scope.regionId) && (!scope.neighborhoodId || file.neighborhoodId === scope.neighborhoodId)
}
