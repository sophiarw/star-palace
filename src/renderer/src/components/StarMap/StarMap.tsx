import { useRef, useEffect, useCallback, useState } from 'react'
import type { Star, Cluster, SearchResult, Edge } from '@shared/types'
import { CONSTELLATION_PALETTE } from '@shared/types'
import { fetchNeighborhood, edgeFromNeighborhood } from '../../api'
import HoverCard from '../HoverCard/HoverCard'
import {
  getStarSprite,
  getTypedStarSprite,
  sizeBucketFor,
  tempBucketFor,
  spriteCoreRadius,
  hashStr,
} from './sprites'
import { getBackdrop, getBackdropMultiplier } from './background'
import { defaultStarType } from './autoStarType'
import { worldToScreen, screenToWorld, type Camera } from './coords'
import type { VimAction } from '../../hooks/useVimMode'
import type { Theme } from '../../themes/types'

interface Props {
  stars: Star[]
  clusters: Cluster[]
  searchHighlights: SearchResult[]  // highlighted from search
  selectedId: string | null
  onSelect: (id: string | null) => void
  onReady?: () => void
  vimAction?: VimAction | null
  onHoveredChange?: (id: string | null) => void
  // F11 — active theme. Drives typed sprite drawer pick + canvas backdrop.
  theme: Theme
  // F4 — Shift+mousedown on a hovered star starts a drag-to-pin gesture; on
  // release we fire this callback. Optional so existing call sites compile
  // before App.tsx wires it up.
  onPinFile?: (id: string, worldX: number, worldY: number) => void
}

const HIGHLIGHT_COLOR = '#ffe066'
const NEIGHBOR_RING_COLOR = 'rgba(140, 200, 255, 0.85)'
const SELECTED_RING_COLOR = '#fff4d0'  // warm white, distinct from gold + cyan
const EDGE_COLOR = 'rgba(120, 180, 255, 0.45)'
const DIM_ALPHA = 0.08
const SPRITE_HOVER_SCALE = 1.35
const SPRITE_HIGHLIGHT_SCALE = 1.6
const SPRITE_HIGHLIGHT_PULSE = 0.35  // extra scale at pulse peak
const SPRITE_SELECTED_SCALE = 2.0
const SPRITE_SELECTED_BOOST_ALPHA = 0.6  // additive re-draw of sprite for brightness pop
const SPRITE_NEIGHBOR_SCALE = 1.6
const SPRITE_NEIGHBOR_BOOST_ALPHA = 0.35  // smaller pop than selected, so neighbors stay visible without competing
const SEARCH_PULSE_MS = 200
const CULL_MARGIN = 48
const ZOOM_MAX = 100
const ZOOM_MIN = 0.05

// Backdrop parallax: deep-field image scales + pans with the camera at sub-unity
// rates so it feels deeper than the indexed star layer.
const BACKDROP_ZOOM_PARALLAX = 0.4   // backdrop zooms ~40% as much as foreground (gentle gamma)
const BACKDROP_PAN_PARALLAX = 0.3    // backdrop pans 30% of camera pan
const BACKDROP_MIN_SCALE = 0.5       // clamp so the 2× canvas always fills the viewport

// Zoom-aware exposure: dim when zoomed out, brighten when zoomed in.
const EXPOSURE_REF_ZOOM = 1.0
const EXPOSURE_MIN = 0.3
const EXPOSURE_MAX = 1.6
const EXPOSURE_GAMMA = 0.55

function exposureFor(zoom: number): number {
  const e = Math.pow(zoom / EXPOSURE_REF_ZOOM, EXPOSURE_GAMMA)
  return Math.max(EXPOSURE_MIN, Math.min(EXPOSURE_MAX, e))
}

// Continuous draw-time scale for cached bucket sprites. Keeps sprites looking
// proportionally large at high zoom without swapping cache buckets — purely
// monotonic, no thresholds.
const ZOOM_DRAW_REF = 1
const ZOOM_DRAW_MAX = 4
const ZOOM_DRAW_GAMMA = 0.5

function zoomDrawScale(zoom: number): number {
  return Math.min(ZOOM_DRAW_MAX, Math.pow(Math.max(zoom, 0.001) / ZOOM_DRAW_REF, ZOOM_DRAW_GAMMA))
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

// Intersection of the segment from (cx, cy) toward (tx, ty) with the canvas
// rectangle, inset by `inset` pixels on every side. Used to project an
// off-screen point onto the visible boundary.
function canvasEdgeIntersection(
  cx: number, cy: number,
  tx: number, ty: number,
  w: number, h: number,
  inset: number,
): { x: number; y: number } {
  const dx = tx - cx, dy = ty - cy
  const left = inset, right = w - inset
  const top = inset, bottom = h - inset
  let t = Infinity
  if (dx > 0) t = Math.min(t, (right - cx) / dx)
  else if (dx < 0) t = Math.min(t, (left - cx) / dx)
  if (dy > 0) t = Math.min(t, (bottom - cy) / dy)
  else if (dy < 0) t = Math.min(t, (top - cy) / dy)
  if (!isFinite(t)) t = 0
  return { x: cx + dx * t, y: cy + dy * t }
}

function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size = 8): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(size, 0)
  ctx.lineTo(-size * 0.6, size * 0.55)
  ctx.lineTo(-size * 0.3, 0)
  ctx.lineTo(-size * 0.6, -size * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export default function StarMap({ stars, clusters, searchHighlights, selectedId, onSelect, onReady, vimAction, onHoveredChange, theme, onPinFile }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cam, setCam] = useState<Camera>({ cx: 0, cy: 0, zoom: 1 })
  const camRef = useRef<Camera>(cam)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 })
  const [edges, setEdges] = useState<Edge[]>([])
  const [neighborStars, setNeighborStars] = useState<Star[]>([])
  const starsRef = useRef(stars)
  const clustersRef = useRef(clusters)
  const highlightsRef = useRef(searchHighlights)
  const edgesRef = useRef(edges)
  const neighborStarsRef = useRef(neighborStars)
  const animRef = useRef<number | null>(null)
  const isDragging = useRef(false)
  const lastMouse = useRef({ x: 0, y: 0 })
  const searchPulseStart = useRef<number>(0)
  const dprRef = useRef<number>(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
  // F4 — drag-to-pin state: pinDrag.current holds the live target world
  // coords. The main draw loop runs each frame via rAF, so we don't need to
  // trigger a React re-render on each cursor move; the next frame picks up
  // the new ref value.
  const pinDrag = useRef<{ id: string; worldX: number; worldY: number } | null>(null)

  // F11 — active theme ref. The draw callback below reads it each frame so
  // theme switches re-render every visible star without rebuilding the rAF
  // loop (cache key includes the theme id so cached sprites for the previous
  // theme stay until LRU eviction).
  const themeRef = useRef(theme)
  useEffect(() => { themeRef.current = theme }, [theme])

  // Keep refs in sync
  useEffect(() => { starsRef.current = stars }, [stars])
  useEffect(() => { clustersRef.current = clusters }, [clusters])
  useEffect(() => { highlightsRef.current = searchHighlights }, [searchHighlights])
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => { neighborStarsRef.current = neighborStars }, [neighborStars])

  const neighborSet = useRef<Set<string>>(new Set())
  useEffect(() => {
    neighborSet.current = new Set(neighborStars.map(n => n.id))
  }, [neighborStars])

  // Trigger pulse on each new search-result set
  useEffect(() => {
    if (searchHighlights.length > 0) {
      searchPulseStart.current = performance.now()
    }
  }, [searchHighlights])

  const clusterMap = useRef<Map<number, Cluster>>(new Map())
  useEffect(() => {
    clusterMap.current = new Map(clusters.map(c => [c.id, c]))
  }, [clusters])

  const highlightSet = useRef<Set<string>>(new Set())
  useEffect(() => {
    highlightSet.current = new Set(searchHighlights.map(r => r.id))
  }, [searchHighlights])

  const starIndex = useRef<Map<string, Star>>(new Map())
  useEffect(() => {
    starIndex.current = new Map(stars.map(s => [s.id, s]))
  }, [stars])

  // Propagate hovered id to parent
  useEffect(() => {
    onHoveredChange?.(hoveredId)
  }, [hoveredId, onHoveredChange])

  // Handle imperative vim actions from useVimMode
  useEffect(() => {
    if (!vimAction) return
    const canvas = canvasRef.current
    const cam = camRef.current
    const currentStars = starsRef.current

    if (vimAction.type === 'pan') {
      const newCam = {
        ...cam,
        cx: cam.cx + vimAction.dx / cam.zoom,
        cy: cam.cy + vimAction.dy / cam.zoom,
      }
      camRef.current = newCam
      setCam(newCam)
      return
    }

    if (vimAction.type === 'zoom') {
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.zoom * vimAction.factor))
      const newCam = { ...cam, zoom: newZoom }
      camRef.current = newCam
      setCam(newCam)
      return
    }

    if (vimAction.type === 'fitAll') {
      if (!canvas || currentStars.length === 0) return
      const w = canvas.clientWidth, h = canvas.clientHeight
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const s of currentStars) {
        if (s.x < minX) minX = s.x
        if (s.x > maxX) maxX = s.x
        if (s.y < minY) minY = s.y
        if (s.y > maxY) maxY = s.y
      }
      const rangeX = maxX - minX || 1
      const rangeY = maxY - minY || 1
      const zoom = Math.min(w / rangeX, h / rangeY) * 0.9
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const newCam = { cx, cy, zoom }
      camRef.current = newCam
      setCam(newCam)
      return
    }

    if (vimAction.type === 'fitCluster') {
      const clusterId = vimAction.clusterId
      const members = currentStars.filter(s => s.clusterId === clusterId)
      if (!canvas || members.length === 0) return
      const w = canvas.clientWidth, h = canvas.clientHeight
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const s of members) {
        if (s.x < minX) minX = s.x
        if (s.x > maxX) maxX = s.x
        if (s.y < minY) minY = s.y
        if (s.y > maxY) maxY = s.y
      }
      const rangeX = (maxX - minX) || 100
      const rangeY = (maxY - minY) || 100
      const zoom = Math.min(w / (rangeX + 80), h / (rangeY + 80), 4)
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const newCam = { cx, cy, zoom }
      camRef.current = newCam
      setCam(newCam)
      return
    }

    if (vimAction.type === 'panTo') {
      // Optional zoom lets callers (e.g. galaxy "fly to") snap to a specific
      // viewing zoom in addition to recentering.
      const z = vimAction.zoom !== undefined
        ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, vimAction.zoom))
        : cam.zoom
      const newCam = { ...cam, cx: vimAction.wx, cy: vimAction.wy, zoom: z }
      camRef.current = newCam
      setCam(newCam)
      return
    }
  }, [vimAction])

  // Fit all stars into view on first load
  useEffect(() => {
    if (stars.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.clientWidth, h = canvas.clientHeight
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const s of stars) {
      if (s.x < minX) minX = s.x
      if (s.x > maxX) maxX = s.x
      if (s.y < minY) minY = s.y
      if (s.y > maxY) maxY = s.y
    }
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const margin = 0.9
    const zoom = Math.min(w / rangeX, h / rangeY) * margin
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const newCam = { cx, cy, zoom }
    setCam(newCam)
    camRef.current = newCam
    onReady?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars.length > 0])

  // Resize canvas to window — backing store is sized in device pixels so the
  // image stays crisp on high-DPR displays. All draw code below operates in
  // CSS-pixel coordinates after we apply the dpr transform per frame.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      dprRef.current = dpr
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Main draw loop
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    // Reset transform each frame so the dpr scale doesn't accumulate, then
    // operate everywhere below in CSS-pixel coordinates.
    const dpr = dprRef.current
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = canvas.width / dpr, h = canvas.height / dpr
    const activeTheme = themeRef.current
    // Opaque clear: backdrop draw + vignette below are not guaranteed to
    // cover the full backing store on resize / DPR change. Without this,
    // stale pixels survive in narrow bands. Theme drives the fill colour
    // (jwst slate, vapor purple, ...).
    ctx.fillStyle = activeTheme.background.canvasFill
    ctx.fillRect(0, 0, w, h)
    const cam = camRef.current
    const currentStars = starsRef.current
    const currentClusters = clustersRef.current
    const currentEdges = edgesRef.current
    const currentNeighbors = neighborStarsRef.current
    const highlights = highlightSet.current
    const neighbors = neighborSet.current
    const hasHighlights = highlights.size > 0
    const hasFocus = hasHighlights || selectedId !== null
    const exposure = exposureFor(cam.zoom)
    const drawScale = zoomDrawScale(cam.zoom)
    const pulseT = Math.min(1, (performance.now() - searchPulseStart.current) / SEARCH_PULSE_MS)
    const pulseScale = pulseT < 1 ? SPRITE_HIGHLIGHT_PULSE * (1 - easeOutCubic(pulseT)) : 0

    // Deep-field backdrop (prerendered: nebulae + faint stars + far galaxies),
    // scaled + panned with parallax so it reads as deeper space behind the stars.
    const backdrop = getBackdrop(w, h)
    const m = getBackdropMultiplier()
    const bgScale = Math.max(BACKDROP_MIN_SCALE, Math.pow(cam.zoom, BACKDROP_ZOOM_PARALLAX))
    const bgTx = -cam.cx * BACKDROP_PAN_PARALLAX * cam.zoom
    const bgTy = -cam.cy * BACKDROP_PAN_PARALLAX * cam.zoom
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.scale(bgScale, bgScale)
    ctx.translate(bgTx, bgTy)
    ctx.drawImage(backdrop, -(w * m) / 2, -(h * m) / 2)
    ctx.restore()

    // Vignette to keep focus toward center
    const vignette = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7)
    vignette.addColorStop(0, 'rgba(0,0,0,0)')
    vignette.addColorStop(1, 'rgba(0,4,12,0.55)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, w, h)

    // Constellation nebulae — multi-stop gradients with subtle elliptical squish per cluster
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (const cluster of currentClusters) {
      if (cluster.centroidX === null || cluster.centroidY === null) continue
      const [sx, sy] = worldToScreen(cluster.centroidX, cluster.centroidY, cam, w, h)
      const intrinsic = Math.sqrt(cluster.memberCount) * 25 * cam.zoom
      const r = Math.sqrt(intrinsic * intrinsic + 20 * 20)  // soft floor near 20 px
      const color = CONSTELLATION_PALETTE[cluster.colorIndex % CONSTELLATION_PALETTE.length]
      const squish = 0.6 + ((cluster.id * 2654435761) >>> 0) % 100 / 250
      const rot = (((cluster.id * 1664525) >>> 0) % 360) * Math.PI / 180
      ctx.globalAlpha = exposure
      ctx.save()
      ctx.translate(sx, sy)
      ctx.rotate(rot)
      ctx.scale(1, squish)
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
      grad.addColorStop(0, color + '33')
      grad.addColorStop(0.25, color + '1f')
      grad.addColorStop(0.6, color + '10')
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()

    // Edges (selected neighborhood only) — additive screen blend for filament feel
    if (currentEdges.length > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.strokeStyle = EDGE_COLOR
      ctx.lineWidth = 1
      const originStar = selectedId ? starIndex.current.get(selectedId) : null
      for (const edge of currentEdges) {
        const src = starIndex.current.get(edge.srcId) ?? (originStar?.id === edge.srcId ? originStar : null)
        const dst = starIndex.current.get(edge.dstId) ?? currentNeighbors.find(n => n.id === edge.dstId) ?? null
        if (!src || !dst) continue
        const [sx, sy] = worldToScreen(src.x, src.y, cam, w, h)
        const [dx, dy] = worldToScreen(dst.x, dst.y, cam, w, h)
        ctx.globalAlpha = edge.weight * 0.55 * exposure
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(dx, dy)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Main star pass — sprite-cached, additive blend so overlapping halos bloom together.
    // Side-channel: record per-star sprite metadata for the decoration pass so it doesn't
    // recompute the sprite + scale twice per frame.
    interface DrawnSprite { sprite: HTMLCanvasElement; sx: number; sy: number; drawW: number; drawH: number }
    const drawnByFocusId = new Map<string, DrawnSprite>()

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const star of currentStars) {
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      const isHighlighted = highlights.has(star.id)
      const isSelected = star.id === selectedId
      const isNeighbor = neighbors.has(star.id)
      // Neighbors and selected star bypass the cull: their sprites peek in from the canvas
      // edge as you zoom. Canvas clips naturally; off-screen draws are near-free.
      if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) {
        if (!isNeighbor && !isSelected) continue
      }
      const dimAlpha = hasFocus && !isHighlighted && !isSelected && !isNeighbor ? DIM_ALPHA : 1
      ctx.globalAlpha = dimAlpha * exposure

      const sb = sizeBucketFor(star.viewCount)
      let sprite: HTMLCanvasElement
      const effectiveType = star.starType ?? defaultStarType(star.name, star.mimeType, star.category)
      if (effectiveType) {
        sprite = getTypedStarSprite(activeTheme, effectiveType, sb, star.id)
      } else {
        const cluster = star.clusterId !== null ? clusterMap.current.get(star.clusterId) : null
        const colorIndex = cluster ? cluster.colorIndex : -1
        const tb = tempBucketFor(star.id)
        sprite = getStarSprite(colorIndex, tb, sb)
      }
      const sw = sprite.width, sh = sprite.height
      let scale = drawScale
      if (star.id === hoveredId) scale *= SPRITE_HOVER_SCALE
      if (isHighlighted) scale *= SPRITE_HIGHLIGHT_SCALE + pulseScale
      if (isNeighbor && !isSelected) scale *= SPRITE_NEIGHBOR_SCALE
      if (isSelected) scale *= SPRITE_SELECTED_SCALE
      const drawW = sw * scale, drawH = sh * scale
      ctx.drawImage(sprite, sx - drawW / 2, sy - drawH / 2, drawW, drawH)
      if (isSelected || isHighlighted || isNeighbor) {
        drawnByFocusId.set(star.id, { sprite, sx, sy, drawW, drawH })
      }
    }
    ctx.restore()

    // Animation overlay — pulsar rotating beam + quasar jet flicker. Cardinality is small.
    const tNow = performance.now() / 1000
    for (const star of currentStars) {
      const animType = star.starType ?? defaultStarType(star.name, star.mimeType, star.category)
      if (animType !== 'pulsar' && animType !== 'quasar') continue
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) continue

      const sb = sizeBucketFor(star.viewCount)
      const r = spriteCoreRadius(sb)
      const phaseOffset = (hashStr(star.id) % 1000) / 1000

      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = exposure

      if (animType === 'pulsar') {
        const angle = (tNow * 0.7 + phaseOffset) * Math.PI * 2
        const reach = r * 6
        const dx = Math.cos(angle) * reach
        const dy = Math.sin(angle) * reach
        const grad = ctx.createLinearGradient(sx - dx, sy - dy, sx + dx, sy + dy)
        grad.addColorStop(0, 'rgba(180,220,255,0)')
        grad.addColorStop(0.45, 'rgba(220,235,255,0.55)')
        grad.addColorStop(0.5, 'rgba(255,255,255,0.95)')
        grad.addColorStop(0.55, 'rgba(220,235,255,0.55)')
        grad.addColorStop(1, 'rgba(180,220,255,0)')
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(sx - dx, sy - dy)
        ctx.lineTo(sx + dx, sy + dy)
        ctx.stroke()
      } else {
        // quasar: two opposing jets shimmering on a vertical-ish axis with mild precession
        const baseAngle = Math.PI / 2 + Math.sin((tNow * 0.3 + phaseOffset) * Math.PI * 2) * 0.12
        const reach = r * 5
        const flicker = 0.55 + 0.4 * Math.sin((tNow * 1.7 + phaseOffset) * Math.PI * 2)
        const dx = Math.cos(baseAngle) * reach
        const dy = Math.sin(baseAngle) * reach
        const grad = ctx.createLinearGradient(sx - dx, sy - dy, sx + dx, sy + dy)
        grad.addColorStop(0, `rgba(180,140,255,0)`)
        grad.addColorStop(0.5, `rgba(255,210,255,${flicker})`)
        grad.addColorStop(1, `rgba(180,140,255,0)`)
        ctx.strokeStyle = grad
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(sx - dx, sy - dy)
        ctx.lineTo(sx + dx, sy + dy)
        ctx.stroke()
      }

      ctx.restore()
    }

    // Decoration pass — additive sprite re-draw (selected) + warm-white selection ring +
    // gold ring (highlighted) + cyan ring (neighbors). No solid fills; the typed sprite
    // stays the visual identity at every zoom.
    if (hasFocus) {
      ctx.save()
      for (const star of currentStars) {
        const isHighlighted = highlights.has(star.id)
        const isSelected = star.id === selectedId
        const isNeighbor = neighbors.has(star.id)
        if (!isHighlighted && !isSelected && !isNeighbor) continue
        const drawn = drawnByFocusId.get(star.id)
        if (!drawn) continue  // off-screen + not selected/neighbor — main pass culled
        const { sprite, sx, sy, drawW, drawH } = drawn

        const sb = sizeBucketFor(star.viewCount)
        let scaleR = drawScale
        if (isHighlighted) scaleR *= SPRITE_HIGHLIGHT_SCALE + pulseScale
        if (isNeighbor && !isSelected) scaleR *= SPRITE_NEIGHBOR_SCALE
        if (isSelected) scaleR *= SPRITE_SELECTED_SCALE
        const r = spriteCoreRadius(sb) * scaleR

        if (isSelected) {
          // Brightness boost: redraw the cached sprite once more in additive mode so
          // the whole halo + core gets +alpha without any solid-color overlay.
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = SPRITE_SELECTED_BOOST_ALPHA * exposure
          ctx.drawImage(sprite, sx - drawW / 2, sy - drawH / 2, drawW, drawH)

          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = SELECTED_RING_COLOR
          ctx.lineWidth = 2.5
          ctx.globalAlpha = 0.95
          ctx.beginPath()
          ctx.arc(sx, sy, r + 6, 0, Math.PI * 2)
          ctx.stroke()
        }

        if (isNeighbor && !isSelected) {
          // Brightness boost: same additive sprite re-draw treatment as the selected
          // star, lower alpha so the selected one still wins. Keeps neighbors as bright
          // as the selected at every zoom level — without them, the selected star's
          // halo dominates at high exposure and neighbors fade into the background.
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = SPRITE_NEIGHBOR_BOOST_ALPHA * exposure
          ctx.drawImage(sprite, sx - drawW / 2, sy - drawH / 2, drawW, drawH)

          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = NEIGHBOR_RING_COLOR
          ctx.lineWidth = 1.5
          ctx.globalAlpha = 0.85
          ctx.beginPath()
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2)
          ctx.stroke()
        }

        if (isHighlighted) {
          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = HIGHLIGHT_COLOR
          ctx.lineWidth = 2
          ctx.globalAlpha = 0.85
          ctx.beginPath()
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // F11 — theme overlay (scanlines, Tron grid, etc.). Sits ON TOP of the
    // sky and underneath the HUD layer (chevrons, lock glyphs, labels) so
    // chrome stays legible on noisy themes like vapor.
    if (activeTheme.background.overlay) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      activeTheme.background.overlay(ctx, w, h)
      ctx.restore()
    }

    // Off-screen neighbor markers — draw a chevron at the canvas edge for each
    // neighbor whose center is outside the viewport, pointing toward it.
    if (selectedId && currentNeighbors.length > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = NEIGHBOR_RING_COLOR
      for (const n of currentNeighbors) {
        // Prefer coords from the main star index (always valid); neighborhood
        // endpoint may return null x/y for not-yet-projected stars.
        const canonical = starIndex.current.get(n.id) ?? n
        const [nx, ny] = worldToScreen(canonical.x, canonical.y, cam, w, h)
        if (!isFinite(nx) || !isFinite(ny)) continue
        if (nx >= 0 && nx <= w && ny >= 0 && ny <= h) continue
        const m = canvasEdgeIntersection(w / 2, h / 2, nx, ny, w, h, 16)
        const angle = Math.atan2(ny - h / 2, nx - w / 2)
        drawChevron(ctx, m.x, m.y, angle, 10)
      }
      ctx.restore()
    }

    // F4 — pinned-star lock glyph at high zoom. Cheap text glyph above the
    // sprite, only when zoomed in enough that the user can see it (low zoom
    // would be visual clutter).
    if (cam.zoom > 1.5) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.font = '14px monospace'
      ctx.fillStyle = '#ffe066'
      ctx.globalAlpha = 0.85
      ctx.textAlign = 'center'
      for (const star of currentStars) {
        if (!star.isPinned) continue
        const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
        if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) continue
        const r = spriteCoreRadius(sizeBucketFor(star.viewCount)) * drawScale
        ctx.fillText('\u{1F512}', sx, sy - r - 6)
      }
      ctx.textAlign = 'start'
      ctx.restore()
    }

    // F4 — pin-drag preview: dashed line from the natural position to the
    // current cursor + a faint sprite at the cursor so the user can see
    // where they're aiming.
    const drag = pinDrag.current
    if (drag) {
      const star = currentStars.find(s => s.id === drag.id)
      if (star) {
        const [nx, ny] = worldToScreen(star.x, star.y, cam, w, h)
        const [tx, ty] = worldToScreen(drag.worldX, drag.worldY, cam, w, h)
        ctx.save()
        ctx.globalCompositeOperation = 'source-over'
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = '#ffe066'
        ctx.globalAlpha = 0.6
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(nx, ny)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        ctx.setLineDash([])
        const sb = sizeBucketFor(star.viewCount)
        const effectiveType = star.starType ?? defaultStarType(star.name, star.mimeType, star.category)
        let sprite: HTMLCanvasElement
        if (effectiveType) {
          sprite = getTypedStarSprite(activeTheme, effectiveType, sb, star.id)
        } else {
          const cluster = star.clusterId !== null ? clusterMap.current.get(star.clusterId) : null
          const colorIndex = cluster ? cluster.colorIndex : -1
          const tb = tempBucketFor(star.id)
          sprite = getStarSprite(colorIndex, tb, sb)
        }
        const sw = sprite.width, sh = sprite.height
        const previewScale = drawScale * SPRITE_SELECTED_SCALE
        const drawW = sw * previewScale, drawH = sh * previewScale
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.7 * exposure
        ctx.drawImage(sprite, tx - drawW / 2, ty - drawH / 2, drawW, drawH)
        ctx.restore()
      }
    }

    // Labels — alpha tapers smoothly from zoom 0.8 upward; no hard cutoff.
    ctx.save()
    for (const star of currentStars) {
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) continue

      const isHovered = star.id === hoveredId
      const isHighlighted = highlights.has(star.id)
      const isSelected = star.id === selectedId
      const isNeighbor = neighbors.has(star.id)
      const focusAlpha = hasFocus && !isHighlighted && !isSelected && !isNeighbor ? DIM_ALPHA : 1
      const zoomAlpha = isHovered ? 1 : Math.max(0, Math.min(1, (cam.zoom - 0.8) * 2))
      const alpha = focusAlpha * zoomAlpha
      if (alpha < 0.05) continue

      const r = spriteCoreRadius(sizeBucketFor(star.viewCount)) * drawScale
      ctx.fillStyle = '#c8dff5'
      ctx.font = `${Math.min(11, 8 + cam.zoom * 1.5)}px monospace`
      ctx.globalAlpha = alpha
      const name = star.name.replace(/\.[^.]+$/, '')
      ctx.fillText(name, sx + r + 4, sy + 4)
    }
    ctx.restore()
  }, [hoveredId, selectedId])

  // Animate
  useEffect(() => {
    const loop = () => {
      draw()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [draw])

  // Animate camera to bounding box of search results
  const prevSearchHighlights = useRef<SearchResult[]>([])
  useEffect(() => {
    if (searchHighlights.length === 0) {
      prevSearchHighlights.current = []
      return
    }
    if (searchHighlights === prevSearchHighlights.current) return
    prevSearchHighlights.current = searchHighlights

    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.clientWidth, h = canvas.clientHeight

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const r of searchHighlights) {
      if (r.x < minX) minX = r.x; if (r.x > maxX) maxX = r.x
      if (r.y < minY) minY = r.y; if (r.y > maxY) maxY = r.y
    }
    const rangeX = (maxX - minX) || 100
    const rangeY = (maxY - minY) || 100
    const targetZoom = Math.min(w / (rangeX + 100), h / (rangeY + 100), 4)
    const targetCx = (minX + maxX) / 2
    const targetCy = (minY + maxY) / 2

    // Animate over 600ms
    const startCam = { ...camRef.current }
    const startTime = performance.now()
    const duration = 600

    function easeInOut(t: number): number {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    }

    function animateCamera() {
      const elapsed = performance.now() - startTime
      const t = Math.min(elapsed / duration, 1)
      const e = easeInOut(t)
      const newCam = {
        cx: startCam.cx + (targetCx - startCam.cx) * e,
        cy: startCam.cy + (targetCy - startCam.cy) * e,
        zoom: startCam.zoom + (targetZoom - startCam.zoom) * e,
      }
      camRef.current = newCam
      setCam(newCam)
      if (t < 1) requestAnimationFrame(animateCamera)
    }
    requestAnimationFrame(animateCamera)
  }, [searchHighlights])

  // Mouse events
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // F4 — Shift + mousedown on a hovered star starts pinning. Plain drag
    // continues to pan the camera; the Shift modifier is the only signal we
    // need (no click-vs-drag threshold).
    if (e.shiftKey && hoveredId && onPinFile) {
      const canvas = canvasRef.current
      if (canvas) {
        const w = canvas.clientWidth, h = canvas.clientHeight
        const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
        pinDrag.current = { id: hoveredId, worldX: wx, worldY: wy }
        lastMouse.current = { x: e.clientX, y: e.clientY }
        return
      }
    }
    isDragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [hoveredId, onPinFile])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.clientWidth, h = canvas.clientHeight

    // F4 — pin-drag in progress: live-update the target world position.
    if (pinDrag.current) {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
      pinDrag.current = { ...pinDrag.current, worldX: wx, worldY: wy }
      lastMouse.current = { x: e.clientX, y: e.clientY }
      return
    }

    if (isDragging.current) {
      const dx = e.clientX - lastMouse.current.x
      const dy = e.clientY - lastMouse.current.y
      lastMouse.current = { x: e.clientX, y: e.clientY }
      const newCam = {
        ...camRef.current,
        cx: camRef.current.cx - dx / camRef.current.zoom,
        cy: camRef.current.cy - dy / camRef.current.zoom,
      }
      camRef.current = newCam
      setCam(newCam)
      return
    }

    // Hover detection
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
    let closest: string | null = null
    let closestDist = 25 / camRef.current.zoom  // pick radius in world units

    for (const star of starsRef.current) {
      const dx = star.x - wx, dy = star.y - wy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < closestDist) {
        closestDist = dist
        closest = star.id
      }
    }

    setHoveredId(closest)
    if (closest) setHoverPos({ x: e.clientX, y: e.clientY })
  }, [])

  const handleMouseUp = useCallback(() => {
    if (pinDrag.current && onPinFile) {
      const { id, worldX, worldY } = pinDrag.current
      onPinFile(id, worldX, worldY)
      pinDrag.current = null
      return
    }
    isDragging.current = false
  }, [onPinFile])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (Math.abs(e.clientX - lastMouse.current.x) > 3 || Math.abs(e.clientY - lastMouse.current.y) > 3) return
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.clientWidth, h = canvas.clientHeight
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)

    let clicked: string | null = null
    let closestDist = 20 / camRef.current.zoom

    for (const star of starsRef.current) {
      const dx = star.x - wx, dy = star.y - wy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < closestDist) {
        closestDist = dist
        clicked = star.id
      }
    }

    onSelect(clicked)
  }, [onSelect])

  // Fetch neighborhood whenever the externally-controlled selection changes
  useEffect(() => {
    if (!selectedId) {
      setEdges([])
      setNeighborStars([])
      return
    }
    let cancelled = false
    fetchNeighborhood(selectedId).then(hood => {
      if (cancelled) return
      setEdges(edgeFromNeighborhood(selectedId, hood.neighbors))
      setNeighborStars(hood.neighbors.map(n => n.file))
    }).catch(() => {
      if (cancelled) return
      setEdges([])
      setNeighborStars([])
    })
    return () => { cancelled = true }
  }, [selectedId])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.clientWidth, h = canvas.clientHeight
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camRef.current.zoom * factor))
    // Zoom towards cursor
    const newCam = {
      cx: wx - (e.clientX - w / 2) / newZoom,
      cy: wy - (e.clientY - h / 2) / newZoom,
      zoom: newZoom,
    }
    camRef.current = newCam
    setCam(newCam)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.addEventListener('wheel', handleWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  // F4 — Esc cancels an in-progress pin-drag. Capture phase + stopImmediate
  // so vim's Escape (which clears selection + search) doesn't fire on the
  // same press. If no drag is live, the event passes through untouched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pinDrag.current) {
        pinDrag.current = null
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const hoveredStar = hoveredId ? starIndex.current.get(hoveredId) ?? null : null
  const hoveredCluster = hoveredStar?.clusterId !== null && hoveredStar?.clusterId !== undefined
    ? clusterMap.current.get(hoveredStar.clusterId) ?? null
    : null

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: isDragging.current ? 'grabbing' : (hoveredId ? 'crosshair' : 'grab') }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />
      {hoveredStar && !isDragging.current && hoveredStar.id !== selectedId && (
        <HoverCard
          star={hoveredStar}
          position={hoverPos}
          clusterSize={hoveredCluster?.memberCount ?? null}
          clusterColorIndex={hoveredCluster?.colorIndex ?? null}
        />
      )}
    </>
  )
}
