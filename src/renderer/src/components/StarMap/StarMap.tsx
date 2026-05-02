import { useRef, useEffect, useCallback, useState } from 'react'
import type { Star, Cluster, SearchResult, Edge } from '@shared/types'
import { CONSTELLATION_PALETTE } from '@shared/types'
import { fetchNeighborhood, edgeFromNeighborhood, openFile } from '../../api'
import HoverCard from '../HoverCard/HoverCard'
import {
  getStarSprite,
  sizeBucketFor,
  tempBucketFor,
  spriteCoreRadius,
} from './sprites'
import { getBackdrop } from './background'

interface Camera {
  cx: number  // world x at canvas center
  cy: number  // world y at canvas center
  zoom: number
}

interface Props {
  stars: Star[]
  clusters: Cluster[]
  searchHighlights: SearchResult[]  // highlighted from search
  onReady?: () => void
}

const HIGHLIGHT_COLOR = '#ffe066'
const EDGE_COLOR = 'rgba(120, 180, 255, 0.45)'
const DIM_ALPHA = 0.25
const SPRITE_HOVER_SCALE = 1.35
const CULL_MARGIN = 48

function worldToScreen(wx: number, wy: number, cam: Camera, w: number, h: number): [number, number] {
  return [(wx - cam.cx) * cam.zoom + w / 2, (wy - cam.cy) * cam.zoom + h / 2]
}

function screenToWorld(sx: number, sy: number, cam: Camera, w: number, h: number): [number, number] {
  return [(sx - w / 2) / cam.zoom + cam.cx, (sy - h / 2) / cam.zoom + cam.cy]
}

export default function StarMap({ stars, clusters, searchHighlights, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cam, setCam] = useState<Camera>({ cx: 0, cy: 0, zoom: 1 })
  const camRef = useRef<Camera>(cam)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  // Keep refs in sync
  useEffect(() => { starsRef.current = stars }, [stars])
  useEffect(() => { clustersRef.current = clusters }, [clusters])
  useEffect(() => { highlightsRef.current = searchHighlights }, [searchHighlights])
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => { neighborStarsRef.current = neighborStars }, [neighborStars])

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

  // Fit all stars into view on first load
  useEffect(() => {
    if (stars.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width, h = canvas.height
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

  // Resize canvas to window
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
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
    const w = canvas.width, h = canvas.height
    const cam = camRef.current
    const currentStars = starsRef.current
    const currentClusters = clustersRef.current
    const currentEdges = edgesRef.current
    const currentNeighbors = neighborStarsRef.current
    const highlights = highlightSet.current
    const hasHighlights = highlights.size > 0

    // Deep-field backdrop (prerendered: nebulae + faint stars + far galaxies)
    const backdrop = getBackdrop(w, h)
    ctx.drawImage(backdrop, 0, 0)

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
      const r = Math.max(40, Math.sqrt(cluster.memberCount) * 25 * cam.zoom)
      const color = CONSTELLATION_PALETTE[cluster.colorIndex % CONSTELLATION_PALETTE.length]
      // Deterministic squish + rotation from cluster id
      const squish = 0.6 + ((cluster.id * 2654435761) >>> 0) % 100 / 250
      const rot = (((cluster.id * 1664525) >>> 0) % 360) * Math.PI / 180
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
        ctx.globalAlpha = edge.weight * 0.55
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(dx, dy)
        ctx.stroke()
      }
      ctx.restore()
    }

    // Main star pass — sprite-cached, additive blend so overlapping halos bloom together
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const star of currentStars) {
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) continue

      const isHighlighted = highlights.has(star.id)
      const alpha = hasHighlights && !isHighlighted ? DIM_ALPHA : 1
      ctx.globalAlpha = alpha

      const cluster = star.clusterId !== null ? clusterMap.current.get(star.clusterId) : null
      const colorIndex = cluster ? cluster.colorIndex : -1
      const sb = sizeBucketFor(star.viewCount)
      const tb = tempBucketFor(star.id)
      const sprite = getStarSprite(colorIndex, tb, sb)
      const sw = sprite.width, sh = sprite.height
      const scale = star.id === hoveredId ? SPRITE_HOVER_SCALE : 1
      const drawW = sw * scale, drawH = sh * scale
      ctx.drawImage(sprite, sx - drawW / 2, sy - drawH / 2, drawW, drawH)
    }
    ctx.restore()

    // Decoration pass — gold rings (highlighted) + bright white core (selected). Small cardinality.
    if (hasHighlights || selectedId) {
      ctx.save()
      for (const star of currentStars) {
        const isHighlighted = highlights.has(star.id)
        const isSelected = star.id === selectedId
        if (!isHighlighted && !isSelected) continue
        const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
        if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) continue

        const sb = sizeBucketFor(star.viewCount)
        const r = spriteCoreRadius(sb)

        if (isSelected) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = 0.9
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(sx, sy, r * 0.65, 0, Math.PI * 2)
          ctx.fill()
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

    // Labels — only when zoomed in or hovered
    ctx.save()
    for (const star of currentStars) {
      const isHovered = star.id === hoveredId
      if (cam.zoom <= 1.5 && !isHovered) continue
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      if (sx < -CULL_MARGIN || sx > w + CULL_MARGIN || sy < -CULL_MARGIN || sy > h + CULL_MARGIN) continue

      const isHighlighted = highlights.has(star.id)
      const alpha = hasHighlights && !isHighlighted ? DIM_ALPHA : 1
      if (alpha <= 0.5) continue

      const r = spriteCoreRadius(sizeBucketFor(star.viewCount))
      ctx.fillStyle = '#c8dff5'
      ctx.font = `${Math.min(11, 8 + cam.zoom * 1.5)}px monospace`
      ctx.globalAlpha = Math.min(1, (cam.zoom - 0.8) * 2) * alpha
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
    const w = canvas.width, h = canvas.height

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
    isDragging.current = true
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width, h = canvas.height

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
    isDragging.current = false
  }, [])

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    if (Math.abs(e.clientX - lastMouse.current.x) > 3 || Math.abs(e.clientY - lastMouse.current.y) > 3) return
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width, h = canvas.height
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

    if (clicked) {
      setSelectedId(clicked)
      try {
        const hood = await fetchNeighborhood(clicked)
        setEdges(edgeFromNeighborhood(clicked, hood.neighbors))
        setNeighborStars(hood.neighbors.map(n => n.file))
      } catch {
        setEdges([])
        setNeighborStars([])
      }
    } else {
      setSelectedId(null)
      setEdges([])
      setNeighborStars([])
    }
  }, [])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const w = canvas.width, h = canvas.height
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
    const newZoom = Math.max(0.05, Math.min(10, camRef.current.zoom * factor))
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
      {hoveredStar && !isDragging.current && (
        <HoverCard
          star={hoveredStar}
          position={hoverPos}
          clusterSize={hoveredCluster?.memberCount ?? null}
          clusterColorIndex={hoveredCluster?.colorIndex ?? null}
          onOpen={() => openFile(hoveredStar.id).catch(console.error)}
        />
      )}
    </>
  )
}
