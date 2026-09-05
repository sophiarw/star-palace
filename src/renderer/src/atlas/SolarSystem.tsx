import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { TutorialLink } from './Tutorials'
import { PlanetSurface, PLANET_FAMILIES } from './planetSurface'
import { seedFor } from './scene'
import type { MarkdownSection, MarkdownSystem } from './markdownSections'

export interface SolarSession { time: number; selected: string | null; paused: boolean; page: number }
interface Props { name: string; system: MarkdownSystem; session: SolarSession; truncated: boolean; onClose: () => void; onRead: (section: MarkdownSection | null) => void; onEdit: (section: MarkdownSection) => Promise<void>; onRefresh: () => Promise<void> }
const PAGE_SIZE = 12

export function SolarSystem({ name, system, session, truncated, onClose, onRead, onEdit, onRefresh }: Props) {
  const [page, setPage] = useState(Math.min(session.page, Math.max(0, Math.ceil(system.planets.length / PAGE_SIZE) - 1)))
  const planets = system.planets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const [selectedId, setSelectedId] = useState(session.selected ?? planets[0]?.id)
  const selected = planets.find(p => p.id === selectedId) ?? planets[0]
  const moons = system.headings.filter(section => section.parentLine === selected?.line)
  const [paused, setPaused] = useState(session.paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const stage = useRef<HTMLDivElement>(null), orbitCanvas = useRef<HTMLCanvasElement>(null), detail = useRef<HTMLCanvasElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>()), thumbnails = useRef(new Map<string, HTMLCanvasElement>())
  const moonButtons = useRef(new Map<string, HTMLButtonElement>())
  const interact = useRef({ pointer: false, focus: false }), current = useRef({ paused, selected, planets })
  current.current = { paused, selected, planets }
  useEffect(() => { session.selected = selected?.id ?? null; session.paused = paused; session.page = page }, [session, selected, paused, page])
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => { if (motion.matches) setPaused(true) }
    motion.addEventListener('change', change); return () => motion.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    const surface = new PlanetSurface(), painted = new Set<string>()
    let frame = 0, last = 0, lastDetail = '', dirty = true
    const observer = new ResizeObserver(() => { dirty = true }); observer.observe(stage.current!)
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw)
      if (now - last < 1000 / 30) return
      const dt = Math.min(.08, (now - last) / 1000); last = now
      if (document.hidden) return
      const { paused, selected, planets } = current.current
      const stopped = paused || interact.current.pointer || interact.current.focus
      if (!stopped) session.time += dt
      let generated = 0
      for (const planet of planets) {
        if (painted.has(planet.id)) continue
        const canvas = thumbnails.current.get(planet.id)
        if (!canvas) continue
        const seed = seedFor(planet.id); surface.paint(canvas, seed, seed % 6)
        painted.add(planet.id); dirty = true
        if (++generated === 2) break
      }
      const detailKey = selected?.id + ':' + (stopped || !surface.animated ? 'still' : session.time.toFixed(2))
      if (selected && detail.current && (detailKey !== lastDetail || dirty)) {
        const seed = seedFor(selected.id); surface.paint(detail.current, seed, seed % 6, session.time, 448); lastDetail = detailKey; dirty = true
      }
      if (stopped && !dirty) return
      const width = stage.current!.clientWidth, height = stage.current!.clientHeight, dpr = Math.min(devicePixelRatio, 2)
      const canvas = orbitCanvas.current!, ctx = canvas.getContext('2d')!
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr) }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
      const span = Math.max(30, Math.min(width * .45, height * .64))
      planets.forEach((planet, index) => {
        const r = span * (.26 + .70 * (index + 1) / planets.length), seed = seedFor(planet.id)
        const angle = (seed % 6283) / 1000 + session.time * .017 / (1 + index * .23)
        const x = width / 2 + Math.cos(angle) * r, y = height / 2 + Math.sin(angle) * r * .64
        ctx.beginPath(); ctx.ellipse(width / 2, height / 2, r, r * .64, 0, 0, Math.PI * 2); ctx.strokeStyle = selected?.id === planet.id ? '#465463' : '#19212c'; ctx.lineWidth = 1; ctx.stroke()
        const button = buttons.current.get(planet.id)
        if (button) { button.style.left = x + 'px'; button.style.top = y + 'px'; button.dataset.orbitX = x.toFixed(2); button.dataset.orbitY = y.toFixed(2) }
        if (selected?.id === planet.id) system.headings.filter(h => h.parentLine === planet.line).slice(0, 4).forEach((moon, i) => {
          const element = moonButtons.current.get(moon.id), phase = seedFor(moon.id) % 6283 / 1000 + session.time * .06
          if (element) { element.style.left = x + Math.cos(phase) * (39 + i * 8) + 'px'; element.style.top = y + Math.sin(phase) * (28 + i * 5) + 'px' }
        })
      })
      stage.current!.dataset.orbitTime = session.time.toFixed(3); stage.current!.dataset.generated = String(painted.size)
      dirty = false
    }
    frame = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); surface.destroy() }
  }, [page, system, session])
  const perform = async (operation: () => Promise<void>, message: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await operation(); setNotice(message) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const choose = (section: MarkdownSection) => { setSelectedId(section.id); session.selected = section.id }
  return <Modal title={'Solar system · ' + name} onClose={onClose}><div className="atlas-solar-system">
    <div className="atlas-solar-tools"><span>Contents · {system.planets.length} planets</span><button aria-pressed={paused} onClick={() => setPaused(v => !v)}>{paused ? 'Resume orbits' : 'Pause orbits'}</button><button disabled={busy} onClick={() => void perform(onRefresh, 'Document refreshed')}>Refresh document</button><TutorialLink topic="solar-system" /></div>
    <div className="atlas-solar-layout"><div>
      <div className="atlas-solar-stage" ref={stage} onPointerEnter={() => { interact.current.pointer = true }} onPointerLeave={() => { interact.current.pointer = false }} onFocusCapture={() => { interact.current.focus = true }} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) interact.current.focus = false }}>
        <canvas ref={orbitCanvas} aria-hidden="true" className="atlas-solar-orbits" />
        <button className="atlas-solar-sun" aria-label="Read whole document" title="Read whole document" onClick={() => onRead(null)}>✦</button>
        {planets.map(planet => <button key={planet.id} ref={node => { if (node) buttons.current.set(planet.id, node); else buttons.current.delete(planet.id) }} className={'atlas-section-planet ' + (selected?.id === planet.id ? 'is-selected' : '')} data-section-id={planet.id} data-section-line={planet.line} aria-label={`Read section: ${planet.title}, line ${planet.line}`} onFocus={() => choose(planet)} onPointerEnter={() => choose(planet)} onClick={() => onRead(planet)} style={{ '--planet-size': `${Math.min(68, 36 + Math.log2(1 + planet.chars) * 2)}px` } as React.CSSProperties}>
          <canvas ref={node => { if (node) thumbnails.current.set(planet.id, node); else thumbnails.current.delete(planet.id) }} aria-hidden="true" /><span>{planet.title}</span>
        </button>)}
        {moons.slice(0, 4).map(moon => <button key={moon.id} ref={node => { if (node) moonButtons.current.set(moon.id, node); else moonButtons.current.delete(moon.id) }} className="atlas-section-moon" aria-label={`Read subsection: ${moon.title}, line ${moon.line}`} title={moon.title} onClick={() => onRead(moon)}><span aria-hidden="true" /></button>)}
      </div>
      <p className="atlas-muted atlas-solar-hint">Select a planet to read its section. Orbits pause while you point or use the keyboard.</p>
      {system.planets.length > PAGE_SIZE && <div className="atlas-solar-pages"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous planets</button><span>{page + 1} / {Math.ceil(system.planets.length / PAGE_SIZE)}</span><button disabled={(page + 1) * PAGE_SIZE >= system.planets.length} onClick={() => setPage(p => p + 1)}>Next planets</button></div>}
      <nav className="atlas-solar-contents" aria-label="Section planets">{planets.map(planet => <button key={planet.id} aria-current={selected?.id === planet.id ? 'true' : undefined} onFocus={() => choose(planet)} onPointerEnter={() => choose(planet)} onClick={() => onRead(planet)}>{planet.title}<small>Line {planet.line}</small></button>)}</nav>
    </div><aside className="atlas-solar-inspector"><canvas ref={detail} aria-label="Selected planet surface" /><div className="atlas-eyebrow">{selected && PLANET_FAMILIES[seedFor(selected.id) % 6]}</div><h3>{selected?.title}</h3><p className="atlas-muted">Line {selected?.line} · {Math.max(1, Math.ceil((selected?.chars ?? 0) / 1100))} min read</p>
      {selected && <div className="atlas-solar-actions"><button onClick={() => onRead(selected)}>Read section</button><button disabled={busy} onClick={() => void perform(() => onEdit(selected), 'Opened this section in your terminal editor')}>Edit section in Vim ↗</button></div>}
      {!!moons.length && <nav aria-label="Section moons"><h4>Moons · Subsections</h4>{moons.map(moon => <button key={moon.id} onClick={() => onRead(moon)}><span aria-hidden="true">☾</span> {moon.title}</button>)}</nav>}
      {error && <p role="alert" className="atlas-notice">{error}</p>}{notice && <p role="status" className="atlas-muted">{notice}</p>}
    </aside></div>
    {(truncated || system.limited) && <p className="atlas-notice">This system covers {system.limited ? 'the first 512 headings' : 'the indexed preview'}. Open the original file for the complete document.</p>}
  </div></Modal>
}
