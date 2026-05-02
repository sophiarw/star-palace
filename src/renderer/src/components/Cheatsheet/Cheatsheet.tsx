interface Props {
  onClose: () => void
}

interface Binding {
  key: string
  desc: string
}

const NORMAL_BINDINGS: Binding[] = [
  { key: 'h / j / k / l', desc: 'Pan 50 world-units' },
  { key: 'H / J / K / L', desc: 'Pan 200 world-units' },
  { key: '+ or =', desc: 'Zoom in ×1.2' },
  { key: '- or _', desc: 'Zoom out ÷1.2' },
  { key: 'gg', desc: 'Fit all stars in view' },
  { key: 'gh', desc: 'Fit selected cluster' },
  { key: 'n / N', desc: 'Next / prev search result' },
  { key: 'Enter', desc: 'Select hovered star' },
  { key: 'o', desc: 'Open selected in default app' },
  { key: 't', desc: 'Open star-type dropdown' },
  { key: 'T', desc: 'Cycle star type forward' },
  { key: 'p', desc: 'Pin selected star (stub)' },
  { key: 'u', desc: 'Unpin selected star (stub)' },
  { key: '/', desc: 'Enter search mode' },
  { key: 'Esc', desc: 'Back to normal / clear' },
  { key: '?', desc: 'Toggle this cheatsheet' },
]

export default function Cheatsheet({ onClose }: Props) {
  return (
    <aside className="cheatsheet-panel">
      <header className="cheatsheet-header">
        <span className="cheatsheet-title">Key bindings</span>
        <button className="cheatsheet-close" onClick={onClose} aria-label="Close cheatsheet">×</button>
      </header>
      <table className="cheatsheet-table">
        <tbody>
          {NORMAL_BINDINGS.map(b => (
            <tr key={b.key}>
              <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
              <td className="cheatsheet-desc">{b.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cheatsheet-note">
        Star Palace vim mode departs from standard vim: navigation keys pan the
        canvas rather than move a cursor, and <kbd>gg</kbd> fits the entire sky
        rather than jumping to line 1.
      </div>
    </aside>
  )
}
