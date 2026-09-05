import type { StarType } from './types'

/** File-type identity is shared by the classic map, atlas, and summaries. */
export function defaultStarType(name: string, mimeType: string): StarType {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  if (['.pptx', '.ppt', '.key'].includes(ext)) return 'pulsar'
  if (mimeType.startsWith('application/pdf') || ext === '.pdf') return 'quasar'
  if (['.csv', '.tsv'].includes(ext)) return 'white-dwarf'
  if (['.json', '.yaml', '.yml'].includes(ext)) return 'neutron-star'
  if (['.zip', '.tar', '.gz', '.tgz', '.bz2'].includes(ext)) return 'black-hole'
  if (mimeType.startsWith('image/')) return 'nebula'
  return 'main-sequence'
}
export function celestialType(file: { name: string; mimeType: string; starType: StarType | null }): StarType {
  return file.starType ?? defaultStarType(file.name, file.mimeType)
}
export const CELESTIAL_LABELS: Record<StarType, string> = {
  'main-sequence': 'Sun-like star', 'red-giant': 'Red giant', 'blue-supergiant': 'Blue supergiant',
  'white-dwarf': 'White dwarf', 'neutron-star': 'Neutron star', pulsar: 'Pulsar', binary: 'Binary stars', quasar: 'Quasar', 'black-hole': 'Black hole', nebula: 'Nebula',
}
export const CELESTIAL_REASONS: Record<StarType, string> = {
  'main-sequence': 'Notes, documents & code', 'red-giant': 'Manual classification · also available in usage mode', 'blue-supergiant': 'Manual classification · also available in usage mode',
  'white-dwarf': 'Spreadsheets · CSV & TSV', 'neutron-star': 'Structured data · JSON & YAML', pulsar: 'Presentations', binary: 'Manual classification', quasar: 'PDF documents', 'black-hole': 'Archives & compressed files', nebula: 'Images',
}
