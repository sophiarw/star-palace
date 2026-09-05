import type { RequestHandler } from 'express'

/** New local file/archive/update operations must not be callable from a remote web page. */
export const localRequest: RequestHandler = (req, res, next) => {
  const local = (value: string) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname) } catch { return false } }
  if (!local('http://' + req.headers.host) || (req.headers.origin && !local(req.headers.origin))) { res.status(403).json({ error: 'This action is available only from the local Star Palace app.' }); return }
  if (req.method !== 'GET' && !req.is('application/json')) { res.status(415).json({ error: 'Expected JSON' }); return }
  next()
}
