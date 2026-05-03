interface Props {
  onClose: () => void
}

interface Binding {
  key: string
  desc: string
}

const NAV_BINDINGS: Binding[] = [
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
  { key: '/', desc: 'Enter search mode' },
  { key: 'Esc', desc: 'Back to normal / clear' },
  { key: '?', desc: 'Toggle this cheatsheet' },
]

const INDEX_BINDINGS: Binding[] = [
  { key: 'i', desc: 'Focus the indexer (Galaxy panel path input)' },
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
          {NAV_BINDINGS.map(b => (
            <tr key={b.key}>
              <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
              <td className="cheatsheet-desc">{b.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cheatsheet-section-title">Index a directory</div>
      <table className="cheatsheet-table">
        <tbody>
          {INDEX_BINDINGS.map(b => (
            <tr key={b.key}>
              <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
              <td className="cheatsheet-desc">{b.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cheatsheet-note">
        Press <kbd>i</kbd> to focus the path input in the Galaxy panel
        (top-right). Type an absolute folder path, optionally name the galaxy,
        then click <strong>Index</strong>. The daemon walks the directory,
        embeds each file via Ollama, and adds new stars to the sky.
      </div>
      <div className="cheatsheet-note">
        Star Palace vim mode departs from standard vim: navigation keys pan the
        canvas rather than move a cursor, and <kbd>gg</kbd> fits the entire sky
        rather than jumping to line 1.
      </div>
    </aside>
  )
}
