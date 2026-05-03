/**
 * F-NEXT-C — per-theme background-nebula layer (Stage C).
 *
 * Painted between the canvas clear and the existing prerendered backdrop in
 * `StarMap.tsx`. JWST gets a deep-field teal+pink wash plus 180 background
 * pinpoints; vapor gets a synthwave gradient + Tron-grid horizon.
 *
 * Both painters are expensive enough (the JWST pass alone draws hundreds of
 * gradient blobs + 180 arcs) that doing them per frame would tank pan/zoom
 * performance. We rasterise into a single-slot offscreen canvas keyed on
 * `(seedKey, w, h, dpr)` and re-blit the cached canvas every frame; the
 * blit is one `drawImage` call. The cache invalidates on resize / theme
 * change.
 *
 * Both `paintNebulaCloud` and the painters are pure (no React, no Node
 * APIs) — DOM is touched only via `document.createElement('canvas')` for
 * the offscreen cache. Same id (or seedKey) → same image forever.
 *
 * Ported from `docs/gui-update/star-renderers.js`:
 *   - `paintNebulaCloud` (lines 530–666) — shared with `themes/jwst/drawers.ts`
 *   - `drawDeepFieldBackground` (lines 77–128) — JWST background
 *   - `drawVaporBg` `crisp=true` branch (lines 707–738) — vapor background
 *
 * The user picked 6% effective alpha for the JWST nebula clouds (deck
 * default is 10%); we apply a 0.6× multiplier to both `dustAlpha` and
 * `intensity` for both clouds to honour that call.
 */

import { rngPick, rngRange, hashStr, type RGB } from './proc'

/* -------------------------------------------------------------------------- */
/* Shared paintNebulaCloud — also used by themes/jwst/drawers.ts              */
/* -------------------------------------------------------------------------- */

export interface NebulaCloudOpts {
  bands: RGB[]
  hot: RGB[]
  dustAlpha: number
  filaments: number
  shape: { ax: number; ay: number; rot: number }
  intensity?: number
  /** When true, skips the bright Hα emission knot pass (used by background washes). */
  skipKnots?: boolean
  /**
   * When true, emits the feathered destination-out radial mask at the end so
   * the hard `arc` clip boundary isn't visible at deep zoom. Used by typed
   * sprites where the sprite tile gets scaled by the renderer; background
   * full-canvas paints don't need it (they cover the entire viewport
   * already and never get scaled past 1×).
   */
  feather?: boolean
}

/**
 * Carina-class procedural nebula cloud. Six layered passes inside a circular
 * clip:
 *   1. Large dim diffuse base in `bands[0]` (cool base colour)
 *   2. Medium accent blobs from non-base bands
 *   3. Tiny bright detail blobs (highest octave)
 *   4. Bezier filament strokes (wispy ridges)
 *   5. Dark dust lanes (subtractive, scaled by `dustAlpha`)
 *   6. Bright Hα emission knots (skippable via `skipKnots`)
 *   7. (Optional) feathered radial alpha mask to soften the clip boundary
 *
 * `rng()` call order is intentional and stable; reordering reseeds every
 * downstream feature and shifts the visual identity of every cloud. Treat
 * this as a frozen contract — see CLAUDE.md "F8b per-id jitter" caveat,
 * the same rule applies here.
 */
export function paintNebulaCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  rng: () => number,
  opts: NebulaCloudOpts,
): void {
  const { bands, hot, dustAlpha, filaments, shape } = opts
  const intensity = opts.intensity ?? 1
  const ax = shape.ax
  const ay = shape.ay
  const rot = shape.rot
  const cosR = Math.cos(rot), sinR = Math.sin(rot)

  function place(): { x: number; y: number } {
    // Sample within an ellipse, biased toward the centre.
    const t = Math.pow(rng(), 1.6)
    const a = rng() * Math.PI * 2
    const lx = Math.cos(a) * t * R * ax
    const ly = Math.sin(a) * t * R * ay
    return { x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR }
  }

  ctx.save()
  // Hard circular clip prevents blob overflow into the rectangular sprite
  // tile (blobs near the boundary can extend beyond R + R*0.9). The
  // optional feather pass at the end softens this clip so the boundary
  // itself isn't visible at deep zoom.
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2); ctx.clip()

  // Pass 1: large dim diffuse base in band[0] (the cool base colour).
  ctx.globalCompositeOperation = 'lighter'
  const baseLayers = 14
  for (let i = 0; i < baseLayers; i++) {
    const p = place()
    const sz = rngRange(rng, R * 0.4, R * 0.9)
    const c = bands[0]
    const a = rngRange(rng, 0.05, 0.14) * intensity
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz)
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`)
    g.addColorStop(0.6, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.35})`)
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
  }

  // Pass 2: medium accent blobs (warm + magenta, etc — any non-base band).
  const accentLayers = 22
  const accentBands = bands.length > 1 ? bands.slice(1) : bands
  for (let i = 0; i < accentLayers; i++) {
    const p = place()
    const sz = rngRange(rng, R * 0.18, R * 0.45)
    const c = rngPick(rng, accentBands)
    const a = rngRange(rng, 0.10, 0.28) * intensity
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz)
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`)
    g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.4})`)
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
  }

  // Pass 3: tiny bright detail blobs (highest octave).
  const detailLayers = 60
  for (let i = 0; i < detailLayers; i++) {
    const p = place()
    const sz = rngRange(rng, R * 0.04, R * 0.16)
    const c = rngPick(rng, bands)
    const a = rngRange(rng, 0.18, 0.45) * intensity
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz)
    g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`)
    g.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.3})`)
    g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
  }

  // Pass 4: filament strokes — curved 3-segment Beziers as wispy ridges.
  for (let i = 0; i < filaments; i++) {
    const p0 = place()
    const len = rngRange(rng, R * 0.3, R * 0.7)
    const dir = rng() * Math.PI * 2
    const ex = p0.x + Math.cos(dir) * len
    const ey = p0.y + Math.sin(dir) * len
    const cp1x = p0.x + Math.cos(dir) * len * 0.33 + rngRange(rng, -R * 0.18, R * 0.18)
    const cp1y = p0.y + Math.sin(dir) * len * 0.33 + rngRange(rng, -R * 0.18, R * 0.18)
    const cp2x = p0.x + Math.cos(dir) * len * 0.66 + rngRange(rng, -R * 0.18, R * 0.18)
    const cp2y = p0.y + Math.sin(dir) * len * 0.66 + rngRange(rng, -R * 0.18, R * 0.18)
    const c = rngPick(rng, bands)
    const a = rngRange(rng, 0.06, 0.13)
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`
    ctx.lineWidth = rngRange(rng, R * 0.05, R * 0.12)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey)
    ctx.stroke()
  }

  // Pass 5: dark dust lanes (subtractive).
  if (dustAlpha > 0) {
    ctx.globalCompositeOperation = 'destination-out'
    const dustCount = 18
    for (let i = 0; i < dustCount; i++) {
      const p = place()
      const sz = rngRange(rng, R * 0.10, R * 0.32)
      const a = rngRange(rng, dustAlpha * 0.4, dustAlpha)
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz)
      g.addColorStop(0, `rgba(0,0,0,${a})`)
      g.addColorStop(0.6, `rgba(0,0,0,${a * 0.3})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
    }
  }

  // Pass 6: bright Hα emission knots.
  if (!opts.skipKnots) {
    ctx.globalCompositeOperation = 'lighter'
    const knots = 10
    for (let i = 0; i < knots; i++) {
      const p = place()
      const sz = rngRange(rng, R * 0.010, R * 0.028)
      const c = rngPick(rng, hot)
      const bg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 4)
      bg.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.30)`)
      bg.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
      ctx.fillStyle = bg
      ctx.beginPath(); ctx.arc(p.x, p.y, sz * 4, 0, Math.PI * 2); ctx.fill()
      const hc = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz)
      hc.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.7)`)
      hc.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
      ctx.fillStyle = hc
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill()
    }
  }

  // Optional feathered radial alpha mask. Smoothly erases blob density
  // toward the clip boundary so the boundary itself isn't visible at deep
  // zoom. Used by typed nebula sprites; full-canvas background washes
  // already cover the whole viewport and don't need it.
  if (opts.feather) {
    ctx.globalCompositeOperation = 'destination-out'
    const feather = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.05)
    feather.addColorStop(0.00, 'rgba(0,0,0,0)')
    feather.addColorStop(0.50, 'rgba(0,0,0,0.45)')
    feather.addColorStop(1.00, 'rgba(0,0,0,1)')
    ctx.fillStyle = feather
    ctx.fillRect(cx - R * 1.1, cy - R * 1.1, R * 2.2, R * 2.2)
  }

  ctx.restore()
}

/* -------------------------------------------------------------------------- */
/* Mulberry32 PRNG (deterministic per seed)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Local mulberry32 — paintJwstDeepField needs three independent streams
 * (one per cloud + one for the pinpoint pass), so we derive them from the
 * caller's `seedKey` rather than the shared `seedFromId`. Same algorithm
 * as `proc.ts:seedFromId`; duplicating to avoid coupling cache-key
 * derivation to the per-id sprite seeding contract.
 */
function rngFromSeed(seed: number): () => number {
  let s = seed >>> 0
  return function rng(): number {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* -------------------------------------------------------------------------- */
/* JWST deep-field background                                                 */
/* -------------------------------------------------------------------------- */

// User-chosen 6% effective alpha vs deck default 10% → multiplier 0.6 on
// both `dustAlpha` and `intensity` for both clouds.
const JWST_ALPHA_SCALE = 0.6

/**
 * JWST background: dark base + two paintNebulaCloud washes (teal-blue at
 * left-bottom, magenta at right-top) + 180 background pinpoints with
 * cool/neutral/warm colour-temperature variation.
 *
 * Renders into the supplied `ctx` in CSS-pixel coordinates (the StarMap
 * draw loop has already applied the dpr transform). The caller passes the
 * full backing-store size in CSS pixels (the canvas size, not the scaled
 * size).
 */
function paintJwstDeepFieldDirect(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seedSalt: number,
): void {
  ctx.fillStyle = '#05060f'
  ctx.fillRect(0, 0, w, h)

  const big = Math.max(w, h)

  // Cloud 1: teal/blue base + warm + magenta accents at left-bottom.
  paintNebulaCloud(ctx, w * 0.30, h * 0.65, big * 0.55, rngFromSeed(seedSalt ^ 0x111), {
    bands: [
      [40, 70, 100],
      [70, 140, 160],
      [180, 110, 90],
      [200, 90, 120],
    ],
    hot: [[255, 230, 200]],
    dustAlpha: 0.10 * JWST_ALPHA_SCALE,
    filaments: 0,
    intensity: 0.35 * JWST_ALPHA_SCALE,
    skipKnots: true,
    shape: { ax: 1.0, ay: 0.7, rot: 0.4 },
  })

  // Cloud 2: magenta + violet base at right-top.
  paintNebulaCloud(ctx, w * 0.78, h * 0.30, big * 0.45, rngFromSeed(seedSalt ^ 0x222), {
    bands: [
      [80, 50, 80],
      [180, 100, 130],
      [120, 80, 140],
    ],
    hot: [[255, 200, 220]],
    dustAlpha: 0.06 * JWST_ALPHA_SCALE,
    filaments: 0,
    intensity: 0.30 * JWST_ALPHA_SCALE,
    skipKnots: true,
    shape: { ax: 1.1, ay: 0.6, rot: -0.3 },
  })

  // 180 background pinpoints with colour-temp variation. The deck samples
  // 4 rng() values per dot (x, y, magnitude bias, colour-temp pick); the
  // alpha is derived from the magnitude so faint distant dots stay subtle.
  const r = rngFromSeed(seedSalt ^ 0xbeef)
  ctx.save()
  for (let i = 0; i < 180; i++) {
    const x = r() * w
    const y = r() * h
    const mag = Math.pow(r(), 2.5)
    const sz = 0.4 + mag * 1.4
    const t = r()
    const col = t < 0.55 ? '255,250,235' : t < 0.85 ? '180,210,255' : '255,180,150'
    ctx.fillStyle = `rgba(${col},${0.35 + mag * 0.6})`
    ctx.beginPath()
    ctx.arc(x, y, sz, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/* -------------------------------------------------------------------------- */
/* Vapor synthwave background                                                 */
/* -------------------------------------------------------------------------- */

const VAPOR_SUNSET_STOPS: ReadonlyArray<[number, string]> = [
  [0.00, '#0a0028'],
  [0.45, '#3a0066'],
  [0.60, '#a01080'],
  [0.78, '#ff3a8a'],
  [0.90, '#ff7e1a'],
  [1.00, '#100018'],
]

/**
 * Vapor background: six-stop synthwave gradient + Tron-grid horizon (8
 * horizontal lines fading toward the horizon + 15 vanishing-point lines
 * radiating from the centre). NO scanlines or chromatic aberration —
 * those are Stage D. The horizontal-line spacing uses the deck's
 * `(i/8)²` square-distance falloff so lines crowd toward the horizon.
 */
function paintVaporBgDirect(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  // Six-stop synthwave gradient. Replaces the old destination-over fill in
  // vapor/background.ts so the gradient owns the whole sky rather than
  // sitting underneath whatever the StarMap clear pass left behind.
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (const [t, c] of VAPOR_SUNSET_STOPS) g.addColorStop(t, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)

  // Tron-grid horizon — 8 horizontal lines with quadratic spacing so the
  // density increases toward the camera. Cyan at increasing alpha as
  // they near the bottom of the screen.
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 245, 255, 0.55)'
  ctx.lineWidth = 1
  const horizon = h * 0.58
  for (let i = 0; i < 8; i++) {
    const t = i / 8
    const y = horizon + (h - horizon) * t * t
    ctx.globalAlpha = 0.25 + i * 0.08
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }
  // 15 vanishing-point lines radiating from a centre point on the horizon.
  const vpx = w / 2
  ctx.strokeStyle = 'rgba(255, 42, 252, 0.55)'
  for (let i = -7; i <= 7; i++) {
    ctx.globalAlpha = 0.35
    ctx.beginPath()
    ctx.moveTo(vpx, horizon)
    ctx.lineTo(vpx + i * (w / 14), h)
    ctx.stroke()
  }
  ctx.restore()
}

/* -------------------------------------------------------------------------- */
/* Single-slot offscreen-canvas cache                                         */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  canvas: HTMLCanvasElement
  /** Cache key fingerprint; rebuild when this changes. */
  key: string
}

let cached: CacheEntry | null = null

/** Test/utility hook to clear the cache (e.g. between vitest runs). */
export function clearBackgroundNebulaCache(): void {
  cached = null
}

/**
 * Common cache wrapper. `painter` receives a fresh ctx pointed at an
 * offscreen canvas of (`w` CSS px × `dpr`) backing-store size, with the
 * dpr transform already applied. Re-rasterises only when the key
 * fingerprint changes; otherwise re-blits the cached canvas at 1:1 onto
 * the supplied target ctx.
 */
function withCachedBlit(
  target: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  key: string,
  painter: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
  if (!cached || cached.key !== key) {
    const off = document.createElement('canvas')
    off.width = Math.max(1, Math.round(w * dpr))
    off.height = Math.max(1, Math.round(h * dpr))
    const offCtx = off.getContext('2d')!
    // Match the main canvas's smoothing posture for the rasterise pass.
    // High-quality bilinear is fine for nebula gradients; vapor's
    // hard-edge grid is rendered at integer pixels so smoothing has no
    // visible effect.
    offCtx.imageSmoothingEnabled = true
    offCtx.imageSmoothingQuality = 'high'
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    painter(offCtx, w, h)
    cached = { canvas: off, key }
  }
  // The target ctx already has the dpr transform applied (StarMap.draw
  // sets it once at the top of every frame). Reset to identity for the
  // blit so we draw the cached pixel buffer 1:1 against the backing
  // store, then restore.
  target.save()
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.drawImage(cached.canvas, 0, 0)
  target.restore()
}

/* -------------------------------------------------------------------------- */
/* Public painter exports — wired into Theme.background.paint                 */
/* -------------------------------------------------------------------------- */

/**
 * JWST deep-field background painter. Paints the cached deep-field image
 * onto `ctx`, rasterising on first call / cache miss. `seedKey` is hashed
 * to derive the cloud + pinpoint PRNG streams; pass any stable string
 * (typically the theme id).
 */
export function paintJwstDeepField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  seedKey: string,
): void {
  const seedSalt = hashStr(seedKey)
  const key = `jwst:${seedSalt}:${w}:${h}:${dpr}`
  withCachedBlit(ctx, w, h, dpr, key, (offCtx, ow, oh) => {
    paintJwstDeepFieldDirect(offCtx, ow, oh, seedSalt)
  })
}

/**
 * Vapor synthwave background painter. Vapor is fully deterministic per
 * `(w, h, dpr)` (no PRNG), so `seedKey` is folded into the key but never
 * affects pixel output.
 */
export function paintVaporBg(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  dpr: number,
  seedKey: string,
): void {
  const key = `vapor:${seedKey}:${w}:${h}:${dpr}`
  withCachedBlit(ctx, w, h, dpr, key, (offCtx, ow, oh) => {
    paintVaporBgDirect(offCtx, ow, oh)
  })
}
