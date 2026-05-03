import { CONSTELLATION_PALETTE } from '@shared/types'
import type { StarType } from '@shared/types'
import { hashStr, ThemeAwareSpriteCache, seedFromId, type SpikeVariant } from './proc'
import type { Theme } from '../../themes/types'

// hashStr is re-exported here to keep existing call sites compiling. The
// canonical definition now lives in proc.ts so the F8a foundation module
// has no DOM dependency (which lets node-only tests import it freely).
export { hashStr }

const SIZE_RADII = [2.79, 4.19, 5.59, 7.45, 10.24, 14.9, 20.48] as const  // 1.33× to compensate for F15 reduced halo glow
export const SIZE_BUCKET_COUNT = SIZE_RADII.length
export const TEMP_BUCKET_COUNT = 4

const HALO_FACTOR = 3.5
const SPIKE_REACH = 0.92

const WARM: RGB = [0xff, 0xb0, 0x70]
const COOL: RGB = [0xa0, 0xc8, 0xff]
const TEMP_TARGETS: RGB[] = [WARM, WARM, COOL, COOL]
const TEMP_STRENGTH = [0.35, 0.12, 0.12, 0.35]

const NO_CLUSTER_HEX = '#7a8aa3'

type RGB = [number, number, number]

function parseHex(hex: string): RGB {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbCss(rgb: RGB, alpha: number): string {
  return `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},${alpha})`
}

function blend(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ]
}

export function tempBucketFor(starId: string): number {
  return hashStr(starId) % TEMP_BUCKET_COUNT
}

export function sizeBucketFor(viewCount: number): number {
  if (viewCount < 1) return 0
  if (viewCount < 4) return 1
  if (viewCount < 12) return 2
  if (viewCount < 40) return 3
  return 4
}

export function spriteCoreRadius(sizeBucket: number): number {
  const idx = Math.max(0, Math.min(SIZE_RADII.length - 1, sizeBucket))
  return SIZE_RADII[idx]
}

const cache = new Map<string, HTMLCanvasElement>()

// Sprites bake at the same effective DPR the main canvas uses, so the
// rasterised bitmap matches the device pixel grid the renderer eventually
// blits onto. Without this, every `drawImage` upscales by `dpr` and the
// browser's bilinear filter softens the result. Bucketed to nearest 0.5 so
// trivial DPR drift (e.g. window dragged across two displays) doesn't
// thrash the cache.
let currentSpriteDpr = 1
function bucketDpr(dpr: number): number {
  return Math.max(1, Math.round(dpr * 2) / 2)
}
export function setSpriteCacheDpr(dpr: number): void {
  currentSpriteDpr = bucketDpr(dpr)
}

// Logical (CSS-pixel) dimensions of a baked sprite. The backing canvas
// width/height are in *device* pixels (size × spriteDpr); consumers that
// want to draw at logical size must divide by the dpr stamped on the canvas.
export function spriteLogicalSize(sprite: HTMLCanvasElement): { w: number; h: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dpr = (sprite as any).__spriteDpr as number | undefined
  const d = dpr && dpr > 0 ? dpr : 1
  return { w: sprite.width / d, h: sprite.height / d }
}

/**
 * Sprite level-of-detail. `'full'` is the existing artwork path; `'cheap'`
 * skips the per-frame-expensive bits — diffraction spikes for the default
 * sprite, the entire procedural drawer for typed sprites — so far-out
 * stars cost a single halo+core blit. The renderer picks the LOD from the
 * graphics-quality setting + on-screen sprite size at draw time; sprites
 * are cached separately per LOD so swapping never recomputes.
 */
export type Lod = 'cheap' | 'full'

/**
 * F8b — `spikeVariant` adds a 4-spike alternative to the existing 6-spike
 * default for sizeBucket >= 2. The bucket count grows from 120 → 240 (still
 * tiny). Per-id rotation + alpha jitter are NOT baked here; they're applied
 * at draw time in StarMap so we keep the no-cache plan for those axes.
 * `SpikeVariant` lives in `proc.ts` (canonical home for procedural types).
 */

// Phase 0 instrumentation. Module-local counters incremented on hit/miss so
// the perf overlay can answer "is the cache thrashing?" without touching the
// hot path. `spriteCacheStats()` is read once per frame from the rAF loop in
// StarMap.tsx; no per-call recordCounter to keep get*() inlinable.
let _defaultMisses = 0
let _defaultHits = 0
let _typedMisses = 0
let _typedHits = 0

export function spriteCacheStats(): {
  defaultSize: number
  defaultMisses: number
  defaultHits: number
  typedSize: number
  typedMisses: number
  typedHits: number
} {
  return {
    defaultSize: cache.size,
    defaultMisses: _defaultMisses,
    defaultHits: _defaultHits,
    typedSize: typedCache.size(),
    typedMisses: _typedMisses,
    typedHits: _typedHits,
  }
}

// Phase 1.6 — default cache cardinality is bounded by
// CONSTELLATION_PALETTE.length × TEMP_BUCKET_COUNT × SIZE_BUCKET_COUNT ×
// 2 spike variants × 2 LODs ≈ low thousands. Eviction never fires in
// practice; assert in DEV if it grows past a sensible ceiling so a future
// bucket-count change surfaces as a test failure rather than silent leak.
const DEFAULT_CACHE_DEV_CEILING = 4096

export function getStarSprite(
  colorIndex: number,
  tempBucket: number,
  sizeBucket: number,
  spikeVariant: SpikeVariant = 6,
  lod: Lod = 'full',
): HTMLCanvasElement {
  const dpr = currentSpriteDpr
  const key = `${colorIndex}|${tempBucket}|${sizeBucket}|${spikeVariant}|${lod}|d:${dpr}`
  const cached = cache.get(key)
  if (cached) { _defaultHits++; return cached }
  _defaultMisses++
  const sprite = renderSprite(colorIndex, tempBucket, sizeBucket, spikeVariant, lod, dpr)
  cache.set(key, sprite)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((import.meta as any).env?.DEV && cache.size > DEFAULT_CACHE_DEV_CEILING) {
    console.warn(`[sprites] default cache size (${cache.size}) > ${DEFAULT_CACHE_DEV_CEILING}; bucket count may have drifted.`)
  }
  return sprite
}

function renderSprite(
  colorIndex: number,
  tempBucket: number,
  sizeBucket: number,
  spikeVariant: SpikeVariant,
  lod: Lod,
  dpr: number,
): HTMLCanvasElement {
  const r = spriteCoreRadius(sizeBucket)
  const half = Math.ceil(r * HALO_FACTOR)
  const size = half * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(canvas as any).__spriteDpr = dpr
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cx = half, cy = half

  const baseHex = colorIndex < 0
    ? NO_CLUSTER_HEX
    : CONSTELLATION_PALETTE[colorIndex % CONSTELLATION_PALETTE.length]
  const baseRgb = parseHex(baseHex)
  const tinted = blend(baseRgb, TEMP_TARGETS[tempBucket], TEMP_STRENGTH[tempBucket])
  const core = blend(tinted, [255, 255, 255], 0.6)

  // F-NEXT-B — halo grading ported from the graphics-update deck
  // (docs/gui-update/star-renderers.js, jwstMainSequence crisp branch).
  // Inner 5% holds full brightness; mid-stops fall off fast (0.85 → 0.45 over
  // 12-20% radius) so the disc reads as a tight bright nucleus instead of a
  // broad fog patch. Outer tail lingers at < 0.20 alpha for the long thin
  // glow signature. Cheap LOD keeps the 2-stop fast path; at small on-screen
  // sizes the broader gradient detail isn't visible anyway.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, half)
  if (lod === 'cheap') {
    halo.addColorStop(0, rgbCss(core, 1))
    halo.addColorStop(1, rgbCss(tinted, 0))
  } else {
    halo.addColorStop(0.00, rgbCss(core, 1))
    halo.addColorStop(0.05, rgbCss(core, 1))
    halo.addColorStop(0.12, rgbCss(tinted, 0.85))
    halo.addColorStop(0.20, rgbCss(tinted, 0.45))
    halo.addColorStop(0.35, rgbCss(tinted, 0.18))
    halo.addColorStop(0.55, rgbCss(tinted, 0.06))
    halo.addColorStop(1.00, rgbCss(tinted, 0))
  }
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)

  // Diffraction spikes baked in for sizeBucket >= 2.
  // F8b — spikeVariant=6 keeps the original 3 strokes (6 arms) at angles
  // {0, π/3, 2π/3}; spikeVariant=4 draws 2 strokes (4 arms) at {0, π/2}.
  // Per-id rotation applied at draw time orients these spikes in StarMap.
  // Cheap LOD skips the spike pass entirely — the linear gradient + stroke
  // is the heaviest part of the bucket sprite and is invisible at the
  // sizes that route through cheap.
  if (sizeBucket >= 2 && lod !== 'cheap') {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    const reach = half * SPIKE_REACH
    const lineWidth = sizeBucket >= 4 ? 1.4 : sizeBucket >= 3 ? 1.1 : 0.9
    const spikeAngles = spikeVariant === 4
      ? [0, Math.PI / 2]
      : [0, Math.PI / 3, (Math.PI * 2) / 3]
    for (const ang of spikeAngles) {
      const dx = Math.cos(ang) * reach
      const dy = Math.sin(ang) * reach
      const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
      grad.addColorStop(0, rgbCss(tinted, 0))
      grad.addColorStop(0.4, rgbCss(core, 0.6))
      grad.addColorStop(0.5, rgbCss(core, 0.95))
      grad.addColorStop(0.6, rgbCss(core, 0.6))
      grad.addColorStop(1, rgbCss(tinted, 0))
      ctx.strokeStyle = grad
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      ctx.moveTo(cx - dx, cy - dy)
      ctx.lineTo(cx + dx, cy + dy)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Tight bright core (drawn last so it sits on top of spikes)
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.2)
  coreGrad.addColorStop(0, rgbCss(core, 1))
  coreGrad.addColorStop(0.45, rgbCss(blend(core, tinted, 0.4), 0.85))
  coreGrad.addColorStop(1, rgbCss(tinted, 0))
  ctx.fillStyle = coreGrad
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2)
  ctx.fill()

  return canvas
}

export function clearSpriteCache(): void {
  cache.clear()
}

// ---- Typed star sprites (manual override via star_type) ----
//
// F11 — sprite key carries a theme prefix + 12-bit hash bucket of the star
// id so swapping themes is O(visible-stars) re-renders and per-id procedural
// variation (F8a) lives across both themes. LRU cap=500 (procedural-graphics
// plan); 9 types × 7 sizes × 4096 hashes is the upper bound but the working
// set stays tiny.

const TYPED_SCALE: Record<StarType, number> = {
  'red-giant': 1.7,
  'blue-supergiant': 1.7,
  'white-dwarf': 0.6,
  'main-sequence': 1.0,    // F10: between white-dwarf (0.6) and red-giant (1.7)
  'neutron-star': 0.85,    // F8a v4: bumped from 0.45 — was dwarfed by red dots
  'pulsar': 1.15,          // F8a v4: bumped from 0.7 for telescope-quality detail
  'binary': 1.2,
  'quasar': 1.0,
  'black-hole': 1.4,
  'nebula': 2.4,
}

// Phase 1.5 — cap raised 500 → 4000 with a 96 MB byte ceiling and
// theme-aware eviction (see Report 4 §B.2 + ThemeAwareSpriteCache in
// proc.ts). At a 7822-star corpus the prior cap=500 thrashed at 758k
// misses per pan; this sizing keeps the working set resident across
// pan/zoom and makes second theme flip ~free.
//
// F-NEXT-A — sprites now bake at effective DPR; a DPR=2 sprite uses ~4×
// the bytes of the previous DPR=1 bake. The plan's first cut halved the
// entry cap (4000→2000) on the assumption byte cap would dominate, but in
// practice the working set at retina with ~4.7k visible stars exceeded
// both ceilings and the cache thrashed at ~38% hit rate (~115k misses per
// pan). Restored entry cap to 4000 and bumped byte cap to 512 MB so the
// full visible working set stays resident at DPR=2. Byte cap dominates at
// retina (4000 × ~100 KB ≈ 400 MB), entry cap dominates at DPR=1 (e.g.
// external 1× monitor) where each sprite is ~25 KB.
const TYPED_CACHE_CAP = 4000
const TYPED_CACHE_BYTE_CAP = 512 * 1024 * 1024
const typedCache = new ThemeAwareSpriteCache<string>(TYPED_CACHE_CAP, TYPED_CACHE_BYTE_CAP)

// Notify the cache when the active theme changes so its eviction loop
// prefers victims from the now-inactive theme. StarMap calls this on
// theme prop change.
export function setSpriteCacheActiveTheme(themeId: string): void {
  typedCache.setActiveTheme(themeId)
}

/**
 * Build the cache key for a typed sprite. Theme prefix means switching
 * themes does NOT evict the previous theme's entries — they age out by
 * churn, so flipping back and forth pays only the first switch's cost.
 * `lod` suffix lets the cheap and full tiers coexist for the same star.
 */
function typedSpriteKey(themeId: string, type: StarType, sizeBucket: number, starId: string, lod: Lod, dpr: number): string {
  const hashBucket = hashStr(starId) & 0xfff
  return `${themeId}|type:${type}|s:${sizeBucket}|h:${hashBucket}|lod:${lod}|d:${dpr}`
}

// Per-type tint for the cheap renderer. Mirrors the broad "vibe" of each
// theme drawer at sub-px-level fidelity — at the on-screen sizes that
// route through cheap, all the user perceives is the colour and the halo
// shape, so a one-RGB approximation is enough.
const CHEAP_TINT: Record<StarType, RGB> = {
  'red-giant': [255, 130, 70],
  'blue-supergiant': [140, 180, 255],
  'white-dwarf': [220, 230, 245],
  'main-sequence': [240, 230, 200],
  'neutron-star': [220, 230, 255],
  'pulsar': [180, 230, 255],
  'binary': [240, 200, 140],
  'quasar': [200, 150, 240],
  'black-hole': [80, 50, 80],
  'nebula': [180, 120, 220],
}

export function getTypedStarSprite(
  theme: Theme,
  type: StarType,
  sizeBucket: number,
  starId: string,
  lod: Lod = 'full',
): HTMLCanvasElement {
  const dpr = currentSpriteDpr
  const key = typedSpriteKey(theme.id, type, sizeBucket, starId, lod, dpr)
  const cached = typedCache.get(key)
  if (cached) { _typedHits++; return cached }
  _typedMisses++
  const sprite = lod === 'cheap'
    ? renderCheapTypedSprite(type, sizeBucket, dpr)
    : renderTypedSprite(theme, type, sizeBucket, starId, dpr)
  typedCache.set(key, sprite, theme.id)
  return sprite
}

// Cheap typed sprite: tinted halo + core arc, no procedural drawer call.
// Same canvas size as the full variant so the renderer's drawScale math
// works without a per-LOD branch on the consume side. Black-hole gets a
// dimmer center to keep its "sucks light" silhouette readable; everything
// else is a generic warm/cool glow.
function renderCheapTypedSprite(type: StarType, sizeBucket: number, dpr: number): HTMLCanvasElement {
  const baseR = spriteCoreRadius(sizeBucket) * TYPED_SCALE[type]
  const haloFactor =
    type === 'nebula' ? 2.6 :
    type === 'quasar' ? 4.5 :
    type === 'pulsar' ? 3.8 :
    type === 'black-hole' ? 4.5 :
    HALO_FACTOR
  const half = Math.ceil(baseR * haloFactor)
  const size = half * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(canvas as any).__spriteDpr = dpr
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cx = half, cy = half
  const tint = CHEAP_TINT[type]
  const coreColor = type === 'black-hole' ? tint : blend(tint, [255, 255, 255], 0.6)

  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, half)
  halo.addColorStop(0, rgbCss(coreColor, type === 'black-hole' ? 0.4 : 0.95))
  halo.addColorStop(1, rgbCss(tint, 0))
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)

  if (type !== 'black-hole') {
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.2)
    coreGrad.addColorStop(0, rgbCss(coreColor, 1))
    coreGrad.addColorStop(1, rgbCss(tint, 0))
    ctx.fillStyle = coreGrad
    ctx.beginPath()
    ctx.arc(cx, cy, baseR * 1.2, 0, Math.PI * 2)
    ctx.fill()
  }

  return canvas
}

function renderTypedSprite(
  theme: Theme,
  type: StarType,
  sizeBucket: number,
  starId: string,
  dpr: number,
): HTMLCanvasElement {
  const baseR = spriteCoreRadius(sizeBucket) * TYPED_SCALE[type]
  // Reserve halo room: nebula needs the most, jet types need ~3.5×.
  // Black hole bumped from 3.5 → 4.5 because the new procedural drawer
  // (asymmetric ring + Doppler-bright half + photon sphere) needs more
  // pixel budget; at high zoom the cached sprite was too low-resolution
  // for the detail packed into it (visible pixelation).
  const haloFactor =
    type === 'nebula' ? 2.6 :
    type === 'quasar' ? 4.5 :
    type === 'pulsar' ? 3.8 :
    type === 'black-hole' ? 4.5 :
    HALO_FACTOR
  const half = Math.ceil(baseR * haloFactor)
  const size = half * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(canvas as any).__spriteDpr = dpr
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const cx = half, cy = half

  const drawer = theme.drawers[type] ?? theme.defaultDrawer
  const rng = seedFromId(starId)
  drawer(ctx, cx, cy, baseR, rng, sizeBucket)

  return canvas
}

export function clearTypedSpriteCache(): void {
  typedCache.clear()
}
