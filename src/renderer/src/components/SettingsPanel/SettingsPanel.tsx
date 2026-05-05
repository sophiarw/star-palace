import { useEffect, useState, useCallback } from 'react'
import { fetchIgnorePatterns, saveIgnorePatterns } from '../../api'

interface Props {
  visible: boolean
  onClose: () => void
  // Pinged when a save with non-zero `removed` count happens, so App can
  // refresh the star map after a sweep nukes contaminated rows.
  onMutated: () => void
}

const PLACEHOLDER = `# One pattern per line. gitignore syntax.
# Examples:
#   node_modules/
#   *.log
#   vendor/**
#   !vendor/keep.md
`

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  zIndex: 1100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(8, 14, 28, 0.96)',
  border: '1px solid rgba(140, 200, 255, 0.45)',
  borderRadius: 8,
  color: '#dbe8ff',
  font: '13px ui-monospace, SFMono-Regular, Menlo, monospace',
  padding: 20,
  width: 560,
  maxWidth: '90vw',
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 220,
  background: 'rgba(0, 0, 0, 0.35)',
  color: '#dbe8ff',
  border: '1px solid rgba(140, 200, 255, 0.25)',
  borderRadius: 4,
  padding: 8,
  font: 'inherit',
  resize: 'vertical',
  boxSizing: 'border-box',
}

const buttonStyle: React.CSSProperties = {
  background: 'rgba(140, 200, 255, 0.16)',
  border: '1px solid rgba(140, 200, 255, 0.4)',
  color: '#dbe8ff',
  padding: '6px 14px',
  cursor: 'pointer',
  font: 'inherit',
  borderRadius: 4,
}

export default function SettingsPanel({ visible, onClose, onMutated }: Props) {
  const [patterns, setPatterns] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Reload from server on every open so the user sees the live value, not a
  // stale local cache from an earlier session.
  useEffect(() => {
    if (!visible) return
    setLoading(true)
    setError(null)
    setStatus(null)
    fetchIgnorePatterns()
      .then(p => setPatterns(p))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [visible])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const { removed } = await saveIgnorePatterns(patterns)
      setStatus(removed > 0
        ? `Saved. Removed ${removed} already-indexed file${removed === 1 ? '' : 's'} matching the new rules.`
        : 'Saved. No already-indexed files matched.')
      if (removed > 0) onMutated()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [patterns, onMutated])

  if (!visible) return null

  return (
    <div style={overlayStyle} onClick={onClose} role="dialog" aria-label="Ignore patterns">
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <strong style={{ letterSpacing: 0.5 }}>Ignore patterns</strong>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#8aa1c8', cursor: 'pointer', padding: 0, fontSize: 18 }}
            aria-label="Close ignore-patterns panel"
          >
            ×
          </button>
        </div>
        <div style={{ color: '#8aa1c8', fontSize: 11, lineHeight: 1.5 }}>
          gitignore-style globs. Applies to every future index walk and, on
          Save, sweeps already-indexed files matching the rules. Layered on
          top of the built-in defaults (node_modules, .git, dist, .DS_Store, …).
        </div>
        <textarea
          value={patterns}
          onChange={e => setPatterns(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          disabled={loading || saving}
          style={textareaStyle}
        />
        {error && <div style={{ color: '#e07a7a', fontSize: 12 }}>{error}</div>}
        {status && <div style={{ color: '#74e07a', fontSize: 12 }}>{status}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ ...buttonStyle, background: 'transparent' }}>
            Close
          </button>
          <button type="button" onClick={handleSave} disabled={loading || saving} style={buttonStyle}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ color: '#5d7299', fontSize: 10 }}>Shift+I to toggle</div>
      </div>
    </div>
  )
}
