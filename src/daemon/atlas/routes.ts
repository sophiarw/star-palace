import { openInTerminalEditor, TerminalEditorError } from '../util/openInTerminalEditor'
import { Router } from 'express'
import type { AtlasFile, AtlasScope } from '../../shared/atlas'
import type { FileCategory } from '../../shared/types'
import type { AtlasService } from './service'
import type { EditorSection } from '../../shared/section'
import { localRequest } from '../util/localRequest'

function bounded(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new Error('Expected an integer')
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`Expected an integer between 0 and ${max}`)
  return n
}
export function parseScope(raw: Record<string, unknown>): AtlasScope {
  const scope: AtlasScope = {}
  if (raw.galaxyIds !== undefined) {
    const ids = Array.isArray(raw.galaxyIds) ? raw.galaxyIds : String(raw.galaxyIds).split(',').filter(Boolean)
    if (ids.length > 1000) throw new Error('Too many sources')
    scope.galaxyIds = ids.map(id => bounded(id, 0, 2 ** 31 - 1))
  }
  for (const key of ['regionId', 'neighborhoodId', 'tag'] as const) if (raw[key] !== undefined) {
    if (typeof raw[key] !== 'string' || raw[key].length > 200) throw new Error(`Invalid ${key}`)
    scope[key] = raw[key]
  }
  if (raw.collectionId !== undefined) scope.collectionId = bounded(raw.collectionId, 0, 2 ** 31 - 1)
  if (raw.category !== undefined) {
    if (!['document', 'code', 'data', 'media', 'unknown'].includes(String(raw.category))) throw new Error('Invalid file type')
    scope.category = raw.category as FileCategory
  }
  return scope
}

export function atlasRoutes(service: AtlasService, editFile: (file: AtlasFile, section?: EditorSection) => Promise<{ editor: 'nvim' | 'vim' }> = (file, section) => openInTerminalEditor(file, { section })): Router {
  const router = Router(), store = service.store
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.get('/summary', (req, res) => {
    try { res.json(store.summary(parseScope(req.query))) } catch (e) { res.status(400).json({ error: String(e) }) }
  })
  router.get('/files', (req, res) => {
    try { res.json(store.list(parseScope(req.query), bounded(req.query.offset, 0, 10_000_000), bounded(req.query.limit, 100, 500))) }
    catch (e) { res.status(400).json({ error: String(e) }) }
  })
  router.get('/viewport', (req, res) => {
    try {
      const bounds = Object.fromEntries(['minX', 'minY', 'maxX', 'maxY'].map(key => {
        if (typeof req.query[key] !== 'string' || req.query[key] === '') throw new Error('Invalid viewport bounds')
        const value = Number(req.query[key])
        if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw new Error('Invalid viewport bounds')
        return [key, value]
      })) as { minX: number; minY: number; maxX: number; maxY: number }
      if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new Error('Invalid viewport bounds')
      res.json({ files: store.viewport(parseScope(req.query), bounds), revision: store.revision })
    } catch (e) { res.status(400).json({ error: String(e) }) }
  })
  router.get('/file/:id', (req, res) => {
    const file = store.file(req.params.id)
    if (!file) return res.status(404).json({ error: 'File not found' })
    store.index.incrementViewCount(file.id)
    return res.json(file)
  })
  router.get('/file/:id/text', async (req, res) => {
    try { await service.text(req.params.id) } catch { return res.status(500).json({ error: 'Preview unavailable' }) }
    const file = store.file(req.params.id), doc = store.document(req.params.id)
    if (!file || !doc) return res.status(404).json({ error: 'File not found' })
    return res.json({ content: doc.text, status: doc.status, error: doc.error, mimeType: file.mimeType, size: file.size, truncated: doc.status === 'truncated' })
  })
  router.post('/search', async (req, res) => {
    try {
      const query: unknown = req.body?.query
      if (typeof query !== 'string' || !query.trim() || query.length > 2000) return res.status(400).json({ error: 'Enter a search of 1–2000 characters' })
      const scope = parseScope(req.body), limit = bounded(req.body.limit, 50, 100)
      if (scope.collectionId !== undefined && !store.index.getCollection(scope.collectionId)) return res.status(404).json({ error: 'Collection not found' })
      const start = performance.now()
      if (req.body.mode === 'related') {
        try {
          const results = await service.related(query, scope, limit, () => res.destroyed)
          if (!res.destroyed) res.json({ results, semanticAvailable: true, elapsedMs: performance.now() - start })
        } catch { if (!res.destroyed) res.json({ results: [], semanticAvailable: false, elapsedMs: performance.now() - start }) }
      } else res.json({ results: store.lexical(query, scope, limit), semanticAvailable: true, elapsedMs: performance.now() - start })
    } catch (e) { res.status(400).json({ error: String(e) }) }
  })
  router.post('/file/:id/edit', localRequest, async (req, res) => {
    const file = store.file(req.params.id)
    if (!file) return res.status(404).json({ error: 'File not found' })
    const { line, sourceLine, contentHash } = req.body ?? {}
    if ((line !== undefined || sourceLine !== undefined || contentHash !== undefined) && (!Number.isSafeInteger(line) || line < 1 || line > 2097152 || typeof sourceLine !== 'string' || sourceLine.length > 8192 || /[\r\n]/.test(sourceLine) || typeof contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(contentHash))) return res.status(400).json({ error: 'Invalid section location' })
    try { return res.json(await editFile(file, line === undefined ? undefined : { line, sourceLine, contentHash })) }
    catch (error) { return res.status(error instanceof TerminalEditorError ? error.status : 500).json({ error: error instanceof TerminalEditorError ? error.message : 'Could not open the terminal editor' }) }
  })
  router.post('/file/:id/refresh-text', localRequest, async (req, res) => {
    if (!store.file(req.params.id)) return res.status(404).json({ error: 'File not found' })
    try { await service.refreshText(req.params.id); return res.json({ file: store.file(req.params.id) }) }
    catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : 'Could not refresh document' }) }
  })
  router.post('/file/:id/favorite', (req, res) => {
    const { isFavorite, favoriteAppearance } = req.body ?? {}
    if (typeof isFavorite !== 'boolean' || (favoriteAppearance !== undefined && !['pulsar', 'black-hole'].includes(favoriteAppearance))) return res.status(400).json({ error: 'Expected a favorite state and optional pulsar or black-hole appearance' })
    if (!store.favorite(req.params.id, isFavorite, favoriteAppearance)) return res.status(404).json({ error: 'File not found' })
    return res.json({ revision: store.revision, file: store.file(req.params.id) })
  })
  router.post('/file/:id/pin', (req, res) => {
    const { x, y } = req.body ?? {}
    const unpin = x === null && y === null
    if (!unpin && (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e8 || Math.abs(y) > 1e8)) return res.status(400).json({ error: 'Invalid position' })
    if (!store.pin(req.params.id, x, y)) return res.status(404).json({ error: 'File not found' })
    return res.json({ revision: store.revision, file: store.file(req.params.id) })
  })
  router.patch('/region/:id', (req, res) => {
    const label: unknown = req.body?.label
    if (typeof label !== 'string' || !label.trim() || label.length > 120) return res.status(400).json({ error: 'Name must be 1–120 characters' })
    if (!store.renameRegion(req.params.id, label.trim())) return res.status(404).json({ error: 'Region not found' })
    return res.json({ revision: store.revision })
  })
  router.get('/snapshots', (_req, res) => res.json(store.snapshots()))
  router.post('/snapshots', (req, res) => {
    const name: unknown = req.body?.name
    if (typeof name !== 'string' || !name.trim() || name.length > 120) return res.status(400).json({ error: 'Enter a snapshot name' })
    return res.json({ id: store.snapshot(name.trim()) })
  })
  router.post('/snapshots/:id/restore', (req, res) => {
    try {
      const id = bounded(req.params.id, 0, 2 ** 31 - 1)
      if (!store.snapshots().some(s => s.id === id)) return res.status(404).json({ error: 'Snapshot not found' })
      store.snapshot('Before restore · ' + new Date().toISOString())
      store.restore(id)
      return res.json({ revision: store.revision })
    } catch (e) { return res.status(400).json({ error: String(e) }) }
  })
  return router
}
