import { Router } from 'express'
import { localRequest } from './localRequest'
import type { UpdateStatus } from '../../shared/update'

export function updateRoutes(running: () => boolean): Router & { updating: () => boolean } {
  const router = Router()
  let status: UpdateStatus = process.send ? { state: 'idle', message: 'Updates follow the public main branch.' } : { state: 'unavailable', message: 'Start Star Palace with npm start to enable updates.' }
  let requested = false
  process.on('message', message => {
    const m = message as { type?: string; status?: UpdateStatus }
    if (m.type === 'update-status' && m.status) { status = m.status; requested = ['checking', 'installing', 'restarting'].includes(status.state) }
  })
  router.use(localRequest)
  router.get('/', (_req, res) => res.set('Cache-Control', 'no-store').json(status))
  router.post('/', (_req, res) => {
    if (!process.send) return res.status(409).json({ error: status.message })
    if (requested || running()) return res.status(409).json({ error: 'Finish indexing or the current update before updating.' })
    requested = true; status = { state: 'checking', message: 'Checking the release repository…' }
    process.send({ type: 'update-request' })
    return res.status(202).json(status)
  })
  // The index entry point uses this to prevent jobs starting during an update.
  return Object.assign(router, { updating: () => requested })
}
