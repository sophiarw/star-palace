import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { AtlasFile, AtlasRegion } from '@shared/atlas'
import { canvasRenderer, gpuRenderer, type PointRenderer } from './pointRenderer'
import { fitCamera, labelFits, project, seedFor, unproject, type Camera, type LabelBox, type ScenePoint } from './scene'
import { readStored, writeStored } from './storage'

interface Props {
  regions: AtlasRegion[]
  files: AtlasFile[]
  scopeKey: string
  selectedId: string | null
  highlights: Set<string>
  theme: string
  onRegion: (region: AtlasRegion) => void
  onSelect: (file: AtlasFile) => void
  onRead: () => void
  onPin: (id: string, x: number, y: number) => void
  onMetrics?: (metrics: MapMetrics) => void
}
export interface MapMetrics { renderer: string; points: number; labels: number; drawMs: number; draws: number; bytes: number }
export interface MapHandle { fit(): void; zoom(factor: number): void; pan(dx: number, dy: number): void; focus(file: AtlasFile): void; camera(): Camera }
interface HitTarget { id: string; x: number; y: number; radius: number; file?: AtlasFile; region?: AtlasRegion }
const THEMES: Record<string, { point?: string; label: string }> = {
  jwst: { label: '#e7dfcf' }, vapor: { point: '#e6a1cd', label: '#efc9f1' },
  atari: { point: '#9be0af', label: '#d6eeb2' }, lost: { point: '#dcbf95', label: '#e8dcc8' }, bio: { point: '#8ecdbd', label: '#bfdfb0' },
}

export const AtlasMap = forwardRef<MapHandle, Props>(function AtlasMap(props, ref) {
  const host = useRef<HTMLDivElement>(null), labelCanvas = useRef<HTMLCanvasElement>(null)
  const pointCanvas = useRef<HTMLCanvasElement | null>(null), renderer = useRef<PointRenderer | null>(null)
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: .3 }), size = useRef({ width: 800, height: 600, dpr: 1 })
  const latest = useRef(props); latest.current = props
  const hovered = useRef<string | null>(null), targets = useRef<HitTarget[]>([])
  const frame = useRef(0), drawCount = useRef(0), scope = useRef(''), renderCallback = useRef<() => void>(() => {})
  const pointsRef = useRef<ScenePoint[]>([]), metricsAt = useRef(0)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; file?: AtlasFile; wx?: number; wy?: number } | null>(null)

  const scene = useMemo(() => {
    const theme = THEMES[props.theme] ?? THEMES.jwst
    const points: ScenePoint[] = []
    for (const region of props.regions) {
      let seed = seedFor(region.id)
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
      const count = Math.min(65, Math.max(10, Math.ceil(Math.sqrt(region.count) * 3)))
      for (let i = 0; i < count; i++) {
        const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * region.radius * .7
        points.push({ id: `${region.id}:${i}`, x: region.x + Math.cos(angle) * radius, y: region.y + Math.sin(angle) * radius * .62,
          radius: 1.8 + random() * 2.1, color: theme.point ?? region.color, alpha: .32 + random() * .55 })
      }
      points.push({ id: region.id, x: region.x, y: region.y, radius: 7, color: theme.point ?? region.color, alpha: 1 })
    }
    for (const file of props.files) points.push({ id: file.id, x: file.x, y: file.y,
      radius: file.id === props.selectedId ? 12 : props.highlights.has(file.id) ? 8 : 4.4,
      color: file.id === props.selectedId ? '#f4d9a4' : theme.point ?? '#b9d5d7',
      alpha: props.highlights.size && !props.highlights.has(file.id) && file.id !== props.selectedId ? .2 : .9 })
    return points
  }, [props.regions, props.files, props.selectedId, props.highlights, props.theme])

  const invalidate = useCallback((): void => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; renderCallback.current() })
  }, [])
  const saveCamera = useCallback((): void => { writeStored('camera.' + scope.current, camera.current) }, [])
  const fit = useCallback((): void => {
    const { regions, files } = latest.current
    camera.current = fitCamera(regions.length ? regions : files, size.current.width, size.current.height)
    saveCamera(); invalidate()
  }, [saveCamera, invalidate])
  useImperativeHandle(ref, () => ({
    fit,
    zoom(factor) { camera.current.zoom = Math.max(.003, Math.min(15, camera.current.zoom * factor)); saveCamera(); invalidate() },
    pan(dx, dy) { camera.current.x += dx / camera.current.zoom; camera.current.y += dy / camera.current.zoom; saveCamera(); invalidate() },
    focus(file) { camera.current = { x: file.x, y: file.y, zoom: Math.max(1.5, camera.current.zoom) }; saveCamera(); invalidate() },
    camera() { return { ...camera.current } },
  }))

  renderCallback.current = () => {
    const start = performance.now(), { width, height, dpr } = size.current
    if (!width || !height || !renderer.current) return
    renderer.current.draw(camera.current, width, height, dpr)
    const ctx = labelCanvas.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
    const { regions, files, selectedId, highlights, theme } = latest.current
    const used: LabelBox[] = [], hitTargets: HitTarget[] = []
    const themeColors = THEMES[theme] ?? THEMES.jwst
    // Labels are capped by the viewport, with selected/search/hover first.
    const labelBudget = Math.min(70, Math.max(10, Math.floor(width * height / 16000)))
    let labels = 0
    for (const region of regions) {
      const [x, y] = project(region.x, region.y, camera.current, width, height)
      if (x < -100 || y < -60 || x > width + 100 || y > height + 60) continue
      hitTargets.push({ id: region.id, x, y, radius: Math.max(50, Math.min(140, region.radius * camera.current.zoom * .7)), region })
      const isHovered = hovered.current === region.id
      ctx.font = `${region.kind === 'region' ? 25 : 20}px Georgia, serif`
      const box = { x: x + 15, y: y - 5, width: Math.min(230, ctx.measureText(region.label).width), height: 48 }
      if (labels >= labelBudget || (!isHovered && !labelFits(box, used))) continue
      used.push(box); labels++
      ctx.fillStyle = themeColors.label; ctx.globalAlpha = isHovered ? 1 : .9
      ctx.fillText(region.label, box.x, y + 6, 230)
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillStyle = '#9aaabb'
      ctx.fillText(region.count.toLocaleString() + ' files  ·  Explore ↗', box.x, y + 27)
      if (isHovered) { ctx.strokeStyle = region.color; ctx.globalAlpha = .3; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke() }
    }
    const ordered = [...files].sort((a, b) => {
      const priority = (id: string) => id === selectedId ? 4 : id === hovered.current ? 3 : highlights.has(id) ? 2 : 0
      return priority(b.id) - priority(a.id)
    })
    for (const file of ordered) {
      let wx = file.x, wy = file.y
      if (drag.current?.file?.id === file.id) { wx = drag.current.wx ?? wx; wy = drag.current.wy ?? wy }
      const [x, y] = project(wx, wy, camera.current, width, height)
      if (x < -25 || y < -25 || x > width + 25 || y > height + 25) continue
      hitTargets.push({ id: file.id, x, y, radius: 12, file })
      const focused = file.id === selectedId || file.id === hovered.current || highlights.has(file.id)
      if (file.id === selectedId) {
        ctx.globalAlpha = .85; ctx.strokeStyle = '#e7c68d'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(x - 19, y); ctx.lineTo(x - 14, y); ctx.moveTo(x + 14, y); ctx.lineTo(x + 19, y); ctx.stroke()
      }
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
      const title = file.name.length > 32 ? file.name.slice(0, 29) + '…' : file.name
      const box = { x: x + 18, y: y - 8, width: ctx.measureText(title).width, height: 23 }
      if (labels >= labelBudget || (!focused && (camera.current.zoom < .9 || !labelFits(box, used)))) continue
      if (focused && !labelFits(box, used) && file.id !== selectedId && file.id !== hovered.current) continue
      used.push(box); labels++
      ctx.globalAlpha = 1; ctx.fillStyle = '#0c1420df'; ctx.fillRect(box.x - 5, box.y - 4, box.width + 10, 24)
      ctx.fillStyle = focused ? '#efdab7' : '#b9c7d4'; ctx.fillText(title, box.x, y + 5)
      if (file.isPinned) { ctx.fillStyle = '#e7c68d'; ctx.fillRect(x - 2, y + 16, 4, 4) }
    }
    ctx.globalAlpha = 1; targets.current = hitTargets
    drawCount.current++
    if (performance.now() - metricsAt.current > 500) {
      metricsAt.current = performance.now()
      latest.current.onMetrics?.({ renderer: renderer.current.kind, points: pointsRef.current.length, labels, drawMs: performance.now() - start,
        draws: drawCount.current, bytes: pointsRef.current.length * 28 + width * height * dpr * dpr * 8 })
    }
  }

  useEffect(() => {
    const container = host.current!, overlay = labelCanvas.current!
    let canvas = document.createElement('canvas'); canvas.className = 'atlas-point-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.prepend(canvas)
    const forceCanvas = new URLSearchParams(location.search).get('renderer') === 'canvas'
    let engine = forceCanvas ? null : gpuRenderer(canvas)
    if (!engine) {
      canvas.remove(); canvas = document.createElement('canvas'); canvas.className = 'atlas-point-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.prepend(canvas)
      engine = canvasRenderer(canvas)
    }
    renderer.current = engine; pointCanvas.current = canvas; engine.setPoints(pointsRef.current)
    const resize = () => {
      const rect = container.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1)
      if (!rect.width || !rect.height) return
      const first = !overlay.width || scope.current === ''
      size.current = { width: rect.width, height: rect.height, dpr }
      for (const layer of [canvas, overlay]) { layer.width = Math.round(rect.width * dpr); layer.height = Math.round(rect.height * dpr) }
      if (first && (latest.current.regions.length || latest.current.files.length)) fit()
      invalidate()
    }
    const observer = new ResizeObserver(resize); observer.observe(container); resize()
    const pick = (x: number, y: number): HitTarget | null => {
      let closest: HitTarget | null = null, distance = Infinity
      for (const target of targets.current) { const d = Math.hypot(target.x - x, target.y - y); if (d < target.radius && d < distance) { closest = target; distance = d } }
      return closest
    }
    const at = (e: PointerEvent | WheelEvent): [number, number] => { const rect = container.getBoundingClientRect(); return [e.clientX - rect.left, e.clientY - rect.top] }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      const [x, y] = at(e), hit = pick(x, y)
      drag.current = { x, y, cx: camera.current.x, cy: camera.current.y, moved: false, file: e.shiftKey ? hit?.file : undefined }
      overlay.setPointerCapture(e.pointerId); container.style.cursor = e.shiftKey && hit?.file ? 'move' : 'grabbing'
    }
    const move = (e: PointerEvent) => {
      const [x, y] = at(e), current = drag.current
      if (current) {
        if (Math.hypot(x - current.x, y - current.y) > 4) current.moved = true
        if (current.file) { const [wx, wy] = unproject(x, y, camera.current, size.current.width, size.current.height); current.wx = wx; current.wy = wy }
        else { camera.current.x = current.cx - (x - current.x) / camera.current.zoom; camera.current.y = current.cy - (y - current.y) / camera.current.zoom }
        invalidate(); return
      }
      const hit = pick(x, y)
      container.style.cursor = hit ? 'pointer' : 'grab'
      if (hovered.current !== (hit?.id ?? null)) { hovered.current = hit?.id ?? null; invalidate() }
    }
    const up = (e: PointerEvent) => {
      const current = drag.current
      if (!current) return
      drag.current = null
      if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId)
      if (current.file && current.moved && current.wx !== undefined && current.wy !== undefined) latest.current.onPin(current.file.id, current.wx, current.wy)
      else if (!current.moved) { const [x, y] = at(e), hit = pick(x, y); if (hit?.file) latest.current.onSelect(hit.file); else if (hit?.region) latest.current.onRegion(hit.region) }
      container.style.cursor = 'grab'; saveCamera(); invalidate()
    }
    const cancel = () => { drag.current = null; container.style.cursor = 'grab'; invalidate() }
    const double = () => { if (hovered.current && latest.current.files.some(f => f.id === hovered.current)) latest.current.onRead() }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const [x, y] = at(e), { width, height } = size.current
      const before = unproject(x, y, camera.current, width, height)
      camera.current.zoom = Math.max(.003, Math.min(15, camera.current.zoom * Math.exp(-e.deltaY * .0015)))
      const after = unproject(x, y, camera.current, width, height)
      camera.current.x += before[0] - after[0]; camera.current.y += before[1] - after[1]
      saveCamera(); invalidate()
    }
    const lost = (e: Event) => { e.preventDefault(); container.dataset.graphics = 'Graphics paused. Switch to the Canvas renderer in Settings.' }
    canvas.addEventListener('webglcontextlost', lost)
    overlay.addEventListener('pointerdown', down); overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', cancel)
    overlay.addEventListener('dblclick', double); overlay.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0
      overlay.removeEventListener('pointerdown', down); overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up); overlay.removeEventListener('pointercancel', cancel)
      overlay.removeEventListener('dblclick', double); overlay.removeEventListener('wheel', wheel)
      canvas.removeEventListener('webglcontextlost', lost); engine.destroy(); canvas.remove(); renderer.current = null
    }
  }, [fit, saveCamera, invalidate])

  useEffect(() => {
    const wasEmpty = pointsRef.current.length === 0
    pointsRef.current = scene; renderer.current?.setPoints(scene)
    if (scope.current !== props.scopeKey || (wasEmpty && scene.length > 0)) {
      scope.current = props.scopeKey
      const saved = readStored<Camera | null>('camera.' + props.scopeKey, null)
      camera.current = saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom > 0 ? saved : fitCamera(props.regions.length ? props.regions : props.files, size.current.width, size.current.height)
    }
    invalidate()
  }, [scene, props.scopeKey, props.regions, props.files, invalidate])

  return <div className="atlas-map" ref={host} role="region" aria-label="Spatial file atlas">
    <canvas ref={labelCanvas} className="atlas-label-canvas" aria-hidden="true" />
    <nav className="atlas-sr-only" aria-label="Map destinations">
      {props.regions.map(r => <button key={r.id} onClick={() => props.onRegion(r)}>{r.label}, {r.count} files</button>)}
    </nav>
    <div className="atlas-map-note" aria-hidden="true"><strong>{props.files.length ? 'A familiar neighborhood.' : 'A place for everything.'}</strong><span>{props.files.length ? 'Select to preview · Shift-drag to pin' : 'Explore a region to reveal its files'}</span></div>
  </div>
})
