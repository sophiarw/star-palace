import { celestialType, CELESTIAL_LABELS } from '@shared/celestial'
import type { StarType } from '@shared/types'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { AtlasFile, AtlasRegion } from '@shared/atlas'
import { canvasRenderer, gpuRenderer, SPRITE_BYTES, type PointRenderer } from './pointRenderer'
import { fitCamera, objectRadius, labelFits, project, seedFor, unproject, type Camera, type LabelBox, type ScenePoint } from './scene'
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
  onBack: () => void
  onPin: (id: string, x: number, y: number) => void
  onMetrics?: (metrics: MapMetrics) => void
}
export interface MapMetrics { renderer: string; points: number; labels: number; drawMs: number; draws: number; bytes: number }
export interface MapHandle { fit(): void; zoom(factor: number): void; pan(dx: number, dy: number): void; focus(file: AtlasFile): void; camera(): Camera; restore(camera: Camera): void }
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
  const previousSelection = useRef<string | null>(null)
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
      const types = Object.entries(region.objectTypes ?? {}) as [StarType, number][]
      const typedTotal = types.reduce((sum, [, n]) => sum + n, 0)
      for (let i = 0; i < count; i++) {
        let ordinal = (i + .5) / count * typedTotal
        const objectType = types.find(([, n]) => { ordinal -= n; return ordinal < 0 })?.[0]
        const angle = random() * Math.PI * 2, radius = Math.sqrt(random()) * region.radius * .7
        points.push({ id: `${region.id}:${i}`, x: region.x + Math.cos(angle) * radius, y: region.y + Math.sin(angle) * radius * .62,
          radius: objectType ? 9 + random() * 7 : 2.5, objectType, rotation: (random() - .5) * .7, color: theme.point ?? region.color, alpha: .55 + random() * .4 })
      }
      points.push({ id: region.id, x: region.x, y: region.y, radius: 7, color: theme.point ?? region.color, alpha: 1 })
    }
    for (const file of props.files) points.push({ id: file.id, x: file.x, y: file.y,
      objectType: celestialType(file), zoomable: true, rotation: (seedFor(file.id) % 100 / 100 - .5) * .5,
      radius: file.id === props.selectedId ? 31 : props.highlights.has(file.id) ? 28 : 25,
      color: file.id === props.selectedId ? '#f4d9a4' : theme.point ?? '#b9d5d7',
      alpha: props.highlights.size && !props.highlights.has(file.id) && file.id !== props.selectedId ? .2 : .9 })
    return points
  }, [props.regions, props.files, props.selectedId, props.highlights, props.theme])

  const invalidate = useCallback((): void => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; renderCallback.current() })
  }, [])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCamera = useRef<{ key: string; value: Camera } | null>(null)
  const flushCamera = useCallback(() => {
    if (pendingCamera.current) writeStored('camera.' + pendingCamera.current.key, pendingCamera.current.value)
    pendingCamera.current = null
  }, [])
  const saveCamera = useCallback((): void => {
    if (pendingCamera.current && pendingCamera.current.key !== scope.current) flushCamera()
    if (saveTimer.current) clearTimeout(saveTimer.current)
    pendingCamera.current = { key: scope.current, value: { ...camera.current } }
    saveTimer.current = setTimeout(flushCamera, 180)
  }, [flushCamera])
  useEffect(() => {
    window.addEventListener('pagehide', flushCamera)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); flushCamera(); window.removeEventListener('pagehide', flushCamera) }
  }, [flushCamera])
  const fit = useCallback((): void => {
    const { regions, files } = latest.current
    camera.current = fitCamera(regions.length ? regions : files, size.current.width, size.current.height)
    saveCamera(); invalidate()
  }, [saveCamera, invalidate])
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maybeExplore = useCallback((direction: number, x: number, y: number): void => {
    if (zoomTimer.current) clearTimeout(zoomTimer.current)
    zoomTimer.current = setTimeout(() => {
      const { regions, files } = latest.current, { width, height } = size.current
      if (direction > 0 && regions.length) {
        const [wx, wy] = unproject(x, y, camera.current, width, height)
        const nearest = [...regions].sort((a, b) => Math.hypot(a.x - wx, a.y - wy) - Math.hypot(b.x - wx, b.y - wy))[0]
        const size = nearest.radius * camera.current.zoom
        if (size > (nearest.kind === 'region' ? 220 : 160) && Math.hypot(nearest.x - wx, nearest.y - wy) < nearest.radius * 1.4) latest.current.onRegion(nearest)
      } else if (direction < 0 && (files.length || regions.some(r => r.kind === 'neighborhood'))) {
        const initial = fitCamera(regions.length ? regions : files, width, height)
        if (camera.current.zoom < initial.zoom * .45) latest.current.onBack()
      }
    }, 160)
  }, [])
  useEffect(() => () => { if (zoomTimer.current) clearTimeout(zoomTimer.current) }, [])
  useImperativeHandle(ref, () => ({
    fit,
    zoom(factor) {
      const selected = latest.current.files.find(f => f.id === latest.current.selectedId)
      if (factor > 1 && selected) { camera.current.x = selected.x; camera.current.y = selected.y }
      camera.current.zoom = Math.max(.003, Math.min(120, camera.current.zoom * factor)); maybeExplore(factor - 1, size.current.width / 2, size.current.height / 2); saveCamera(); invalidate() },
    pan(dx, dy) { camera.current.x += dx / camera.current.zoom; camera.current.y += dy / camera.current.zoom; saveCamera(); invalidate() },
    focus(file) { camera.current = { x: file.x, y: file.y, zoom: Math.max(1.5, camera.current.zoom) }; saveCamera(); invalidate() },
    camera() { return { ...camera.current } },
    restore(value) { camera.current = { ...value }; saveCamera(); invalidate() },
  }))

  renderCallback.current = () => {
    const start = performance.now(), { width, height, dpr } = size.current
    if (!width || !height || !renderer.current) return
    const moving = drag.current
    if (moving?.file && moving.wx !== undefined && moving.wy !== undefined) renderer.current.setPoints(pointsRef.current.map(p => p.id === moving.file!.id ? { ...p, x: moving.wx!, y: moving.wy! } : p))
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
    for (const region of [...regions].sort((a, b) => Number(b.id === hovered.current) - Number(a.id === hovered.current) || b.count - a.count)) {
      const [x, y] = project(region.x, region.y, camera.current, width, height)
      if (x < -100 || y < -60 || x > width + 100 || y > height + 60) continue
      hitTargets.push({ id: region.id, x, y, radius: Math.max(50, Math.min(140, region.radius * camera.current.zoom * .7)), region })
      const isHovered = hovered.current === region.id
      const fontSize = region.kind === 'region' && regions.length < 14 ? 25 : 20
      ctx.font = `${fontSize}px Georgia, serif`
      const maxWidth = Math.min(220, width * .38)
      let title = region.label
      while (title.length > 4 && ctx.measureText(title).width > maxWidth) title = title.slice(0, -2).replace(/…$/, '') + '…'
      const titleWidth = ctx.measureText(title).width
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
      const subtitle = region.count.toLocaleString() + ' files  ·  Explore ↗'
      const labelWidth = Math.max(titleWidth, ctx.measureText(subtitle).width)
      const box = { x: x + 15 + labelWidth > width - 15 ? x - labelWidth - 15 : x + 15, y: y - 5, width: labelWidth, height: 48 }
      if (box.x < 8 || box.y < 8 || box.y + box.height > height - 65) continue
      if (labels >= labelBudget || (!isHovered && !labelFits(box, used))) continue
      used.push(box); labels++
      ctx.fillStyle = themeColors.label; ctx.globalAlpha = isHovered ? 1 : .9
      ctx.font = `${fontSize}px Georgia, serif`; ctx.fillText(title, box.x, y + 6)
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillStyle = '#9aaabb'
      ctx.fillText(subtitle, box.x, y + 27)
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
      const radius = objectRadius({ radius: file.id === selectedId ? 31 : highlights.has(file.id) ? 28 : 25, zoomable: true }, camera.current.zoom)
      const markerRadius = Math.max(20, radius * .55)
      hitTargets.push({ id: file.id, x, y, radius: Math.max(16, radius * .45), file })
      const focused = file.id === selectedId || file.id === hovered.current || highlights.has(file.id)
      if (file.id === selectedId) {
        ctx.globalAlpha = .85; ctx.strokeStyle = '#e7c68d'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(x, y, markerRadius, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 22, y); ctx.moveTo(x + 22, y); ctx.lineTo(x + 26, y); ctx.stroke()
      }
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
      const title = file.name.length > 32 ? file.name.slice(0, 29) + '…' : file.name
      const box = { x: x + Math.max(28, markerRadius + 10), y: y - 8, width: ctx.measureText(title).width, height: 23 }
      if (labels >= labelBudget || (!focused && (camera.current.zoom < .9 || !labelFits(box, used)))) continue
      if (focused && !labelFits(box, used) && file.id !== selectedId && file.id !== hovered.current) continue
      used.push(box); labels++
      ctx.globalAlpha = 1; ctx.fillStyle = '#0c1420df'; ctx.fillRect(box.x - 5, box.y - 4, box.width + 10, 24)
      ctx.fillStyle = focused ? '#efdab7' : '#b9c7d4'; ctx.fillText(title, box.x, y + 5)
      if (file.isPinned) { ctx.fillStyle = '#e7c68d'; ctx.fillRect(x - 2, y + 16, 4, 4) }
    }
    ctx.globalAlpha = 1; targets.current = hitTargets
    drawCount.current++
    if (host.current) {
      host.current.dataset.objectTypes = [...new Set(pointsRef.current.flatMap(p => p.objectType ?? []))].join(',')
      host.current.dataset.renderer = renderer.current.kind
      host.current.dataset.points = String(pointsRef.current.length)
      host.current.dataset.draws = String(drawCount.current)
      host.current.dataset.drawMs = String(performance.now() - start)
    }
    if (performance.now() - metricsAt.current > 500) {
      metricsAt.current = performance.now()
      latest.current.onMetrics?.({ renderer: renderer.current.kind, points: pointsRef.current.length, labels, drawMs: performance.now() - start,
        draws: drawCount.current, bytes: SPRITE_BYTES + pointsRef.current.length * 44 + width * height * dpr * dpr * 8 })
    }
  }

  useEffect(() => {
    const container = host.current!, overlay = labelCanvas.current!
    let canvas = document.createElement('canvas'); canvas.className = 'atlas-point-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.prepend(canvas)
    const forceCanvas = new URLSearchParams(location.search).get('renderer') === 'canvas'
    const gpu = forceCanvas ? null : gpuRenderer(canvas, invalidate)
    let engine: PointRenderer
    if (gpu) engine = gpu
    else {
      canvas.remove(); canvas = document.createElement('canvas'); canvas.className = 'atlas-point-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.prepend(canvas)
      engine = canvasRenderer(canvas, invalidate)
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
      overlay.title = hit?.file ? `${hit.file.name} · ${CELESTIAL_LABELS[celestialType(hit.file)]}` : hit?.region?.label ?? ''
      container.style.cursor = hit ? 'pointer' : 'grab'
      if (hovered.current !== (hit?.id ?? null)) { hovered.current = hit?.id ?? null; invalidate() }
    }
    const up = (e: PointerEvent) => {
      const current = drag.current
      if (!current) return
      drag.current = null
      renderer.current?.setPoints(pointsRef.current)
      if (overlay.hasPointerCapture(e.pointerId)) overlay.releasePointerCapture(e.pointerId)
      if (current.file && current.moved && current.wx !== undefined && current.wy !== undefined) latest.current.onPin(current.file.id, current.wx, current.wy)
      else if (!current.moved) { const [x, y] = at(e), hit = pick(x, y); if (hit?.file) latest.current.onSelect(hit.file); else if (hit?.region) latest.current.onRegion(hit.region) }
      container.style.cursor = 'grab'; saveCamera(); invalidate()
    }
    const cancel = () => { drag.current = null; renderer.current?.setPoints(pointsRef.current); container.style.cursor = 'grab'; invalidate() }
    const double = () => { if (hovered.current && latest.current.files.some(f => f.id === hovered.current)) latest.current.onRead() }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const [x, y] = at(e), { width, height } = size.current
      const before = unproject(x, y, camera.current, width, height)
      camera.current.zoom = Math.max(.003, Math.min(120, camera.current.zoom * Math.exp(-e.deltaY * .0015)))
      const after = unproject(x, y, camera.current, width, height)
      camera.current.x += before[0] - after[0]; camera.current.y += before[1] - after[1]
      maybeExplore(-e.deltaY, x, y); saveCamera(); invalidate()
    }
    const lost = (e: Event) => {
      e.preventDefault()
      canvas.removeEventListener('webglcontextlost', lost)
      engine.destroy(); canvas.remove()
      canvas = document.createElement('canvas'); canvas.className = 'atlas-point-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.prepend(canvas)
      engine = canvasRenderer(canvas, invalidate); renderer.current = engine; pointCanvas.current = canvas
      engine.setPoints(pointsRef.current); resize(); invalidate()
    }
    canvas.addEventListener('webglcontextlost', lost)
    overlay.addEventListener('pointerdown', down); overlay.addEventListener('pointermove', move); overlay.addEventListener('pointerup', up); overlay.addEventListener('pointercancel', cancel)
    overlay.addEventListener('dblclick', double); overlay.addEventListener('wheel', wheel, { passive: false })
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current); frame.current = 0
      overlay.removeEventListener('pointerdown', down); overlay.removeEventListener('pointermove', move); overlay.removeEventListener('pointerup', up); overlay.removeEventListener('pointercancel', cancel)
      overlay.removeEventListener('dblclick', double); overlay.removeEventListener('wheel', wheel)
      canvas.removeEventListener('webglcontextlost', lost); engine.destroy(); canvas.remove(); renderer.current = null
    }
  }, [fit, saveCamera, invalidate, maybeExplore])

  useEffect(() => {
    const wasEmpty = pointsRef.current.length === 0
    pointsRef.current = scene; renderer.current?.setPoints(scene)
    if (scope.current !== props.scopeKey || (wasEmpty && scene.length > 0)) {
      if (zoomTimer.current) clearTimeout(zoomTimer.current)
      scope.current = props.scopeKey
      const saved = readStored<Camera | null>('camera.' + props.scopeKey, null)
      camera.current = saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom > 0 ? saved : fitCamera(props.regions.length ? props.regions : props.files, size.current.width, size.current.height)
    }
    const selected = props.files.find(f => f.id === props.selectedId)
    if (selected && previousSelection.current !== selected.id) {
      previousSelection.current = selected.id
      const [x, y] = project(selected.x, selected.y, camera.current, size.current.width, size.current.height)
      if (x < 45 || x > size.current.width - 45 || y < 45 || y > size.current.height - 45 || camera.current.zoom > 6) {
        camera.current.x = selected.x; camera.current.y = selected.y; saveCamera()
      }
    }
    invalidate()
  }, [scene, props.scopeKey, props.regions, props.files, props.selectedId, invalidate, saveCamera])

  return <div className="atlas-map" ref={host} role="region" aria-label="Spatial file atlas">
    <canvas ref={labelCanvas} className="atlas-label-canvas" aria-hidden="true" />
    <nav className="atlas-sr-only" aria-label="Map destinations">
      {props.files.map(f => <button key={f.id} onClick={() => props.onSelect(f)}>{f.name}, {CELESTIAL_LABELS[celestialType(f)]}</button>)}
      {props.regions.map(r => <button key={r.id} onClick={() => props.onRegion(r)}>{r.label}, {r.count} files</button>)}
    </nav>
    <div className="atlas-map-note" aria-hidden="true"><strong>{props.files.length ? 'A familiar neighborhood.' : 'A place for everything.'}</strong><span>{props.files.length ? 'Scroll closer to discover each object · Shift-drag to pin' : 'Select or zoom into a region to reveal its files'}</span></div>
  </div>
})
