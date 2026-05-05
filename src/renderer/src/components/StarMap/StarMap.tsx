import { useRef, useEffect, useCallback, useState } from 'react'
import type { Star, Cluster, SearchResult, Edge, StarType } from '@shared/types'
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
  spriteCacheStats,
  setSpriteCacheActiveTheme,
  setSpriteCacheDpr,
  spriteLogicalSize,
  resetTypedBakeBudget,
} from './sprites'
import { defaultJitterFor } from './proc'
import { drawChromaticAberration } from './vaporCrt'
import { getBackdrop, getBackdropMultiplier } from './background'
import { defaultStarType } from './autoStarType'
import { usageStarType, type PercentileBuckets } from './usageStarType'
import { worldToScreen, screenToWorld, type Camera } from './coords'
import { buildSpatialGrid, forEachStarInBounds, type SpatialGrid } from './spatialGrid'
import { convexHull, type Pt } from './convexHull'
import { frameMetrics } from '../../lib/frameMetrics'
import type { Lod } from './sprites'
import type { VimAction } from '../../hooks/useVimMode'
import type { Theme } from '../../themes/types'
import type { ClassificationMode } from '../../hooks/useClassificationMode'

// F5 — active virtual collection. When set, members render at full
// brightness with a constellation-style hull behind them; non-members
// dim to DIM_ALPHA exactly like a search-active state.
export interface ActiveCollectionVis {
  color: string
  memberIds: Set<string>
}

// B3 — experiment preview overlay. When set, the renderer treats `ids`
// like a position override: each affected star draws at the supplied
// (x, y) instead of its persisted coords, and gets a tinted halo ring
// so the user knows the star is in experimental territory. `positions`
// uses world coordinates relative to the same origin the daemon uses
// for production positions (no galaxy-offset adjustment is performed
// inside StarMap; App-level code must apply that before passing in,
// matching how `stars` already arrive).
export interface ExperimentPreviewVis {
  ids: Set<string>
  positions: Map<string, [number, number]>
  color: string
}

// Drawn-sprite metadata recorded during the main star pass and replayed
// by the decoration pass. Hoisted out of `draw()` so the ref-stored
// per-frame Map can carry the type without a generic cast.
interface DrawnSprite {
  sprite: HTMLCanvasElement
  sx: number
  sy: number
  drawW: number
  drawH: number
  rotation: number | null
}

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
  // F10 — classification mode + precomputed corpus percentile buckets. When
  // mode === 'usage' the renderer routes through usageStarType for the
  // effective type and uses importance_score as the size driver. Both are
  // optional so existing call sites still compile.
  classMode?: ClassificationMode
  percentileBuckets?: PercentileBuckets
  // F4 — Shift+mousedown on a hovered star starts a drag-to-pin gesture; on
  // release we fire this callback. Optional so existing call sites compile
  // before App.tsx wires it up.
  onPinFile?: (id: string, worldX: number, worldY: number) => void
  // F5 — when non-null, members are highlighted (full alpha + scale) and a
  // convex-hull outline is drawn behind them in the collection's color.
  // Non-members are dimmed exactly like search-active state.
  activeCollection?: ActiveCollectionVis | null
  // B3 — preview overlay for an embedding experiment. See
  // ExperimentPreviewVis above for shape semantics.
  experimentPreview?: ExperimentPreviewVis | null
}

// F5 — hull rendering constants. Fill alpha is intentionally low so the
// stars inside read clearly; the stroke does most of the visual work.
const COLLECTION_HULL_FILL_ALPHA = 0.12
const COLLECTION_HULL_STROKE_ALPHA = 0.35
const COLLECTION_HULL_STROKE_WIDTH = 1.5
// Pad the hull a touch outward so stars at the boundary aren't visually
// clipped by the stroke. Computed in screen pixels at draw time.
const COLLECTION_HULL_INFLATE_PX = 12

// Helper: replace alpha on a "#rrggbb" hex with the supplied 0..1 alpha.
// Falls back to the rgba() form when the input isn't 7-char hex (defensive
// — palette entries are all hex but a future theme could pass anything).
function withAlpha(hex: string, alpha: number): string {
  if (hex.length === 7 && hex[0] === '#') {
    const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
    return `${hex}${a}`
  }
  return `rgba(0,0,0,${alpha})`
}

// Move each hull vertex outward from the polygon centroid by `pad` pixels.
// Cheap centroid-based inflate; good enough for the loose visual padding the
// collection outline needs.
function inflateHull(hull: Pt[], padPx: number): Pt[] {
  if (hull.length < 3 || padPx <= 0) return hull
  let cx = 0, cy = 0
  for (const [x, y] of hull) { cx += x; cy += y }
  cx /= hull.length
  cy /= hull.length
  return hull.map(([x, y]): Pt => {
    const dx = x - cx, dy = y - cy
    const len = Math.hypot(dx, dy)
    if (len < 1e-3) return [x, y]
    return [x + (dx / len) * padPx, y + (dy / len) * padPx]
  })
}

// F10 — resolve the effective StarType for a star given the active mode +
// percentile buckets. Manual override always wins; type-mode falls through
// to the F2 extension classifier; usage-mode buckets via importance_score.
// Returns null only when neither path nominates a type (cluster-hue path).
function effectiveStarType(
  star: Star,
  mode: ClassificationMode,
  buckets: PercentileBuckets | undefined,
): StarType | null {
  if (star.starType) return star.starType
  if (mode === 'usage' && buckets) {
    return usageStarType(star.importanceScore ?? 0, buckets)
  }
  // type mode (or usage mode with no buckets yet) → F2 default
  return defaultStarType(star.name, star.mimeType)
}

// F10 — usage-mode size mapping. Replaces sizeBucketFor(viewCount) so a
// frequently-touched file looks bigger. Uses the same bucket count as
// view-count-driven sizing (0..4) so cached sprites stay reusable. Tier
// thresholds are deliberately coarse — micro-flicker on small score drift
// would be visually noisy.
function sizeBucketForImportance(score: number): number {
  if (score < 1) return 0
  if (score < 5) return 1
  if (score < 12) return 2
  if (score < 25) return 3
  return 4
}

// F11 — search-highlight + pin glyph + pin-drag preview now read the active
// theme accent from `activeTheme.ui.accentColor` per-frame so flipping themes
// recolors the chrome instantly. Selection ring + neighbor ring stay
// constant — they're functional state markers, not theme accents.
const NEIGHBOR_RING_COLOR = 'rgba(140, 200, 255, 0.85)'
const SELECTED_RING_COLOR = '#fff4d0'  // warm white, distinct from accent + cyan
const EDGE_COLOR = 'rgba(120, 180, 255, 0.45)'
const DIM_ALPHA = 0.08
const SPRITE_HOVER_SCALE = 1.35
const SPRITE_HIGHLIGHT_SCALE = 1.4
const SPRITE_HIGHLIGHT_PULSE = 0.35  // extra scale at pulse peak
const SPRITE_SELECTED_SCALE = 1.4
// F12 — selection breathes via a 1.5s sine wave on both scale and additive alpha,
// so the selected star reads as alive instead of static. Pin-drag preview keeps
// the static SPRITE_SELECTED_SCALE (a brief preview shouldn't pulse).
const SELECTION_PULSE_PERIOD_MS = 1500
const SELECTION_PULSE_AMPL = 0.06        // ±6% scale oscillation
const SELECTION_BOOST_ALPHA_BASE = 0.45
const SELECTION_BOOST_ALPHA_AMPL = 0.15  // 0.30 .. 0.60 range
function selectionPulse(tNowMs: number): number {
  return 1 + Math.sin((tNowMs / SELECTION_PULSE_PERIOD_MS) * Math.PI * 2) * SELECTION_PULSE_AMPL
}
function selectionBoostAlpha(tNowMs: number): number {
  return SELECTION_BOOST_ALPHA_BASE + Math.sin((tNowMs / SELECTION_PULSE_PERIOD_MS) * Math.PI * 2) * SELECTION_BOOST_ALPHA_AMPL
}
const SPRITE_NEIGHBOR_SCALE = 1.6
const SPRITE_NEIGHBOR_BOOST_ALPHA = 0.35  // smaller pop than selected, so neighbors stay visible without competing
const SEARCH_PULSE_MS = 200
// Cull margin scales with drawScale because procedural sprites (F8a + F11)
// can render up to ~150px from their center at base scale. At max draw
// scale (4×), a star's halo can reach ~600px outside the viewport edge —
// so the margin must grow with the on-screen sprite size or stars vanish
// at high zoom even though they should still be visible.
const MIN_CULL_MARGIN = 48
const MAX_SPRITE_HALF = 150  // largest sprite half-width across all theme drawers
function cullMarginFor(drawScale: number): number {
  return Math.max(MIN_CULL_MARGIN, MAX_SPRITE_HALF * drawScale)
}
const ZOOM_MAX = 100
const ZOOM_MIN = 0.05

// Backdrop parallax: deep-field image scales + pans with the camera at sub-unity
// rates so it feels deeper than the indexed star layer.
const BACKDROP_ZOOM_PARALLAX = 0.4   // backdrop zooms ~40% as much as foreground (gentle gamma)
const BACKDROP_PAN_PARALLAX = 0.3    // backdrop pans 30% of camera pan
const BACKDROP_MIN_SCALE = 0.5       // clamp so the 2× canvas always fills the viewport

// Zoom-aware exposure: dim when zoomed out, brighten when zoomed in.
// F15 — exposure ceiling lowered (1.6 → 1.1) so additive halos stop drowning
// the per-instance procedural artwork (red giant mottling, nebula FBM washes,
// neutron-star nucleus dots, etc.). Floor raised (0.3 → 0.45) so deep-zoom-out
// sprites stay visible while interior detail starts to read.
const EXPOSURE_REF_ZOOM = 1.0
// F-NEXT-B — exposure floor raised 0.45 → 0.6 to restore foreground contrast
// once the new tighter halo grading + reduced vignette stop pulling brightness
// out of the disc. Ceiling stays at 1.1 (F15).
const EXPOSURE_MIN = 0.6
const EXPOSURE_MAX = 1.1
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

export default function StarMap({ stars, clusters, searchHighlights, selectedId, onSelect, onReady, vimAction, onHoveredChange, theme, classMode, percentileBuckets, onPinFile, activeCollection, experimentPreview }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Camera is intentionally NOT React state. During pan, native mousemove
  // dispatches at 60–120 Hz; if every move called setState, React would
  // schedule and reconcile a re-render per move (rAF_gap mean ≈ 24 ms,
  // p99 125 ms in profiling). All consumers (rAF draw loop, vim
  // dispatcher, search auto-pan animation) read `camRef.current` directly.
  const camRef = useRef<Camera>({ cx: 0, cy: 0, zoom: 1 })
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
  // Spatial grid bucketed by world position. Built once per `stars` mutation
  // so the draw loop can iterate only the cells inside the camera viewport
  // instead of scanning every star four times per frame. Sized cells = 100
  // world units; see `spatialGrid.ts`.
  const gridRef = useRef<SpatialGrid>(buildSpatialGrid(stars))
  // Pre-derived lists so per-frame work is O(animated) and O(pinned) instead
  // of O(N) scans inside the rAF loop. Refreshed in the `stars` useEffect.
  const animatedStarsRef = useRef<Star[]>([])
  const pinnedStarsRef = useRef<Star[]>([])
  // O(1) neighbor lookup for the edge pass — replaces a per-edge linear
  // `currentNeighbors.find(...)` scan that was O(neighbors × edges).
  const neighborStarMapRef = useRef<Map<string, Star>>(new Map())
  // Per-id memoised temp-bucket and default-jitter results so we don't
  // re-hash the star id on every visible frame. Same key space as the sprite
  // cache; cleared when `stars` mutates so id collisions are impossible.
  const tempBucketCacheRef = useRef<Map<string, number>>(new Map())
  const jitterCacheRef = useRef<Map<string, ReturnType<typeof defaultJitterFor>>>(new Map())
  // Dirty-flag rAF gate. true means the next frame must redraw; set by every
  // state-or-cam change that affects the visible image. Continuous animations
  // (selection pulse, search pulse, pulsar/quasar beams, pin-drag, vim pan
  // velocity) bypass the gate via `needsContinuousRedraw()` below.
  const dirtyRef = useRef<boolean>(true)
  const lastCamSnapRef = useRef<Camera>({ cx: NaN, cy: NaN, zoom: NaN })
  // Frame-metrics support: visible-star count from the most recent draw and
  // the wheel-event timestamp (so the metric loop can mark a frame as
  // "interacting" for ~200 ms after a wheel scroll).
  const lastVisibleCountRef = useRef<number>(0)
  const lastWheelTsRef = useRef<number>(0)
  // Count of pulsar/quasar stars actually inside the viewport on the most
  // recent draw. The rAF gate uses this (not animatedStarsRef.current.length)
  // to decide whether to force a continuous redraw — otherwise a single PDF
  // or PPTX anywhere in the corpus pins the gate open forever, defeating the
  // skip path. Initialised conservatively to corpus-total so the very first
  // frame after stars load still draws; refined to viewport-actual after the
  // first paint.
  const visibleAnimatedCountRef = useRef<number>(0)
  // Per-frame collections hoisted to refs so the rAF loop doesn't allocate
  // a fresh Map / Set per frame. `.clear()` at top of draw() instead of
  // `new`. Phase 1.3 — at 6.9k visible stars this trims ~5 MB / s of
  // nursery churn off the hot path.
  const drawnByFocusIdRef = useRef<Map<string, DrawnSprite>>(new Map())
  const drawnIdsRef = useRef<Set<string>>(new Set())
  const focusIdsRef = useRef<Set<string>>(new Set())
  const labelDrawnRef = useRef<Set<string>>(new Set())
  // Vignette gradient cached on a ref; depends only on canvas size (which
  // changes on resize / quality flip). Recomputed lazily in draw() when
  // dims change.
  const vignetteCacheRef = useRef<{ w: number; h: number; grad: CanvasGradient } | null>(null)
  // F4 — drag-to-pin state: pinDrag.current holds the live target world
  // coords. The main draw loop runs each frame via rAF, so we don't need to
  // trigger a React re-render on each cursor move; the next frame picks up
  // the new ref value.
  const pinDrag = useRef<{ id: string; worldX: number; worldY: number } | null>(null)
  // Vim-mode hjkl smooth pan: velocity in screen px/sec, integrated by the
  // animation loop into camRef every frame. Held keys in useVimMode set this;
  // empty velocity means "not panning".
  const panVelRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 })

  // F11 — active theme ref. The draw callback below reads it each frame so
  // theme switches re-render every visible star without rebuilding the rAF
  // loop (cache key includes the theme id so cached sprites for the previous
  // theme stay until LRU eviction).
  const themeRef = useRef(theme)
  useEffect(() => {
    themeRef.current = theme
    setSpriteCacheActiveTheme(theme.id)
    dirtyRef.current = true
  }, [theme])

  // F10 — classification mode + percentile buckets refs. The draw callback
  // reads them per-frame so flipping the mode toggle re-skins every visible
  // star instantly without rebuilding the rAF loop.
  const classModeRef = useRef<ClassificationMode>(classMode ?? 'type')
  const bucketsRef = useRef<PercentileBuckets | undefined>(percentileBuckets)
  // Mode + bucket changes flip pulsar/quasar membership for type-mode stars
  // routed through the F2 default classifier, so the animated-stars list
  // must be rebuilt — otherwise overlay beams stick to the old mode's set.
  useEffect(() => {
    classModeRef.current = classMode ?? 'type'
    bucketsRef.current = percentileBuckets
    const next: Star[] = []
    const mode = classModeRef.current
    const buckets = bucketsRef.current
    for (const s of starsRef.current) {
      const t = effectiveStarType(s, mode, buckets)
      if (t === 'pulsar' || t === 'quasar') next.push(s)
    }
    animatedStarsRef.current = next
    // Seed gate-count to corpus-total so the first frame after a mode flip
    // still draws regardless of whether any animated star is currently in
    // viewport. Refined by the animation-overlay pass on next draw.
    visibleAnimatedCountRef.current = next.length
    dirtyRef.current = true
  }, [classMode, percentileBuckets])

  // Keep refs in sync
  useEffect(() => {
    starsRef.current = stars
    gridRef.current = buildSpatialGrid(stars)
    // Rebuild small precomputed lists. classMode/buckets are read by
    // effectiveStarType; classifying once here avoids re-classifying every
    // frame inside the animation overlay pass.
    const animated: Star[] = []
    const pinned: Star[] = []
    const mode = classModeRef.current
    const buckets = bucketsRef.current
    for (const s of stars) {
      const t = effectiveStarType(s, mode, buckets)
      if (t === 'pulsar' || t === 'quasar') animated.push(s)
      if (s.isPinned) pinned.push(s)
    }
    animatedStarsRef.current = animated
    pinnedStarsRef.current = pinned
    tempBucketCacheRef.current = new Map()
    jitterCacheRef.current = new Map()
    // Same seeding rule as the mode-flip path above.
    visibleAnimatedCountRef.current = animated.length
    dirtyRef.current = true

    // Spread sprite-build cost over idle time after the first frame paints.
    // Without this, the very first frame after a fresh load (or theme flip)
    // pays for every visible star's procedural sprite build at once, which
    // can chew tens to hundreds of milliseconds. With it, the first paint
    // uses whatever sprites are cache-resident (the cheap tier serves until
    // full builds complete via the LOD swap) and the heavier full-tier
    // sprites trickle in over subsequent idle ticks.
    if (typeof window === 'undefined') return
    const ric: ((cb: () => void) => number | NodeJS.Timeout) = typeof window.requestIdleCallback === 'function'
      ? (cb) => window.requestIdleCallback(() => cb())
      : (cb) => window.setTimeout(cb, 16)
    const cic: ((handle: number) => void) = typeof window.cancelIdleCallback === 'function'
      ? (h) => window.cancelIdleCallback(h)
      : (h) => window.clearTimeout(h)
    let cancelled = false
    let cursor = 0
    const list = stars
    const prebuildChunkSize = 40
    const prebuildMode = classModeRef.current
    const prebuildBuckets = bucketsRef.current
    const prebuildTheme = themeRef.current
    const handle = ric(function tick(): void {
      if (cancelled) return
      const end = Math.min(cursor + prebuildChunkSize, list.length)
      for (let i = cursor; i < end; i++) {
        const s = list[i]
        const sb = prebuildMode === 'usage'
          ? sizeBucketForImportance(s.importanceScore ?? 0)
          : sizeBucketFor(s.viewCount)
        const t = effectiveStarType(s, prebuildMode, prebuildBuckets)
        if (t) {
          getTypedStarSprite(prebuildTheme, t, sb, s.id, 'full')
        } else {
          const cluster = s.clusterId !== null ? clusterMap.current.get(s.clusterId) : null
          const colorIndex = cluster ? cluster.colorIndex : -1
          const tb = tempBucketFor(s.id)
          const jit = defaultJitterFor(s.id)
          getStarSprite(colorIndex, tb, sb, jit.spikeVariant, 'full')
        }
      }
      cursor = end
      if (cursor < list.length) ric(tick)
    }) as number
    return () => {
      cancelled = true
      cic(handle as number)
    }
  }, [stars])
  useEffect(() => { clustersRef.current = clusters; dirtyRef.current = true }, [clusters])
  useEffect(() => { highlightsRef.current = searchHighlights; dirtyRef.current = true }, [searchHighlights])
  useEffect(() => { edgesRef.current = edges; dirtyRef.current = true }, [edges])
  useEffect(() => {
    neighborStarsRef.current = neighborStars
    neighborStarMapRef.current = new Map(neighborStars.map(n => [n.id, n]))
    dirtyRef.current = true
  }, [neighborStars])

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

  // F5 — highlightSet holds search-result ids unioned with active-collection
  // member ids so the dim/scale focus logic (DIM_ALPHA path below) treats
  // collection-active state the same way as search-active state, matching the
  // spec ("Renderer treats collection-active state the same way as search-
  // active for the F1 dim/scale logic"). activeCollectionRef carries the
  // colour + member set so the rAF draw loop can render the hull each frame
  // without rebuilding closures.
  const highlightSet = useRef<Set<string>>(new Set())
  const activeCollectionRef = useRef<ActiveCollectionVis | null>(activeCollection ?? null)
  useEffect(() => { activeCollectionRef.current = activeCollection ?? null }, [activeCollection])
  useEffect(() => {
    const next = new Set(searchHighlights.map(r => r.id))
    if (activeCollection) {
      for (const id of activeCollection.memberIds) next.add(id)
    }
    highlightSet.current = next
  }, [searchHighlights, activeCollection])

  // B3 — preview overlay ref. The draw loop reads this every frame to
  // override (x, y) for affected stars and tint their halo. dirty-flag
  // bumped on prop change so the next frame redraws even if no other
  // state changed.
  const experimentPreviewRef = useRef<ExperimentPreviewVis | null>(experimentPreview ?? null)
  useEffect(() => {
    experimentPreviewRef.current = experimentPreview ?? null
    dirtyRef.current = true
  }, [experimentPreview])

  const starIndex = useRef<Map<string, Star>>(new Map())
  useEffect(() => {
    starIndex.current = new Map(stars.map(s => [s.id, s]))
  }, [stars])

  // Propagate hovered id to parent
  useEffect(() => {
    onHoveredChange?.(hoveredId)
  }, [hoveredId, onHoveredChange])

  // Bump dirty flag for state changes that affect the rendered image but
  // aren't covered by the ref-sync effects above. selectedId + hoveredId are
  // the two main drivers — both gate decoration-pass + label emphasis.
  useEffect(() => { dirtyRef.current = true }, [hoveredId, selectedId, activeCollection])

  // Handle imperative vim actions from useVimMode
  useEffect(() => {
    if (!vimAction) return
    const canvas = canvasRef.current
    const currentStars = starsRef.current

    if (vimAction.type === 'panVelocity') {
      // Velocity is in screen px/sec; the animation loop integrates it into
      // camRef every frame (divided by zoom for world units).
      panVelRef.current = { vx: vimAction.vx, vy: vimAction.vy }
      return
    }

    if (vimAction.type === 'zoom') {
      const c = camRef.current
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.zoom * vimAction.factor))
      camRef.current = { ...c, zoom: newZoom }
      dirtyRef.current = true
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
      camRef.current = { cx, cy, zoom }
      dirtyRef.current = true
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
      camRef.current = { cx, cy, zoom }
      dirtyRef.current = true
      return
    }

    if (vimAction.type === 'panTo') {
      // Optional zoom lets callers (e.g. galaxy "fly to") snap to a specific
      // viewing zoom in addition to recentering.
      const c = camRef.current
      const z = vimAction.zoom !== undefined
        ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, vimAction.zoom))
        : c.zoom
      camRef.current = { ...c, cx: vimAction.wx, cy: vimAction.wy, zoom: z }
      dirtyRef.current = true
      return
    }
  }, [vimAction])

  // Fit all stars into view on first load.
  //
  // Defensive guard: even though the dep array is `[stars.length > 0]` (a
  // boolean that should keep the effect inert once stars are present),
  // theme switches were observed to recenter the camera. Until the root
  // cause is pinpointed, gate this effect behind a `didFitOnce` ref so
  // the fit happens at most one time per StarMap mount lifecycle. Vim's
  // `gg` (fit-all) and `gh` (fit-cluster) remain available for explicit
  // refits.
  const didFitOnce = useRef(false)
  useEffect(() => {
    if (didFitOnce.current) return
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
    camRef.current = { cx, cy, zoom }
    dirtyRef.current = true
    didFitOnce.current = true
    onReady?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars.length > 0])

  // Resize canvas to window — backing store is sized in device pixels so the
  // image stays crisp on high-DPR displays. All draw code below operates in
  // CSS-pixel coordinates after we apply the dpr transform per frame.
  // Per-theme `dprCap` lets a low-res aesthetic (e.g. Atari 8-bit) bake at
  // 1.0 DPR by default; themes that omit `dprCap` get full native DPR.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const native = window.devicePixelRatio || 1
      const cap = themeRef.current.dprCap ?? Infinity
      const dpr = Math.min(native, cap)
      dprRef.current = dpr
      setSpriteCacheDpr(dpr)
      const w = window.innerWidth
      const h = window.innerHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      dirtyRef.current = true
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Re-run resize when the theme flips so a `dprCap` change takes effect
  // immediately (e.g. JWST → Atari should drop the backing store to 1.0
  // DPR right away rather than wait for the next window resize).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const native = window.devicePixelRatio || 1
    const cap = theme.dprCap ?? Infinity
    const dpr = Math.min(native, cap)
    dprRef.current = dpr
    setSpriteCacheDpr(dpr)
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    dirtyRef.current = true
  }, [theme])

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
    // F-NEXT-B — per-theme image smoothing. JWST wants high-quality bilinear
    // for soft realistic halos; vapor wants nearest-neighbour to keep its
    // hard pixel-art edges from being smudged by the upscale pass.
    if (activeTheme.smoothing === 'off') {
      ctx.imageSmoothingEnabled = false
    } else {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
    }
    // F10 — read mode + buckets per-frame so toggle flips re-render the
    // sky without rebuilding the rAF loop.
    const activeMode = classModeRef.current
    const activeBuckets = bucketsRef.current
    // Per-pass timing instrumentation (Phase 0). DEV-only — Vite folds the
    // const so prod builds strip the recordPass calls + the markers via
    // dead-code elimination. `_markT` is reused across passes so we don't
    // pay an allocation per call. Wrap each pass with markStart() before
    // and markEnd('NN.name') after.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PERF = !!(import.meta as any).env?.DEV
    let _markT = 0
    const markStart = (): void => { if (PERF) _markT = performance.now() }
    const markEnd = (name: string): void => {
      if (PERF) frameMetrics.recordPass(name, performance.now() - _markT)
    }

    // Reset the per-frame typed-sprite bake budget. Caps how many cold-cache
    // procedural drawer calls one frame may incur; over-budget misses serve
    // the cheap-tier sprite so a single rAF never stalls on thousands of
    // bakes (e.g. cold load at 7.5k stars).
    resetTypedBakeBudget()

    // Opaque clear: backdrop draw + vignette below are not guaranteed to
    // cover the full backing store on resize / DPR change. Without this,
    // stale pixels survive in narrow bands. Theme drives the fill colour
    // (jwst slate, vapor purple, ...).
    markStart()
    ctx.fillStyle = activeTheme.background.canvasFill
    ctx.fillRect(0, 0, w, h)
    markEnd('01.clear')

    // F-NEXT-C — per-theme background-nebula layer (Stage C). JWST paints
    // a deep-field teal+pink wash + 180 colour-temp pinpoints; vapor paints
    // a synthwave gradient + Tron-grid horizon. The painter caches its
    // output to an offscreen canvas keyed on (theme, viewport, dpr) and
    // re-blits per frame, so steady-state cost is one drawImage call.
    // Sits under the prerendered backdrop so the existing parallax pass
    // composites on top.
    markStart()
    if (activeTheme.background.paint) {
      activeTheme.background.paint(ctx, w, h, dpr, activeTheme.id)
    }
    markEnd('01b.bgNebula')
    const cam = camRef.current
    const currentClusters = clustersRef.current
    const currentEdges = edgesRef.current
    const currentNeighbors = neighborStarsRef.current
    const neighborStarMap = neighborStarMapRef.current
    const grid = gridRef.current
    const highlights = highlightSet.current
    const neighbors = neighborSet.current
    const hasHighlights = highlights.size > 0
    const hasFocus = hasHighlights || selectedId !== null
    // Themes that opt into flatLighting (e.g. Bio, Lost in space) skip the
    // zoom-driven exposure dim entirely so per-sprite procedural detail
    // reads at full opacity at every zoom level.
    const exposure = activeTheme.flatLighting ? 1 : exposureFor(cam.zoom)
    const drawScale = zoomDrawScale(cam.zoom)
    const tNowMs = performance.now()
    const pulseT = Math.min(1, (tNowMs - searchPulseStart.current) / SEARCH_PULSE_MS)
    const pulseScale = pulseT < 1 ? SPRITE_HIGHLIGHT_PULSE * (1 - easeOutCubic(pulseT)) : 0
    const cull = cullMarginFor(drawScale)
    // World-space bounds covering the viewport plus the cull margin. Feeds
    // the spatial grid so we only iterate cells overlapping the visible
    // region — at 5k+ stars zoomed in this drops per-frame work from O(N)
    // to O(visible_cells).
    const [minWorldX, minWorldY] = screenToWorld(-cull, -cull, cam, w, h)
    const [maxWorldX, maxWorldY] = screenToWorld(w + cull, h + cull, cam, w, h)

    // Per-id memoised lookups. Same id space as the sprite cache; cleared
    // when `stars` mutates (see the stars useEffect above).
    const tempBucketCache = tempBucketCacheRef.current
    const jitterCache = jitterCacheRef.current
    const getTempBucket = (id: string): number => {
      let v = tempBucketCache.get(id)
      if (v === undefined) {
        v = tempBucketFor(id)
        tempBucketCache.set(id, v)
      }
      return v
    }
    const getJitter = (id: string): ReturnType<typeof defaultJitterFor> => {
      let j = jitterCache.get(id)
      if (!j) {
        j = defaultJitterFor(id)
        jitterCache.set(id, j)
      }
      return j
    }

    // Deep-field backdrop (prerendered: nebulae + faint stars + far galaxies),
    // scaled + panned with parallax so it reads as deeper space behind the stars.
    // Skipped for themes that opt out via `background.replacesBackdrop`
    // (vapor's gradient + Tron grid IS the backdrop; rendering the JWST
    // deep-field on top would clobber it).
    markStart()
    if (!activeTheme.background.replacesBackdrop) {
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
    }
    markEnd('02.backdrop')

    // Vignette to keep focus toward center. Phase 1.3 — gradient depends
    // only on canvas size; cache on a ref and rebuild only on resize.
    // Themes with flatLighting (Bio, Lost in space) skip the vignette so
    // their organic / scenic backgrounds don't fade into corner darkness.
    markStart()
    if (!activeTheme.flatLighting) {
      let vignetteCache = vignetteCacheRef.current
      if (!vignetteCache || vignetteCache.w !== w || vignetteCache.h !== h) {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7)
        grad.addColorStop(0, 'rgba(0,0,0,0)')
        // F-NEXT-B — outer alpha lowered 0.55 → 0.35. The deck-grade tighter
        // sprite halos already keep visual focus in the centre; the heavier
        // vignette was washing the field corners and competing with the new
        // background-nebula layer (Stage C).
        grad.addColorStop(1, 'rgba(0,4,12,0.35)')
        vignetteCache = { w, h, grad }
        vignetteCacheRef.current = vignetteCache
      }
      ctx.fillStyle = vignetteCache.grad
      ctx.fillRect(0, 0, w, h)
    }
    markEnd('03.vignette')

    // Constellation nebulae — multi-stop gradients with subtle elliptical
    // squish per cluster. Themes that forbid soft halos (Atari, Vapor) opt
    // out via `constellationHalos: false` so their crisp aesthetic isn't
    // bloomed by a screen-blended glow under each cluster.
    markStart()
    if (activeTheme.constellationHalos !== false) {
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
    }
    markEnd('04.clusters')

    // F5 — active-collection hull. Sits behind the star pass so members
    // remain crisp on top. Skips when there's no collection or its member
    // set is empty; falls through to a centered circle when the visible
    // membership collapses to a single point (matches the F5 spec for
    // size-1 collections).
    markStart()
    const activeColl = activeCollectionRef.current
    if (activeColl && activeColl.memberIds.size > 0) {
      const memberPts: Pt[] = []
      // Look up members via the starIndex Map (O(members)) instead of a
      // full O(N) scan over every star. Members not present in the index
      // (e.g. hidden by a galaxy filter) simply don't contribute to the hull.
      for (const id of activeColl.memberIds) {
        const star = starIndex.current.get(id)
        if (!star) continue
        memberPts.push(worldToScreen(star.x, star.y, cam, w, h))
      }
      if (memberPts.length === 1) {
        // Single-member: small circle around the point so the user still
        // sees a visual anchor for the collection.
        const [px, py] = memberPts[0]
        const r = 24
        ctx.save()
        ctx.fillStyle = withAlpha(activeColl.color, COLLECTION_HULL_FILL_ALPHA)
        ctx.strokeStyle = withAlpha(activeColl.color, COLLECTION_HULL_STROKE_ALPHA)
        ctx.lineWidth = COLLECTION_HULL_STROKE_WIDTH
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      } else if (memberPts.length >= 2) {
        const hull = inflateHull(convexHull(memberPts), COLLECTION_HULL_INFLATE_PX)
        if (hull.length >= 2) {
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(hull[0][0], hull[0][1])
          for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1])
          ctx.closePath()
          ctx.fillStyle = withAlpha(activeColl.color, COLLECTION_HULL_FILL_ALPHA)
          ctx.strokeStyle = withAlpha(activeColl.color, COLLECTION_HULL_STROKE_ALPHA)
          ctx.lineWidth = COLLECTION_HULL_STROKE_WIDTH
          // Two-point "hull" (collinear) draws as a stroked line — fill is a
          // no-op but cheaper to leave the same call than branch.
          ctx.fill()
          ctx.stroke()
          ctx.restore()
        }
      }
    }
    markEnd('05.activeHull')

    // Edges (selected neighborhood only) — additive screen blend for filament feel
    markStart()
    if (currentEdges.length > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      ctx.strokeStyle = EDGE_COLOR
      ctx.lineWidth = 1
      const originStar = selectedId ? starIndex.current.get(selectedId) : null
      for (const edge of currentEdges) {
        const src = starIndex.current.get(edge.srcId) ?? (originStar?.id === edge.srcId ? originStar : null)
        // O(1) neighbor lookup via the per-frame neighbor Map; replaces the
        // previous per-edge linear scan over `currentNeighbors`.
        const dst = starIndex.current.get(edge.dstId) ?? neighborStarMap.get(edge.dstId) ?? null
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
    markEnd('06.edges')

    // Main star pass — sprite-cached, additive blend so overlapping halos bloom together.
    // Side-channel: record per-star sprite metadata for the decoration pass so it doesn't
    // recompute the sprite + scale twice per frame.
    markStart()
    // F8b — `rotation` is non-null for default-path (cluster-hue) stars so the
    // decoration pass replays the same rotation on its brightness-boost re-draw;
    // null for typed stars (their drawer already bakes per-id orientation).
    // Phase 1.3 — Map/Set hoisted to refs; clear() at top of frame avoids
    // per-frame allocations.
    const drawnByFocusId = drawnByFocusIdRef.current
    const drawnIds = drawnIdsRef.current
    drawnByFocusId.clear()
    drawnIds.clear()

    ctx.save()
    ctx.globalCompositeOperation = 'lighter'

    // LOD picker: deprecated as of post-themes — every star renders the full
    // procedural drawer at every zoom so themes are recognisable when zoomed
    // out (the cheap white-dot fallback hid the per-theme aesthetic). The
    // function stays in place to keep the call site shape intact; the cheap
    // tier in sprites.ts is now unused but harmless.
    const lodFor = (_spritePx: number, _focused: boolean): Lod => 'full'

    // B3 — preview overrides: when an experiment is being previewed, the
    // overlay map supplies replacement world coords for affected stars.
    // The override is applied at the very top of drawMainStar so every
    // downstream calc (cull test, sprite metadata for the decoration
    // pass, drawn-id bookkeeping) uses the experimental position.
    const previewOverride = experimentPreviewRef.current

    const drawMainStar = (star: Star, allowOffscreen: boolean): void => {
      const overridePos = previewOverride?.positions.get(star.id) ?? null
      const wx = overridePos ? overridePos[0] : star.x
      const wy = overridePos ? overridePos[1] : star.y
      const [sx, sy] = worldToScreen(wx, wy, cam, w, h)
      const offscreen = sx < -cull || sx > w + cull || sy < -cull || sy > h + cull
      if (offscreen && !allowOffscreen) return
      const isHighlighted = highlights.has(star.id)
      const isSelected = star.id === selectedId
      const isNeighbor = neighbors.has(star.id)
      const isHovered = star.id === hoveredId
      const dimAlpha = hasFocus && !isHighlighted && !isSelected && !isNeighbor ? DIM_ALPHA : 1
      // Selected stars bypass the zoom-driven exposure curve so they read
      // punchy at every zoom level. Otherwise the 1.4× selection scale +
      // exposure dim makes the disc look diluted at default zoom and only
      // recovers when the user zooms in enough for exposure to ramp up.
      ctx.globalAlpha = dimAlpha * (isSelected ? 1 : exposure)

      // F10: in usage mode, size scales with importance_score (replaces
      // the view-count-only bucket). Type mode keeps the existing F2 path.
      const sb = activeMode === 'usage'
        ? sizeBucketForImportance(star.importanceScore ?? 0)
        : sizeBucketFor(star.viewCount)
      const focused = isSelected || isHighlighted || isNeighbor || isHovered
      const spritePx = spriteCoreRadius(sb) * drawScale
      const lod = lodFor(spritePx, focused)

      let sprite: HTMLCanvasElement
      // F8b — only the default-path (cluster-hue) branch picks up the per-id
      // jitter triple. Typed stars get their per-id variation baked into the
      // sprite by the F8a drawer pass (rotation, halo squish, etc.) and
      // would double-jitter if we layered another rotate on top. `jitter`
      // null → no save/rotate/alpha-multiply at draw time.
      let jitter: ReturnType<typeof defaultJitterFor> | null = null
      const effectiveType = effectiveStarType(star, activeMode, activeBuckets)
      if (effectiveType) {
        sprite = getTypedStarSprite(activeTheme, effectiveType, sb, star.id, lod, focused ? 'high' : 'normal')
      } else {
        const cluster = star.clusterId !== null ? clusterMap.current.get(star.clusterId) : null
        const colorIndex = cluster ? cluster.colorIndex : -1
        const tb = getTempBucket(star.id)
        jitter = getJitter(star.id)
        sprite = getStarSprite(colorIndex, tb, sb, jitter.spikeVariant, lod)
      }
      const { w: sw, h: sh } = spriteLogicalSize(sprite)
      let scale = drawScale
      if (isHovered) scale *= SPRITE_HOVER_SCALE
      if (isHighlighted) scale *= SPRITE_HIGHLIGHT_SCALE + pulseScale
      if (isNeighbor && !isSelected) scale *= SPRITE_NEIGHBOR_SCALE
      if (isSelected) scale *= SPRITE_SELECTED_SCALE * selectionPulse(tNowMs)
      const drawW = sw * scale, drawH = sh * scale
      if (jitter) {
        // Default-path: per-id rotation + alpha jitter applied at draw time.
        // The bucket sprite is shared across same-(colorIndex, tempBucket,
        // sizeBucket, spikeVariant) stars; rotation + alpha jitter give two
        // such files distinct presentation per the F8b NO-cache plan.
        const baseAlpha = ctx.globalAlpha
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate(jitter.rotation)
        ctx.globalAlpha = baseAlpha * jitter.alphaJitter
        ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH)
        ctx.restore()
      } else {
        ctx.drawImage(sprite, sx - drawW / 2, sy - drawH / 2, drawW, drawH)
      }
      if (isSelected || isHighlighted || isNeighbor) {
        drawnByFocusId.set(star.id, {
          sprite, sx, sy, drawW, drawH,
          rotation: jitter ? jitter.rotation : null,
        })
      }
      drawnIds.add(star.id)
    }

    forEachStarInBounds(grid, minWorldX, minWorldY, maxWorldX, maxWorldY, star => {
      drawMainStar(star, false)
    })

    // Forced-draw set: selected + hovered + neighbors get rendered even
    // when their cell sat outside the viewport bounds, so their sprites
    // peek in from the canvas edge as the user pans/zooms.
    const renderForced = (id: string | null): void => {
      if (!id || drawnIds.has(id)) return
      const star = starIndex.current.get(id) ?? neighborStarMap.get(id) ?? null
      if (star) drawMainStar(star, true)
    }
    renderForced(selectedId)
    renderForced(hoveredId)
    for (const n of currentNeighbors) renderForced(n.id)
    // B3 — preview overrides: force-draw any affected star whose new
    // position lies in the viewport even if its production cell was
    // outside the iterated bounds (the spatial grid is keyed on the
    // production coords, not the override).
    if (previewOverride) {
      for (const id of previewOverride.ids) {
        renderForced(id)
      }
    }
    ctx.restore()
    markEnd('07.mainStars')

    // Animation overlay — pulsar rotating beam + quasar jet flicker. Iterates
    // the precomputed pulsar/quasar list so we don't re-classify every star
    // each frame. Cardinality is small in practice (manually-typed only).
    markStart()
    // When the on-screen sprite is tiny the beam is invisible anyway and the
    // per-frame gradient is pure cost. Below this on-screen radius the beam
    // is sub-perceivable; skip drawing AND skip counting toward the rAF gate
    // so a far-zoomed-out scene with PDFs/PPTXs in view doesn't pin the gate
    // open at 60 fps for animations the user can't see. Threshold matches
    // what the old `quality === 'high'` preset produced.
    const animSkipPx = 4
    const tNow = performance.now() / 1000
    // Count animated stars actually inside the viewport. The rAF gate uses
    // this (not the corpus-total) so a single PDF (→quasar) at the far end
    // of the map can't pin the dirty-flag gate open and prevent idle skip.
    let visibleAnimated = 0
    for (const star of animatedStarsRef.current) {
      const animType = effectiveStarType(star, activeMode, activeBuckets)
      if (animType !== 'pulsar' && animType !== 'quasar') continue
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      if (sx < -cull || sx > w + cull || sy < -cull || sy > h + cull) continue

      const sb = activeMode === 'usage'
        ? sizeBucketForImportance(star.importanceScore ?? 0)
        : sizeBucketFor(star.viewCount)
      const r = spriteCoreRadius(sb)
      // Skip-and-don't-count if the on-screen beam would be sub-perceivable.
      // The rAF gate reads visibleAnimatedCountRef so this also lets idle
      // skip when animations are present but invisibly small.
      if (r * drawScale < animSkipPx) continue
      visibleAnimated++

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
    visibleAnimatedCountRef.current = visibleAnimated
    markEnd('08.animOverlay')

    // Decoration pass — additive sprite re-draw (selected) + warm-white selection ring +
    // gold ring (highlighted) + cyan ring (neighbors). Iterates the small focus-id set
    // (≤ ~30 ids: selected + neighbors + highlights) instead of all stars.
    markStart()
    if (hasFocus) {
      ctx.save()
      const focusIds = focusIdsRef.current
      focusIds.clear()
      if (selectedId) focusIds.add(selectedId)
      for (const id of neighbors) focusIds.add(id)
      for (const id of highlights) focusIds.add(id)
      for (const id of focusIds) {
        const isHighlighted = highlights.has(id)
        const isSelected = id === selectedId
        const isNeighbor = neighbors.has(id)
        const drawn = drawnByFocusId.get(id)
        if (!drawn) continue  // off-screen + not drawn this frame
        const star = starIndex.current.get(id) ?? neighborStarMap.get(id)
        if (!star) continue
        const { sprite, sx, sy, drawW, drawH, rotation } = drawn

        // F8b — for default-path stars the main pass rotated the sprite, so
        // the brightness-boost re-draws below must replay the same rotation
        // or the boost halo lands at the wrong orientation. Helper centralises
        // the save/translate/rotate/restore wrap (or a passthrough for typed
        // sprites whose drawer already baked orientation in).
        const drawSpriteOriented = (alpha: number, op: GlobalCompositeOperation): void => {
          ctx.globalCompositeOperation = op
          if (rotation !== null) {
            ctx.save()
            ctx.globalAlpha = alpha
            ctx.translate(sx, sy)
            ctx.rotate(rotation)
            ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH)
            ctx.restore()
          } else {
            ctx.globalAlpha = alpha
            ctx.drawImage(sprite, sx - drawW / 2, sy - drawH / 2, drawW, drawH)
          }
        }

        const sb = activeMode === 'usage'
          ? sizeBucketForImportance(star.importanceScore ?? 0)
          : sizeBucketFor(star.viewCount)
        let scaleR = drawScale
        if (isHighlighted) scaleR *= SPRITE_HIGHLIGHT_SCALE + pulseScale
        if (isNeighbor && !isSelected) scaleR *= SPRITE_NEIGHBOR_SCALE
        if (isSelected) scaleR *= SPRITE_SELECTED_SCALE * selectionPulse(tNowMs)
        const r = spriteCoreRadius(sb) * scaleR

        if (isSelected) {
          // F12 — brightness boost breathes on the same 1.5s sine as the scale pulse,
          // so halo brightness oscillates with sprite size for a unified breathing effect.
          // Boost ignores the global exposure curve (same reason as the main-pass
          // bypass above): selection should feel solid regardless of zoom.
          drawSpriteOriented(selectionBoostAlpha(tNowMs), 'lighter')

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
          drawSpriteOriented(SPRITE_NEIGHBOR_BOOST_ALPHA * exposure, 'lighter')

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
          ctx.strokeStyle = activeTheme.ui.accentColor
          ctx.lineWidth = 2
          ctx.globalAlpha = 0.85
          ctx.beginPath()
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      // F-NEXT-D — vapor chromatic aberration on focused cores. Walks the
      // same `drawnByFocusId` set the rings just used; the screen-blend
      // arc pair brightens each focused star's nucleus with a magenta /
      // cyan fringe, the analogue-CRT "channel mis-registration" look.
      // Vapor only — JWST keeps clean halos. Cheap (≤ ~30 focus ids,
      // 2 arcs each).
      if (activeTheme.id === 'vapor') {
        for (const drawn of drawnByFocusId.values()) {
          drawChromaticAberration(ctx, drawn.sx, drawn.sy, drawn.drawW / 2)
        }
      }
      ctx.restore()
    }
    markEnd('09.decoration')

    // B3 — experiment overlay rings. Tints each affected star's halo so
    // the user can spot what's experimental vs. production at a glance.
    // Sits after the decoration pass (so selection / neighbour rings
    // stack visibly underneath when both apply) and before the theme
    // overlay (so themed scanlines / Tron grid still draw on top of
    // the ring at the same z as everything else).
    markStart()
    if (previewOverride && previewOverride.ids.size > 0) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.9
      ctx.strokeStyle = previewOverride.color
      for (const id of previewOverride.ids) {
        const pos = previewOverride.positions.get(id)
        if (!pos) continue
        const [psx, psy] = worldToScreen(pos[0], pos[1], cam, w, h)
        if (psx < -cull || psx > w + cull || psy < -cull || psy > h + cull) continue
        const star = starIndex.current.get(id)
        if (!star) continue
        const sb = activeMode === 'usage'
          ? sizeBucketForImportance(star.importanceScore ?? 0)
          : sizeBucketFor(star.viewCount)
        const r = spriteCoreRadius(sb) * drawScale + 5
        ctx.beginPath()
        ctx.arc(psx, psy, r, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }
    markEnd('09b.experimentRings')

    // F11 — theme overlay (scanlines, Tron grid, etc.). Sits ON TOP of the
    // sky and underneath the HUD layer (chevrons, lock glyphs, labels) so
    // chrome stays legible on noisy themes like vapor.
    markStart()
    if (activeTheme.background.overlay) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      activeTheme.background.overlay(ctx, w, h)
      ctx.restore()
    }
    markEnd('10.themeOverlay')

    // Off-screen neighbor markers — draw a chevron at the canvas edge for each
    // neighbor whose center is outside the viewport, pointing toward it.
    markStart()
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
    markEnd('11.chevrons')

    // F4 — pinned-star lock glyph at high zoom. Cheap text glyph above the
    // sprite, only when zoomed in enough that the user can see it (low zoom
    // would be visual clutter). Iterates the precomputed pinned list so this
    // is O(pinned) instead of O(N).
    markStart()
    if (cam.zoom > 1.5) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.font = '14px monospace'
      ctx.fillStyle = activeTheme.ui.accentColor
      ctx.globalAlpha = 0.85
      ctx.textAlign = 'center'
      for (const star of pinnedStarsRef.current) {
        const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
        if (sx < -cull || sx > w + cull || sy < -cull || sy > h + cull) continue
        const sbLock = activeMode === 'usage'
          ? sizeBucketForImportance(star.importanceScore ?? 0)
          : sizeBucketFor(star.viewCount)
        const r = spriteCoreRadius(sbLock) * drawScale
        ctx.fillText('\u{1F512}', sx, sy - r - 6)
      }
      ctx.textAlign = 'start'
      ctx.restore()
    }
    markEnd('12.lockGlyphs')

    // F4 — pin-drag preview: dashed line from the natural position to the
    // current cursor + a faint sprite at the cursor so the user can see
    // where they're aiming.
    markStart()
    const drag = pinDrag.current
    if (drag) {
      const star = starIndex.current.get(drag.id) ?? null
      if (star) {
        const [nx, ny] = worldToScreen(star.x, star.y, cam, w, h)
        const [tx, ty] = worldToScreen(drag.worldX, drag.worldY, cam, w, h)
        ctx.save()
        ctx.globalCompositeOperation = 'source-over'
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = activeTheme.ui.accentColor
        ctx.globalAlpha = 0.6
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(nx, ny)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        ctx.setLineDash([])
        const sb = activeMode === 'usage'
          ? sizeBucketForImportance(star.importanceScore ?? 0)
          : sizeBucketFor(star.viewCount)
        const effectiveType = effectiveStarType(star, activeMode, activeBuckets)
        let sprite: HTMLCanvasElement
        // F8b — match the main pass: default-path stars get the per-id
        // jitter triple so the preview reads as the same star (same spike
        // variant + rotation + alpha) the user grabbed off the canvas.
        let jitter: ReturnType<typeof defaultJitterFor> | null = null
        if (effectiveType) {
          sprite = getTypedStarSprite(activeTheme, effectiveType, sb, star.id)
        } else {
          const cluster = star.clusterId !== null ? clusterMap.current.get(star.clusterId) : null
          const colorIndex = cluster ? cluster.colorIndex : -1
          const tb = getTempBucket(star.id)
          jitter = getJitter(star.id)
          sprite = getStarSprite(colorIndex, tb, sb, jitter.spikeVariant)
        }
        const { w: sw, h: sh } = spriteLogicalSize(sprite)
        const previewScale = drawScale * SPRITE_SELECTED_SCALE
        const drawW = sw * previewScale, drawH = sh * previewScale
        ctx.globalCompositeOperation = 'lighter'
        if (jitter) {
          ctx.globalAlpha = 0.7 * exposure * jitter.alphaJitter
          ctx.translate(tx, ty)
          ctx.rotate(jitter.rotation)
          ctx.drawImage(sprite, -drawW / 2, -drawH / 2, drawW, drawH)
        } else {
          ctx.globalAlpha = 0.7 * exposure
          ctx.drawImage(sprite, tx - drawW / 2, ty - drawH / 2, drawW, drawH)
        }
        ctx.restore()
      }
    }
    markEnd('13.pinDrag')

    // Labels — alpha tapers smoothly from zoom 0.8 upward; no hard cutoff.
    // Below zoom 0.8 only the hovered label can render (zoomAlpha = 0 for
    // everything else), so we early-exit the per-cell scan and just render
    // the hovered label if any. Above 0.8 we iterate viewport cells via the
    // grid so labels stay O(visible_cells).
    markStart()
    // Phase 2.1A — skip labels whose underlying sprite is below this on-
    // screen radius unless the star is emphasized (hover/select/neighbor/
    // search hit). `fillText` is the most expensive ordinary Canvas2D op
    // in Skia; at zoom-out where sprites are 5–10 px and labels are
    // unreadable, drawing them is pure cost. Threshold matches the
    // sprite-LOD cheap-tier swap so labels disappear in lockstep with
    // procedural detail.
    const LABEL_SKIP_PX = 12
    const drawLabel = (star: Star): void => {
      const [sx, sy] = worldToScreen(star.x, star.y, cam, w, h)
      if (sx < -cull || sx > w + cull || sy < -cull || sy > h + cull) return
      const isHovered = star.id === hoveredId
      const isHighlighted = highlights.has(star.id)
      const isSelected = star.id === selectedId
      const isNeighbor = neighbors.has(star.id)
      const isEmphasized = isHovered || isHighlighted || isSelected || isNeighbor
      const sbLabel = activeMode === 'usage'
        ? sizeBucketForImportance(star.importanceScore ?? 0)
        : sizeBucketFor(star.viewCount)
      const r = spriteCoreRadius(sbLabel) * drawScale
      if (!isEmphasized && r < LABEL_SKIP_PX) return
      const focusAlpha = hasFocus && !isHighlighted && !isSelected && !isNeighbor ? DIM_ALPHA : 1
      const zoomAlpha = isHovered ? 1 : Math.max(0, Math.min(1, (cam.zoom - 0.8) * 2))
      const emphasisAlpha = isEmphasized ? 1 : 0.5
      const alpha = focusAlpha * zoomAlpha * emphasisAlpha
      if (alpha < 0.05) return
      ctx.fillStyle = '#c8dff5'
      ctx.font = `${Math.min(11, 8 + cam.zoom * 1.5)}px monospace`
      ctx.globalAlpha = alpha
      const name = star.name.replace(/\.[^.]+$/, '')
      ctx.fillText(name, sx + r + 4, sy + 4)
    }
    ctx.save()
    if (cam.zoom < 0.8) {
      // Only the hovered star can produce a non-zero label alpha at this
      // zoom level. Skip the grid scan entirely.
      if (hoveredId) {
        const hs = starIndex.current.get(hoveredId)
        if (hs) drawLabel(hs)
      }
    } else {
      const labelDrawn = labelDrawnRef.current
      labelDrawn.clear()
      forEachStarInBounds(grid, minWorldX, minWorldY, maxWorldX, maxWorldY, star => {
        labelDrawn.add(star.id)
        drawLabel(star)
      })
      // Emphasized stars outside the viewport still want their label so the
      // user can ID off-screen neighbors / search hits via the chevron edge.
      if (hoveredId && !labelDrawn.has(hoveredId)) {
        const s = starIndex.current.get(hoveredId)
        if (s) drawLabel(s)
      }
      if (selectedId && !labelDrawn.has(selectedId)) {
        const s = starIndex.current.get(selectedId)
        if (s) drawLabel(s)
      }
      for (const id of neighbors) {
        if (labelDrawn.has(id)) continue
        const s = starIndex.current.get(id) ?? neighborStarMap.get(id)
        if (s) drawLabel(s)
      }
      for (const id of highlights) {
        if (labelDrawn.has(id)) continue
        const s = starIndex.current.get(id)
        if (s) drawLabel(s)
      }
    }
    ctx.restore()
    markEnd('14.labels')

    // F-NEXT-D — final post-pass. Sits ABOVE the HUD so effects like the
    // vapor CRT scanline overlay read like a real screen treatment over
    // the entire app, not a backdrop you can see chrome poking through.
    // Optional per theme; JWST has no postPass and pays nothing.
    markStart()
    if (activeTheme.postPass) {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      activeTheme.postPass(ctx, w, h, dpr)
      ctx.restore()
    }
    markEnd('15.postPass')

    dirtyRef.current = false
    lastCamSnapRef.current = cam
    // Number of stars actually drawn this frame (main pass + forced-draw
    // set). Read by the rAF loop's metric tick to give the perf overlay a
    // "are we drawing too much?" signal that ties cost to load.
    lastVisibleCountRef.current = drawnIds.size
  }, [hoveredId, selectedId])

  // Animate. Also integrates hjkl pan velocity into camRef each frame and
  // syncs the React cam state once when velocity drops to zero, so consumers
  // that read cam state (rare, but possible) see the settled position.
  // The dirty-flag rAF gate skips draw() when nothing affecting the visible
  // image has changed; continuous animations (selection pulse, search pulse,
  // pulsar/quasar beams, pin-drag, vim pan velocity) bypass the gate.
  useEffect(() => {
    let lastT = performance.now()
    let lastTickMs = performance.now()
    const loop = (tNow: number) => {
      const dt = Math.min(0.1, (tNow - lastT) / 1000)  // clamp dt to avoid jumps after a long tab-away
      lastT = tNow
      const v = panVelRef.current
      const hasVel = v.vx !== 0 || v.vy !== 0
      if (hasVel) {
        const c = camRef.current
        camRef.current = {
          ...c,
          cx: c.cx + (v.vx * dt) / c.zoom,
          cy: c.cy + (v.vy * dt) / c.zoom,
        }
      }

      // Dirty flag detection. Cam mutations done imperatively (mouse drag,
      // wheel, vim) don't go through React, so compare against the last
      // snapshot to detect them. Continuous animations force a redraw via
      // the second branch.
      const cam = camRef.current
      const snap = lastCamSnapRef.current
      if (cam.cx !== snap.cx || cam.cy !== snap.cy || cam.zoom !== snap.zoom) {
        dirtyRef.current = true
      }
      const pulseActive = (tNow - searchPulseStart.current) < SEARCH_PULSE_MS
      const continuous =
        selectedId !== null ||                         // selection pulse
        pulseActive ||                                 // search highlight pulse
        visibleAnimatedCountRef.current > 0 ||         // pulsar/quasar beams in viewport
        hasVel ||                                      // vim pan velocity
        pinDrag.current !== null                       // pin-drag preview

      // User-driven gestures, distinct from animation. The metric overlay
      // breaks out an interacting-only avg/p99 so the user can see whether
      // pan/zoom feels worse than idle even when overall avg looks fine.
      const interacting =
        isDragging.current ||
        hasVel ||
        pinDrag.current !== null ||
        (tNow - lastWheelTsRef.current) < 200

      if (dirtyRef.current || continuous) {
        // Wrap the draw() call so the overlay can show "draw_total" — the
        // sum of every pass's work — separately from "rAF_gap" — time
        // outside draw() that still lands in the per-frame interval
        // (input handling, React reconcile, vsync wait). Lets us see at a
        // glance whether the bottleneck is paint or scheduling.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const PERF = !!(import.meta as any).env?.DEV
        const drawT0 = PERF ? performance.now() : 0
        draw()
        const deltaMs = tNow - lastTickMs
        frameMetrics.record(deltaMs, interacting, lastVisibleCountRef.current)
        if (PERF) {
          const drawMs = performance.now() - drawT0
          frameMetrics.recordTiming('draw_total', drawMs)
          // rAF_gap = frame interval minus the draw work. A non-trivial
          // gap with small draw_total means the cost lives in input,
          // React, or vsync — not the canvas.
          frameMetrics.recordTiming('rAF_gap', Math.max(0, deltaMs - drawMs))
          const s = spriteCacheStats()
          frameMetrics.recordCounter('spriteCache.default.size', s.defaultSize)
          frameMetrics.recordCounter('spriteCache.default.misses', s.defaultMisses)
          frameMetrics.recordCounter('spriteCache.default.hits', s.defaultHits)
          frameMetrics.recordCounter('spriteCache.typed.size', s.typedSize)
          frameMetrics.recordCounter('spriteCache.typed.misses', s.typedMisses)
          frameMetrics.recordCounter('spriteCache.typed.hits', s.typedHits)
          frameMetrics.recordCounter('spriteCache.typed.bakesPerformed', s.typedBakesPerformed)
          frameMetrics.recordCounter('spriteCache.typed.bakesDeferred', s.typedBakesDeferred)
          frameMetrics.recordCounter('spriteCache.typed.bytes', s.typedBytes)
        }
      } else {
        frameMetrics.recordSkipped()
      }
      lastTickMs = tNow
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [draw, selectedId])

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
      camRef.current = {
        cx: startCam.cx + (targetCx - startCam.cx) * e,
        cy: startCam.cy + (targetCy - startCam.cy) * e,
        zoom: startCam.zoom + (targetZoom - startCam.zoom) * e,
      }
      dirtyRef.current = true
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const PERF = !!(import.meta as any).env?.DEV
    const _t0 = PERF ? performance.now() : 0
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
      const c = camRef.current
      camRef.current = {
        ...c,
        cx: c.cx - dx / c.zoom,
        cy: c.cy - dy / c.zoom,
      }
      dirtyRef.current = true
      return
    }

    // Hover detection — O(visible cells) via the spatial grid instead of
    // a linear scan over the full star list. At 6.9k stars × 60 mousemove
    // events / s the linear scan was 30–300 ms / s of main-thread time
    // during pan; bounded grid query trims it to a handful of cells.
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
    let closest: string | null = null
    const pickR = 25 / camRef.current.zoom  // world-unit pick radius
    let closestDist = pickR
    forEachStarInBounds(gridRef.current, wx - pickR, wy - pickR, wx + pickR, wy + pickR, star => {
      const dx = star.x - wx, dy = star.y - wy
      const d2 = dx * dx + dy * dy
      if (d2 < closestDist * closestDist) {
        closestDist = Math.sqrt(d2)
        closest = star.id
      }
    })

    setHoveredId(closest)
    if (closest) setHoverPos({ x: e.clientX, y: e.clientY })
    if (PERF) frameMetrics.recordTiming('hover', performance.now() - _t0)
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
    const pickR = 20 / camRef.current.zoom
    let closestDist = pickR
    forEachStarInBounds(gridRef.current, wx - pickR, wy - pickR, wx + pickR, wy + pickR, star => {
      const dx = star.x - wx, dy = star.y - wy
      const d2 = dx * dx + dy * dy
      if (d2 < closestDist * closestDist) {
        closestDist = Math.sqrt(d2)
        clicked = star.id
      }
    })

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
    const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05
    const [wx, wy] = screenToWorld(e.clientX, e.clientY, camRef.current, w, h)
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camRef.current.zoom * factor))
    // Zoom towards cursor
    camRef.current = {
      cx: wx - (e.clientX - w / 2) / newZoom,
      cy: wy - (e.clientY - h / 2) / newZoom,
      zoom: newZoom,
    }
    dirtyRef.current = true
    lastWheelTsRef.current = performance.now()
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
