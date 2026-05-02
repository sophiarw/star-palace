import type { FileCategory } from '../../../shared/types'

const EXT_TO_CATEGORY: Record<string, FileCategory> = {
  // documents
  pdf: 'document', doc: 'document', docx: 'document', txt: 'document',
  md: 'document', rtf: 'document', odt: 'document',
  // data
  csv: 'data', tsv: 'data', json: 'data', xml: 'data', yaml: 'data', yml: 'data',
  xlsx: 'data', xls: 'data', parquet: 'data', h5: 'data', hdf5: 'data', sql: 'data',
  // code
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', go: 'code',
  rs: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', hpp: 'code',
  rb: 'code', php: 'code', swift: 'code', kt: 'code', sh: 'code',
  html: 'code', css: 'code', scss: 'code', less: 'code', vue: 'code', svelte: 'code',
  // media
  png: 'media', jpg: 'media', jpeg: 'media', gif: 'media', svg: 'media',
  mp3: 'media', mp4: 'media', wav: 'media', mov: 'media', avi: 'media',
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', xml: 'application/xml',
  md: 'text/markdown', txt: 'text/plain',
  ts: 'text/typescript', tsx: 'text/typescript-jsx',
  js: 'text/javascript', jsx: 'text/javascript-jsx',
  py: 'text/x-python', go: 'text/x-go', rs: 'text/x-rust',
  html: 'text/html', css: 'text/css',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
}

export function categoryFromPath(path: string): FileCategory {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_CATEGORY[ext] ?? 'unknown'
}

export function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}
