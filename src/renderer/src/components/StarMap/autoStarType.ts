import type { StarType } from '@shared/types'

export function defaultStarType(name: string, mimeType: string): StarType | null {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()

  if (ext === '.pptx' || ext === '.ppt' || ext === '.key') return 'pulsar'
  if (mimeType.startsWith('application/pdf') || ext === '.pdf') return 'quasar'
  if (ext === '.csv' || ext === '.tsv') return 'white-dwarf'
  if (ext === '.json' || ext === '.yaml' || ext === '.yml') return 'neutron-star'
  if (ext === '.zip' || ext === '.tar' || ext === '.gz' || ext === '.tgz' || ext === '.bz2') return 'black-hole'
  if (mimeType.startsWith('image/')) return 'nebula'
  // Markdown, code, and unmatched all fall to main-sequence — the cluster-hue
  // "default" sprite path is deprecated. main-sequence is the sun-like vanilla
  // star drawer; renderer cluster-hue branch in StarMap.tsx remains as a
  // safety fallback but is no longer reached by the F2 classifier.
  return 'main-sequence'
}

// Human-readable label describing why a default was applied, for use in the UI.
export function defaultStarTypeReason(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return ext.length > 1 ? ext : 'file type'
}
