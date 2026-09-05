import { Router } from 'express'
import { localRequest } from '../util/localRequest'
import type { TextHistory } from './TextHistory'

export function textHistoryRoutes(history: TextHistory): Router {
  const router = Router()
  router.use(localRequest)
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  router.get('/', (_req, res) => res.json(history.status()))
  router.post('/source/:id', async (req, res) => {
    try {
      const id = Number(req.params.id)
      if (!Number.isSafeInteger(id) || typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Expected a source and enabled state' })
      await history.enable(id, req.body.enabled)
      return res.json(history.status())
    } catch (e) { return res.status(400).json({ error: String(e) }) }
  })
  router.get('/file/:id', async (req, res) => {
    try { return res.json(await history.versions(req.params.id)) } catch (e) { return res.status(400).json({ error: String(e) }) }
  })
  router.get('/file/:id/:version', async (req, res) => {
    try { return res.json(await history.version(req.params.id, req.params.version)) } catch { return res.status(404).json({ error: 'Saved version not found for this file' }) }
  })
  router.post('/file/:id/:version/copy', async (req, res) => {
    try { return res.json({ path: await history.restoreCopy(req.params.id, req.params.version) }) } catch (e) { return res.status(400).json({ error: String(e) }) }
  })
  return router
}
