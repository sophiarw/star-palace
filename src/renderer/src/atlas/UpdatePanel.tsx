import { TutorialLink } from './Tutorials'
import { useEffect, useRef, useState } from 'react'
import type { UpdateStatus } from '@shared/update'
import { atlasApi } from './api'

const PENDING_UPDATE = 'starpalace.pending-update'
/** Keep reconnecting even if Settings is closed while the launcher restarts. */
export function useUpdateReconnect() {
  useEffect(() => {
    let checking = false
    const timer = setInterval(() => {
      const started = Number(sessionStorage.getItem(PENDING_UPDATE))
      if (!started || checking) return
      if (Date.now() - started > 15 * 60 * 1000) { sessionStorage.removeItem(PENDING_UPDATE); return }
      checking = true
      void atlasApi.updateStatus().then(status => {
        if (status.state === 'done' || status.state === 'error') sessionStorage.removeItem(PENDING_UPDATE)
        if (status.state === 'done') location.reload()
      }).catch(() => {}).finally(() => { checking = false })
    }, 2000)
    return () => clearInterval(timer)
  }, [])
}

export function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null), [error, setError] = useState('')
  const requested = useRef(false), started = useRef(0)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const next = await atlasApi.updateStatus()
        if (!alive) return
        setStatus(next)
        if (next.state === 'done') requested.current = false
        if (next.state === 'error') requested.current = false
      } catch {
        if (!alive) return
        if (requested.current && Date.now() - started.current < 15 * 60 * 1000) setStatus({ state: 'restarting', message: 'Installing and restarting… This page will reconnect automatically. Progress is also shown in the terminal.' })
        else { requested.current = false; setError('Could not reconnect. Check the terminal, then restart with npm start.') }
      }
    }
    void load(); const timer = setInterval(() => void load(), 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  const busy = !!status && ['checking', 'installing', 'restarting'].includes(status.state)
  return <section><h3>Application update</h3><TutorialLink topic="updates" /><p className="atlas-muted">{status?.message ?? 'Checking the launcher…'}</p><button disabled={!status || busy || status.state === 'unavailable'} onClick={() => {
    setError(''); requested.current = true; started.current = Date.now(); sessionStorage.setItem(PENDING_UPDATE, String(started.current)); setStatus({ state: 'checking', message: 'Checking for updates…' })
    void atlasApi.update().then(setStatus).catch(e => { requested.current = false; sessionStorage.removeItem(PENDING_UPDATE); setError(String(e)); setStatus({ state: 'error', message: 'Update could not start.' }) })
  }}>{busy ? 'Updating…' : 'Update Star Palace'}</button>{error && <p role="alert">{error}</p>}</section>
}
