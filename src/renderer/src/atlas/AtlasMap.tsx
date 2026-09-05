import { LabelPainter, type MapLabel } from './labelPainter'
import { galaxyHaze } from './galaxyHaze'
import { useAtlasTiles } from './useAtlasTiles'
import { celestialType, CELESTIAL_LABELS } from '@shared/celestial'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { AtlasFile, AtlasRegion, AtlasMarker, AtlasScope } from '@shared/atlas'
import { canvasRenderer, gpuRenderer, SPRITE_BYTES, type PointRenderer } from './pointRenderer'
import { fitCamera, zoomAt, objectRadius, project, seedFor, unproject, type Camera, type ScenePoint } from './scene'
import { readStored, writeStored } from './storage'

interface Props {
  regions: AtlasRegion[]
  markers: AtlasMarker[]
  filter: AtlasScope
  revision: number
  destination: AtlasRegion | null
  files: AtlasFile[]
  scopeKey: string
  selectedId: string | null
  highlights: Set<string>
  theme: string
  onRegion: (region: AtlasRegion) => void
  onSelect: (file: AtlasFile) => void
  onRead: () => void
  onFiles: (files: AtlasFile[]) => void
  onSelectId: (id: string) => void
  onPin: (id: string, x: number, y: number) => void
  onMetrics?: (metrics: MapMetrics) => void
}
export interface MapMetrics { renderer: string; points: number; labels: number; drawMs: number; draws: number; bytes: number }
export interface MapHandle { overview(): void; fit(): void; zoom(factor: number): void; pan(dx: number, dy: number): void; focus(file: AtlasFile): void; camera(): Camera; restore(camera: Camera): void }
interface HitTarget { id: string; x: number; y: number; radius: number; file?: AtlasFile; marker?: AtlasMarker; region?: AtlasRegion }
const THEMES: Record<string, { point?: string; label: string }> = {
  jwst: { label: '#e7dfcf' }, vapor: { point: '#e6a1cd', label: '#efc9f1' },
  atari: { point: '#9be0af', label: '#d6eeb2' }, lost: { point: '#dcbf95', label: '#e8dcc8' }, bio: { point: '#8ecdbd', label: '#bfdfb0' },
}

export const AtlasMap = forwardRef<MapHandle, Props>(function AtlasMap(props, ref) {
  const host = useRef<HTMLDivElement>(null), labelCanvas = useRef<HTMLCanvasElement>(null)
  const pointCanvas = useRef<HTMLCanvasElement | null>(null), renderer = useRef<PointRenderer | null>(null)
  const camera = useRef<Camera>({ x: 0, y: 0, zoom: .3 }), size = useRef({ width: 800, height: 600, dpr: 1 })
  const tiles = useAtlasTiles(props.filter, props.revision)
  const files = useMemo(() => [...new Map([...tiles.files, ...props.files].map(f => [f.id, f])).values()], [tiles.files, props.files])
  const { onFiles } = props
  useEffect(() => { onFiles(files) }, [files, onFiles])
  const latest = useRef({ ...props, files }); latest.current = { ...props, files }
  const requestVisible = useRef(tiles.requestVisible); requestVisible.current = tiles.requestVisible
  const initialized = useRef(false)
  const zoomMotion = useRef<{ from: number; to: number; world: [number, number]; screen: [number, number]; at: number; direction: number } | null>(null)
  const travel = useRef<{ from: Camera; to: Camera; at: number } | null>(null)
  const hazeCanvas = useRef<HTMLCanvasElement>(null)
  const hazeKey = JSON.stringify(props.markers.map(r => [r.x, r.y]))
  const haze = useMemo(() => galaxyHaze(JSON.parse(hazeKey).map(([x, y]: [number, number]) => ({ x, y }))), [hazeKey])
  const hazeRef = useRef(haze); hazeRef.current = haze
  const hovered = useRef<string | null>(null), targets = useRef<HitTarget[]>([])
  const labelPainter = useRef(new LabelPainter())
  const frame = useRef(0), drawCount = useRef(0), scope = useRef(''), renderCallback = useRef<() => void>(() => {})
  const pointsRef = useRef<ScenePoint[]>([]), metricsAt = useRef(0)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; file?: AtlasFile; wx?: number; wy?: number } | null>(null)

  const scene = useMemo(() => {
    const theme = THEMES[props.theme] ?? THEMES.jwst
    const points: ScenePoint[] = []
    const realFiles = new Map(files.map(f => [f.id, f]))
    for (const marker of props.markers) {
      if (realFiles.has(marker.id)) continue
      points.push({ id: marker.id, x: marker.x, y: marker.y, radius: marker.id === props.selectedId ? 31 : props.highlights.has(marker.id) ? 28 : 25, objectType: marker.type ?? 'main-sequence', zoomable: true,
        rotation: (seedFor(marker.id) % 100 / 100 - .5) * .5, color: '#b9d5d7',
        alpha: props.highlights.size && !props.highlights.has(marker.id) ? .2 : .9 })
    }
    for (const file of files) points.push({ id: file.id, x: file.x, y: file.y,
      objectType: celestialType(file), zoomable: true, rotation: (seedFor(file.id) % 100 / 100 - .5) * .5,
      radius: file.id === props.selectedId ? 31 : props.highlights.has(file.id) ? 28 : 25,
      color: file.id === props.selectedId ? '#f4d9a4' : theme.point ?? '#b9d5d7',
      alpha: props.highlights.size && !props.highlights.has(file.id) && file.id !== props.selectedId ? .2 : .9 })
    return points
  }, [props.markers, files, props.selectedId, props.highlights, props.theme])

  const invalidate = useCallback((): void => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; renderCallback.current() })
  }, [])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCamera = useRef<{ key: string; value: Camera } | null>(null)
  const flushCamera = useCallback(() => {
    if (pendingCamera.current) writeStored('camera.continuous.' + pendingCamera.current.key, pendingCamera.current.value)
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
  const fitted = useCallback((): Camera => {
    const { regions, destination, markers } = latest.current
    const samples = destination ? markers.filter(m => destination.kind === 'region' ? m.regionId === destination.id : m.neighborhoodId === destination.id) : markers
    const extent = destination ? (destination.kind === 'region' ? regions.filter(r => r.parentId === destination.id) : [destination]) : regions.filter(r => r.kind === 'region')
    return fitCamera(samples.length ? samples : extent, size.current.width, size.current.height)
  }, [])
  const animateTo = useCallback((to: Camera): void => {
    zoomMotion.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.current = to; saveCamera() }
    else travel.current = { from: { ...camera.current }, to, at: performance.now() }
    invalidate()
  }, [invalidate, saveCamera])
  const fit = useCallback((): void => { animateTo(fitted()) }, [animateTo, fitted])
  const smoothZoom = useCallback((factor: number, x: number, y: number): void => {
    travel.current = null
    const direction = Math.sign(factor - 1), old = zoomMotion.current
    const start = old?.direction === direction ? old.to : camera.current.zoom
    const to = Math.max(.003, Math.min(120, start * factor))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      camera.current = zoomAt(camera.current, to / camera.current.zoom, x, y, size.current.width, size.current.height)
      saveCamera()
    } else zoomMotion.current = { from: camera.current.zoom, to,
      world: unproject(x, y, camera.current, size.current.width, size.current.height), screen: [x, y], at: performance.now(), direction }
    invalidate()
  }, [invalidate, saveCamera])
  useImperativeHandle(ref, () => ({
    overview() { animateTo(fitCamera(latest.current.markers, size.current.width, size.current.height)) },
    fit,
    zoom(factor) {
      const selected = latest.current.files.find(f => f.id === latest.current.selectedId)
      const { width, height } = size.current
      const selectedAt = selected ? project(selected.x, selected.y, camera.current, width, height) : null
      const at = selectedAt && selectedAt[0] >= 0 && selectedAt[0] <= width && selectedAt[1] >= 0 && selectedAt[1] <= height ? selectedAt : [width / 2, height / 2]
      // Keep a selected object anchored where it already is, rather than snapping it to center.
      smoothZoom(factor, at[0], at[1])
    },
    pan(dx, dy) { travel.current = null; zoomMotion.current = null; camera.current.x += dx / camera.current.zoom; camera.current.y += dy / camera.current.zoom; saveCamera(); invalidate() },
    focus(file) { animateTo({ x: file.x, y: file.y, zoom: Math.max(1.5, camera.current.zoom) }) },
    camera() { return { ...camera.current } },
    restore(value) { animateTo({ ...value }) },
  }))

  renderCallback.current = () => {
    const start = performance.now(), { width, height, dpr } = size.current
    if (!width || !height || !renderer.current) return
    if (travel.current) {
      const { from, to, at } = travel.current, t = Math.min(1, (performance.now() - at) / 420), ease = t * t * (3 - 2 * t)
      camera.current = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease, zoom: Math.exp(Math.log(from.zoom) + Math.log(to.zoom / from.zoom) * ease) }
      if (t < 1) invalidate()
      else { travel.current = null; saveCamera() }
    }
    if (zoomMotion.current) {
      const { from, to, world, screen, at } = zoomMotion.current
      const t = Math.min(1, (performance.now() - at) / 140), ease = 1 - (1 - t) ** 3
      const zoom = Math.exp(Math.log(from) + Math.log(to / from) * ease)
      camera.current = { zoom, x: world[0] - (screen[0] - width / 2) / zoom, y: world[1] - (screen[1] - height / 2) / zoom }
      if (t < 1) invalidate()
      else { zoomMotion.current = null; saveCamera() }
    }
    requestVisible.current(camera.current, width, height)
    const moving = drag.current
    if (moving?.file && moving.wx !== undefined && moving.wy !== undefined) renderer.current.setPoints(pointsRef.current.map(p => p.id === moving.file!.id ? { ...p, x: moving.wx!, y: moving.wy! } : p))
    const sky = hazeCanvas.current?.getContext('2d'), glow = hazeRef.current
    if (sky) {
      sky.setTransform(dpr, 0, 0, dpr, 0, 0); sky.clearRect(0, 0, width, height)
      if (glow && camera.current.zoom < .3) {
        const [x, y] = project(glow.x, glow.y, camera.current, width, height)
        sky.globalAlpha = .45 * Math.max(0, Math.min(1, (.3 - camera.current.zoom) / .2))
        sky.drawImage(glow.canvas, x, y, glow.width * camera.current.zoom, glow.height * camera.current.zoom)
      }
    }
    renderer.current.draw(camera.current, width, height, dpr)
    const ctx = labelCanvas.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height)
    const { regions, files, selectedId, highlights, theme } = latest.current
    const labelCandidates: MapLabel[] = [], hitTargets: HitTarget[] = []
    const themeColors = THEMES[theme] ?? THEMES.jwst
    // Labels are capped by the viewport, with selected/search/hover first.
    const labelBudget = Math.min(70, Math.max(10, Math.floor(width * height / 16000)))
    const levelAlpha = (region: AtlasRegion): number => {
      const smooth = (a: number, b: number) => { const t = Math.max(0, Math.min(1, (camera.current.zoom - a) / (b - a))); return t * t * (3 - 2 * t) }
      return region.kind === 'region' ? 1 - smooth(.09, .22) : smooth(.07, .18) * (1 - smooth(.65, 1.3))
    }
    for (const region of regions) {
      const opacity = levelAlpha(region)
      if (opacity < .05) continue
      const [x, y] = project(region.x, region.y, camera.current, width, height)
      if (x < -100 || y < -60 || x > width + 100 || y > height + 60) continue
      hitTargets.push({ id: region.id, x, y, radius: Math.max(50, Math.min(140, region.radius * camera.current.zoom * .7)), region })
      const fontSize = region.kind === 'region' ? 19 : 17
      ctx.font = `${fontSize}px Georgia, serif`
      const maxWidth = Math.min(220, width * .38)
      let title = region.label
      while (title.length > 4 && ctx.measureText(title).width > maxWidth) title = title.slice(0, -2).replace(/…$/, '') + '…'
      labelCandidates.push({ id: region.id, x: region.x, y: region.y, offset: 15, title,
        subtitle: region.count.toLocaleString() + ' files  ·  Explore ↗', color: themeColors.label,
        font: `${fontSize}px Georgia, serif`, opacity: opacity * .95, priority: region.count })
    }
    if (camera.current.zoom > .25) {
      const hydrated = new Set(files.map(f => f.id))
      for (const marker of latest.current.markers) {
        if (hydrated.has(marker.id)) continue
        const [x, y] = project(marker.x, marker.y, camera.current, width, height)
        if (x >= 0 && x <= width && y >= 0 && y <= height) hitTargets.push({ id: marker.id, x, y, radius: Math.max(8, objectRadius({ radius: 25, zoomable: true }, camera.current.zoom) * .45), marker })
      }
    }
    const ordered = [...files].sort((a, b) => {
      const priority = (id: string) => id === selectedId ? 4 : highlights.has(id) ? 2 : 0
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
      const focused = file.id === selectedId || highlights.has(file.id)
      if (file.id === selectedId) {
        ctx.globalAlpha = .85; ctx.strokeStyle = '#e7c68d'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(x, y, markerRadius, 0, Math.PI * 2); ctx.stroke()
        ctx.globalAlpha = .4; ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 22, y); ctx.moveTo(x + 22, y); ctx.lineTo(x + 26, y); ctx.stroke()
      }
      ctx.font = '12px -apple-system, BlinkMacSystemFont, sans-serif'
      const title = file.name.length > 32 ? file.name.slice(0, 29) + '…' : file.name
      const t = Math.max(0, Math.min(1, (camera.current.zoom - .6) / .5))
      labelCandidates.push({ id: file.id, x: wx, y: wy, offset: Math.max(28, markerRadius + 10), title,
        color: focused ? '#efdab7' : '#b9c7d4', font: '12px -apple-system, BlinkMacSystemFont, sans-serif',
        opacity: focused ? 1 : t * t * (3 - 2 * t), priority: focused ? 10000 : 1,
        selected: file.id === selectedId, background: true })
      if (file.isPinned) { ctx.fillStyle = '#e7c68d'; ctx.fillRect(x - 2, y + 16, 4, 4) }
    }
    const painted = labelPainter.current.draw(ctx, labelCandidates, camera.current, width, height, labelBudget)
    const labels = painted.count
    if (painted.pending) invalidate()
    ctx.globalAlpha = 1; targets.current = hitTargets
    drawCount.current++
    if (host.current) {
      host.current.dataset.labels = labelPainter.current.visibleIds.join(',')
      host.current.dataset.camera = JSON.stringify(camera.current)
      host.current.dataset.hydrated = String(files.length)
      host.current.dataset.objectTypes = [...new Set(pointsRef.current.flatMap(p => p.objectType ?? []))].join(',')
      host.current.dataset.renderer = renderer.current.kind
      host.current.dataset.points = String(pointsRef.current.length)
      host.current.dataset.draws = String(drawCount.current)
      host.current.dataset.drawMs = String(performance.now() - start)
    }
    if (performance.now() - metricsAt.current > 500) {
      metricsAt.current = performance.now()
      latest.current.onMetrics?.({ renderer: renderer.current.kind, points: pointsRef.current.length, labels, drawMs: performance.now() - start,
        draws: drawCount.current, bytes: SPRITE_BYTES + 1024 ** 2 * 4 + pointsRef.current.length * 44 + width * height * dpr * dpr * 12 })
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
      size.current = { width: rect.width, height: rect.height, dpr }
      for (const layer of [canvas, overlay, hazeCanvas.current!]) { layer.width = Math.round(rect.width * dpr); layer.height = Math.round(rect.height * dpr) }
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
      travel.current = null; zoomMotion.current = null
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
      else if (!current.moved) { const [x, y] = at(e), hit = pick(x, y); if (hit?.file) latest.current.onSelect(hit.file); else if (hit?.marker) latest.current.onSelectId(hit.id); else if (hit?.region) latest.current.onRegion(hit.region) }
      container.style.cursor = 'grab'; saveCamera(); invalidate()
    }
    const cancel = () => { drag.current = null; renderer.current?.setPoints(pointsRef.current); container.style.cursor = 'grab'; invalidate() }
    const double = () => { if (hovered.current && latest.current.files.some(f => f.id === hovered.current)) latest.current.onRead() }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const [x, y] = at(e), { height } = size.current
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? height : 1)
      smoothZoom(Math.exp(-Math.max(-600, Math.min(600, delta)) * .0015), x, y)
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
  }, [saveCamera, invalidate, smoothZoom])

  useEffect(() => {
    pointsRef.current = scene; renderer.current?.setPoints(scene)
    if (props.regions.length && (!initialized.current || scope.current !== props.scopeKey)) {
      const first = !initialized.current
      initialized.current = true; scope.current = props.scopeKey
      const saved = readStored<Camera | null>('camera.continuous.' + props.scopeKey, null)
      const next = saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom > 0 ? saved : fitted()
      if (first) camera.current = next
      else animateTo(next)
    }
    invalidate()
  }, [scene, props.scopeKey, props.regions, files, props.selectedId, invalidate, fitted, animateTo])

  const destinations = props.destination ? props.regions.filter(r => r.parentId === props.destination!.id) : props.regions.filter(r => r.kind === 'region')

  return <div className="atlas-map" ref={host} role="region" aria-label="Spatial file atlas">
    <canvas ref={hazeCanvas} className="atlas-haze-canvas" aria-hidden="true" />
    <canvas ref={labelCanvas} className="atlas-label-canvas" aria-hidden="true" />
    <nav className="atlas-sr-only" aria-label="Map destinations">
      {destinations.map(r => <button key={r.id} onClick={() => props.onRegion(r)}>{r.label}, {r.count} files</button>)}
      {(props.destination?.kind === 'neighborhood' ? files.filter(f => f.neighborhoodId === props.destination!.id) : files.slice(0, 100)).map(f => <button key={f.id} onClick={() => props.onSelect(f)}>{f.name}, {CELESTIAL_LABELS[celestialType(f)]}</button>)}
    </nav>
    <div className="atlas-map-note" aria-hidden="true"><strong>A galaxy of familiar places.</strong><span>Scroll closer to discover each object · Drag to explore · Shift-drag to pin</span></div>
  </div>
})
