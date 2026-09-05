import { TutorialLink } from './Tutorials'
import { useEffect, useState } from 'react'
import type { AtlasFile } from '@shared/atlas'
import type { TextHistoryFile, TextHistoryStatus, TextHistoryVersion } from '@shared/history'
import { atlasApi } from './api'
import { Modal } from './Modal'

export function HistorySources() {
  const [status, setStatus] = useState<TextHistoryStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => atlasApi.historyStatus().then(s => { if (alive) setStatus(s) }).catch(e => { if (alive) setError(String(e)) })
    void load(); const timer = setInterval(() => void load(), 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [])
  return <section className="atlas-history-sources"><h3>Text history</h3><TutorialLink topic="history" /><p className="atlas-muted">Keep local versions of indexed Markdown, text, and source files up to 1 MiB. Saves are captured after they settle. History starts when you enable a source; pausing keeps saved versions.</p>
    {status?.sources.map(source => <label key={source.id}><input type="checkbox" checked={source.enabled} disabled={busy} onChange={e => {
      setBusy(true); setError(''); void atlasApi.historyEnable(source.id, e.target.checked).then(setStatus).catch(e => setError(String(e))).finally(() => setBusy(false))
    }} />{source.name}</label>)}
    {status && !status.sources.length && <p>Add a source folder to enable history.</p>}
    {status && <p className="atlas-muted">{(status.storageBytes / 1048576).toFixed(1)} MiB of a {(status.maxBytes / 1048576).toFixed(0)} MiB archive budget · {status.captured} versions captured this session · {status.skipped} skipped or unavailable files. Open a file’s History to inspect versions or capture limits.</p>}
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
  </section>
}

export function FileHistory({ file, onClose }: { file: AtlasFile; onClose: () => void }) {
  const [history, setHistory] = useState<TextHistoryFile | null>(null), [selected, setSelected] = useState('')
  const [version, setVersion] = useState<TextHistoryVersion | null>(null), [mode, setMode] = useState<'content' | 'diff'>('content')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => atlasApi.history(file.id).then(h => { if (alive) { setHistory(h); setSelected(s => s || h.versions[0]?.id || '') } }).catch(e => { if (alive) setError(String(e)) })
    void load(); const timer = setInterval(() => void load(), 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [file.id])
  useEffect(() => {
    setVersion(null); if (!selected) return
    const abort = new AbortController()
    void atlasApi.version(file.id, selected, abort.signal).then(v => { if (!abort.signal.aborted) setVersion(v) }).catch(e => { if (!abort.signal.aborted) setError(String(e)) })
    return () => abort.abort()
  }, [file.id, selected])
  return <Modal title={'History · ' + file.name} onClose={onClose}><div className="atlas-form"><TutorialLink topic="history" />
    {history && !history.enabled && <p className="atlas-muted">Capture is paused for this source. Enable it in Settings → Text history.</p>}
    {history?.reason && <p className="atlas-notice">{history.reason}</p>}
    {history && !history.versions.length && <p>{history.enabled && history.eligible ? 'Waiting for the first settled save. Capture runs in the background.' : 'No saved versions yet.'}</p>}
    {!!history?.versions.length && <><label>Saved version<select aria-label="Saved version" value={selected} onChange={e => { setSelected(e.target.value); setNotice(''); setError('') }}>{history.versions.map(v => <option value={v.id} key={v.id}>{new Date(v.capturedAt).toLocaleString()} · {v.id.slice(0, 7)}</option>)}</select></label>
      <div className="atlas-history-tools"><button aria-pressed={mode === 'content'} onClick={() => setMode('content')}>Document</button><button aria-pressed={mode === 'diff'} onClick={() => setMode('diff')}>Changes since previous save</button><button disabled={!version || busy} onClick={() => { setBusy(true); setError(''); void atlasApi.recover(file.id, selected).then(result => setNotice('Recovered beside the original: ' + result.path)).catch(e => setError(String(e))).finally(() => setBusy(false)) }}>Restore a copy</button></div>
      <pre className="atlas-history-content" tabIndex={0}>{version ? (mode === 'content' ? version.content : version.diff || 'No text changes.') : 'Loading saved version…'}</pre>
      <p className="atlas-muted">The latest 100 versions are listed. Restoring creates a new file beside the original. Reindex the folder to add the copy to your atlas.</p></>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </div></Modal>
}
