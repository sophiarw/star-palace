import type { FavoriteAppearance, FileCategory, Star, StarType } from './types'

export interface AtlasRegion {
  id: string
  parentId: string | null
  galaxyId: number | null
  label: string
  kind: 'region' | 'neighborhood'
  x: number
  y: number
  radius: number
  count: number
  color: string
  objectTypes?: Partial<Record<StarType, number>>
}

export interface AtlasFile extends Star {
  isFavorite: boolean
  favoriteAppearance: FavoriteAppearance
  regionId: string
  neighborhoodId: string
  tags: string[]
  hasEmbedding: boolean
  extractionStatus: string
  /** Full-folder graph neighbors, supplied by viewport hydration. */
  folderLinks?: AtlasFolderLink[]
}

export interface AtlasFolderLink { id: string; x: number; y: number }

export interface AtlasScope {
  galaxyIds?: number[]
  regionId?: string
  neighborhoodId?: string
  collectionId?: number
  category?: FileCategory
  tag?: string
}

export type AtlasLens = 'visible' | 'recent' | 'size' | 'connections'

export interface AtlasMarker {
  modifiedAt?: number
  regionId: string
  neighborhoodId: string
  id: string
  x: number
  y: number
  type: Star['starType']
  size: number
  isFavorite: boolean
  favoriteAppearance: FavoriteAppearance
}

export interface AtlasNebula {
  id: string
  members: { id: string; x: number; y: number }[]
  kind: 'duplicates' | 'related'
  color: string
}

export interface AtlasSummary {
  nebulaEpoch?: number
  nebulae?: AtlasNebula[]
  layoutEpoch?: number
  markers?: AtlasMarker[]
  revision: number
  total: number
  positioned: number
  searchable: number
  pending: number
  regions: AtlasRegion[]
}

export interface AtlasPage {
  revision: number
  total: number
  files: AtlasFile[]
}

export interface AtlasHit {
  file: AtlasFile
  score: number
  reason: 'name' | 'path' | 'content' | 'tags' | 'related'
  snippet: string
  offset: number
}

export interface AtlasSearchResponse {
  results: AtlasHit[]
  semanticAvailable: boolean
  elapsedMs: number
}

export interface AtlasSnapshot {
  id: number
  name: string
  createdAt: number
  count: number
}

export const ATLAS_COLORS = ['#a9cbc5', '#e1c391', '#b8a9d0', '#96b8d5', '#b6c39b', '#d0a8a2']
