interface Props {
  onClose: () => void
}

interface Binding {
  key: string
  desc: string
}

const NAV_BINDINGS: Binding[] = [
  { key: 'h / j / k / l', desc: 'Pan (hold for smooth)' },
  { key: 'H / J / K / L', desc: 'Pan fast (4×)' },
  { key: '+ or =', desc: 'Zoom in ×1.2' },
  { key: '- or _', desc: 'Zoom out ÷1.2' },
  { key: 'gg', desc: 'Fit all stars in view' },
  { key: 'gh', desc: 'Fit selected cluster' },
]

const SEARCH_BINDINGS: Binding[] = [
  { key: '⌘F / Ctrl+F', desc: 'Toggle search bar (keeps query + highlights)' },
  { key: 'n / N', desc: 'Next / prev search result (selects + pans)' },
  { key: 'Esc', desc: 'Exit search / clear selection' },
]

const SELECTION_BINDINGS: Binding[] = [
  { key: 'Enter', desc: 'Select hovered star (or hide search bar when typing)' },
  { key: 'o', desc: 'Open selected in default app' },
  { key: 'O', desc: 'Reveal selected file in file explorer' },
  { key: 't', desc: 'Open star-type dropdown' },
  { key: 'T', desc: 'Cycle star type forward' },
  { key: 'Shift + drag', desc: 'Pin a star to a position' },
]

const PANEL_BINDINGS: Binding[] = [
  { key: 'c', desc: 'Toggle collections sidebar' },
  { key: 'i', desc: 'Focus indexer (Galaxy panel path input)' },
  { key: '?', desc: 'Toggle this cheatsheet' },
  { key: 'Shift + P', desc: 'Toggle perf overlay (FPS, p99, frame budget)' },
  { key: 'Shift + E', desc: 'Toggle Embedding Lab' },
]

export default function Cheatsheet({ onClose }: Props) {
  return (
    <aside className="cheatsheet-panel">
      <header className="cheatsheet-header">
        <span className="cheatsheet-title">How to use Star Palace</span>
        <button className="cheatsheet-close" onClick={onClose} aria-label="Close cheatsheet">×</button>
      </header>

      <div className="cheatsheet-section-title">Navigation</div>
      <table className="cheatsheet-table"><tbody>
        {NAV_BINDINGS.map(b => (
          <tr key={b.key}>
            <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
            <td className="cheatsheet-desc">{b.desc}</td>
          </tr>
        ))}
      </tbody></table>

      <div className="cheatsheet-section-title">Search</div>
      <table className="cheatsheet-table"><tbody>
        {SEARCH_BINDINGS.map(b => (
          <tr key={b.key}>
            <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
            <td className="cheatsheet-desc">{b.desc}</td>
          </tr>
        ))}
      </tbody></table>

      <div className="cheatsheet-section-title">Selection &amp; Star Type</div>
      <table className="cheatsheet-table"><tbody>
        {SELECTION_BINDINGS.map(b => (
          <tr key={b.key}>
            <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
            <td className="cheatsheet-desc">{b.desc}</td>
          </tr>
        ))}
      </tbody></table>

      <div className="cheatsheet-section-title">Panels</div>
      <table className="cheatsheet-table"><tbody>
        {PANEL_BINDINGS.map(b => (
          <tr key={b.key}>
            <td className="cheatsheet-key"><kbd>{b.key}</kbd></td>
            <td className="cheatsheet-desc">{b.desc}</td>
          </tr>
        ))}
      </tbody></table>

      <div className="cheatsheet-section-title">Themes</div>
      <div className="cheatsheet-note">
        Pick a theme from the <strong>StatsBar</strong> dropdown (bottom-right).
        Five aesthetics, all running on the same procedural engine:
        <ul>
          <li><strong>JWST</strong> — deep-space realism. Carina-palette nebulae, soft halos, vignette.</li>
          <li><strong>Vapor</strong> — synthwave + Tron grid + CRT scanlines on every star.</li>
          <li><strong>Atari low-res</strong> — chunky 8-bit (renders at 1.0 DPR by design).</li>
          <li><strong>Lost in space</strong> — illustrated. Astronauts, ships, wormholes replace stars. Flat lighting.</li>
          <li><strong>Bioluminescent</strong> — organic. Anemones, jellyfish, glowing flora. Flat lighting.</li>
        </ul>
      </div>

      <div className="cheatsheet-section-title">Tags (per file)</div>
      <div className="cheatsheet-note">
        Click any star to open the <strong>DetailPanel</strong> (right side).
        Below the star-type selector you'll find a tag chip list — type a tag,
        press <kbd>Enter</kbd> to add. Tags persist across re-index and feed
        the <em>tags+metadata+content</em> embedding strategy when active.
      </div>

      <div className="cheatsheet-section-title">Embedding Lab (<kbd>Shift+E</kbd>)</div>
      <div className="cheatsheet-note">
        Test different embedding strategies on a subset of files before
        adopting one globally. Workflow:
        <ol>
          <li>Press <kbd>Shift+E</kbd> to open the lab.</li>
          <li>Pick a subdirectory from the tree (need ≥10 files).</li>
          <li>Pick a strategy: <em>content-only</em> (legacy raw text),
            <em>metadata-only</em>, <em>metadata+content</em> (recommended),
            <em>tags+metadata+content</em>, or
            <em>sampled-stats+metadata</em> (numeric files).</li>
          <li>Click <strong>Run experiment</strong> — affected stars re-embed
            and reposition with subset PCA.</li>
          <li>Click <strong>Preview</strong> on the snapshot row to see the
            new layout in the main viewport (affected stars get an accent ring
            + side-by-side mini-canvas of the cluster shape).</li>
          <li><strong>Promote</strong> adopts the strategy as the default and
            re-embeds the rest of the corpus in the background.
            <strong>Revert</strong> restores the prior embeddings + positions.</li>
        </ol>
      </div>

      <div className="cheatsheet-section-title">Index a directory</div>
      <div className="cheatsheet-note">
        Press <kbd>i</kbd> to focus the path input in the Galaxy panel
        (top-right). Type an absolute folder path, optionally name the galaxy,
        then click <strong>Index</strong>. The daemon walks the directory,
        embeds each file via Ollama, and adds new stars to the sky. New rows
        record the current default embedding strategy.
      </div>

      <div className="cheatsheet-note">
        Star Palace vim mode departs from standard vim: navigation keys pan the
        canvas rather than move a cursor, and <kbd>gg</kbd> fits the entire sky
        rather than jumping to line 1.
      </div>
    </aside>
  )
}
