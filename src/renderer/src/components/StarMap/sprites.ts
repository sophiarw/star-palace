import { CONSTELLATION_PALETTE } from '@shared/types'
import type { StarType } from '@shared/types'
import { hashStr } from './proc'

// hashStr is re-exported here to keep existing call sites compiling. The
// canonical definition now lives in proc.ts so the F8a foundation module
// has no DOM dependency (which lets node-only tests import it freely).
export { hashStr }

const SIZE_RADII = [3, 4.5, 6, 8, 11, 16, 22] as const
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

export function getStarSprite(
  colorIndex: number,
  tempBucket: number,
  sizeBucket: number,
): HTMLCanvasElement {
  const key = `${colorIndex}|${tempBucket}|${sizeBucket}`
  const cached = cache.get(key)
  if (cached) return cached
  const sprite = renderSprite(colorIndex, tempBucket, sizeBucket)
  cache.set(key, sprite)
  return sprite
}

function renderSprite(colorIndex: number, tempBucket: number, sizeBucket: number): HTMLCanvasElement {
  const r = spriteCoreRadius(sizeBucket)
  const half = Math.ceil(r * HALO_FACTOR)
  const size = half * 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = half, cy = half

  const baseHex = colorIndex < 0
    ? NO_CLUSTER_HEX
    : CONSTELLATION_PALETTE[colorIndex % CONSTELLATION_PALETTE.length]
  const baseRgb = parseHex(baseHex)
  const tinted = blend(baseRgb, TEMP_TARGETS[tempBucket], TEMP_STRENGTH[tempBucket])
  const core = blend(tinted, [255, 255, 255], 0.6)

  // Soft halo (broad falloff)
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, half)
  halo.addColorStop(0, rgbCss(core, 0.85))
  halo.addColorStop(0.12, rgbCss(tinted, 0.5))
  halo.addColorStop(0.45, rgbCss(tinted, 0.12))
  halo.addColorStop(1, rgbCss(tinted, 0))
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)

  // Diffraction spikes baked in for sizeBucket >= 2
  if (sizeBucket >= 2) {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    const reach = half * SPIKE_REACH
    const lineWidth = sizeBucket >= 4 ? 1.4 : sizeBucket >= 3 ? 1.1 : 0.9
    for (const ang of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
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

const TYPED_SCALE: Record<StarType, number> = {
  'red-giant': 1.7,
  'blue-supergiant': 1.7,
  'white-dwarf': 0.6,
  'neutron-star': 0.45,
  'pulsar': 0.7,
  'binary': 1.2,
  'quasar': 1.0,
  'black-hole': 1.4,
  'nebula': 2.4,
}

export function getTypedStarSprite(type: StarType, sizeBucket: number): HTMLCanvasElement {
  const key = `type:${type}|${sizeBucket}`
  const cached = cache.get(key)
  if (cached) return cached
  const sprite = renderTypedSprite(type, sizeBucket)
  cache.set(key, sprite)
  return sprite
}

function renderTypedSprite(type: StarType, sizeBucket: number): HTMLCanvasElement {
  const baseR = spriteCoreRadius(sizeBucket) * TYPED_SCALE[type]
  // Reserve halo room: nebula needs the most, jet types need ~3.5×
  const haloFactor = type === 'nebula' ? 1.6 : type === 'quasar' ? 4.5 : type === 'pulsar' ? 3.8 : HALO_FACTOR
  const half = Math.ceil(baseR * haloFactor)
  const size = half * 2
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = half, cy = half

  switch (type) {
    case 'red-giant':       drawRedGiant(ctx, cx, cy, baseR); break
    case 'blue-supergiant': drawBlueSupergiant(ctx, cx, cy, baseR, sizeBucket); break
    case 'white-dwarf':     drawWhiteDwarf(ctx, cx, cy, baseR); break
    case 'neutron-star':    drawNeutronStar(ctx, cx, cy, baseR); break
    case 'pulsar':          drawPulsarStatic(ctx, cx, cy, baseR); break
    case 'binary':          drawBinary(ctx, cx, cy, baseR); break
    case 'quasar':          drawQuasarStatic(ctx, cx, cy, baseR); break
    case 'black-hole':      drawBlackHole(ctx, cx, cy, baseR); break
    case 'nebula':          drawNebulaBlob(ctx, cx, cy, baseR); break
  }

  return canvas
}

function drawRedGiant(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2)
  halo.addColorStop(0, 'rgba(255,200,150,0.85)')
  halo.addColorStop(0.18, 'rgba(255,140,80,0.55)')
  halo.addColorStop(0.55, 'rgba(180,50,30,0.18)')
  halo.addColorStop(1, 'rgba(120,20,10,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.3)
  core.addColorStop(0, 'rgba(255,230,200,1)')
  core.addColorStop(0.4, 'rgba(255,160,90,0.95)')
  core.addColorStop(1, 'rgba(220,80,40,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2)
  ctx.fill()
}

function drawBlueSupergiant(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, sizeBucket: number): void {
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2)
  halo.addColorStop(0, 'rgba(220,235,255,0.9)')
  halo.addColorStop(0.18, 'rgba(120,160,255,0.55)')
  halo.addColorStop(0.55, 'rgba(40,70,200,0.18)')
  halo.addColorStop(1, 'rgba(0,10,80,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Long sharp spikes
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const reach = r * 3.0
  const lineWidth = sizeBucket >= 4 ? 1.6 : 1.3
  for (const ang of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
    const dx = Math.cos(ang) * reach
    const dy = Math.sin(ang) * reach
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
    grad.addColorStop(0, 'rgba(120,160,255,0)')
    grad.addColorStop(0.45, 'rgba(220,235,255,0.85)')
    grad.addColorStop(0.5, 'rgba(255,255,255,1)')
    grad.addColorStop(0.55, 'rgba(220,235,255,0.85)')
    grad.addColorStop(1, 'rgba(120,160,255,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    ctx.moveTo(cx - dx, cy - dy)
    ctx.lineTo(cx + dx, cy + dy)
    ctx.stroke()
  }
  ctx.restore()

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.3)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.45, 'rgba(180,210,255,0.95)')
  core.addColorStop(1, 'rgba(60,120,220,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2)
  ctx.fill()
}

function drawWhiteDwarf(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.6, 'rgba(220,230,255,0.7)')
  grad.addColorStop(1, 'rgba(180,200,240,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2)
  ctx.fill()
}

function drawNeutronStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Sharp 6-point spikes, tiny but blinding
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const reach = r * 5
  for (const ang of [0, Math.PI / 3, (Math.PI * 2) / 3]) {
    const dx = Math.cos(ang) * reach
    const dy = Math.sin(ang) * reach
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy)
    grad.addColorStop(0, 'rgba(220,220,255,0)')
    grad.addColorStop(0.48, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.5, 'rgba(255,255,255,1)')
    grad.addColorStop(0.52, 'rgba(255,255,255,0.95)')
    grad.addColorStop(1, 'rgba(220,220,255,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - dx, cy - dy)
    ctx.lineTo(cx + dx, cy + dy)
    ctx.stroke()
  }
  ctx.restore()

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.4, 'rgba(255,255,255,0.85)')
  core.addColorStop(1, 'rgba(200,210,255,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawPulsarStatic(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Static halo + bright tight core. The rotating beam is drawn per-frame elsewhere.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5)
  halo.addColorStop(0, 'rgba(180,220,255,0.6)')
  halo.addColorStop(0.4, 'rgba(120,180,240,0.18)')
  halo.addColorStop(1, 'rgba(80,140,210,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.2)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.5, 'rgba(220,235,255,0.85)')
  core.addColorStop(1, 'rgba(150,200,255,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2)
  ctx.fill()
}

function drawBinary(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const offset = r * 1.2
  // Shared halo
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.5)
  halo.addColorStop(0, 'rgba(255,210,170,0.5)')
  halo.addColorStop(0.4, 'rgba(255,170,120,0.15)')
  halo.addColorStop(1, 'rgba(180,80,60,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Two cores
  for (const sign of [-1, 1]) {
    const x = cx + sign * offset
    const grad = ctx.createRadialGradient(x, cy, 0, x, cy, r * 1.1)
    grad.addColorStop(0, 'rgba(255,240,210,1)')
    grad.addColorStop(0.5, 'rgba(255,180,120,0.9)')
    grad.addColorStop(1, 'rgba(220,90,50,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, cy, r * 1.1, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawQuasarStatic(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Static core + halo. Polar jets are drawn per-frame for shimmer.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4)
  halo.addColorStop(0, 'rgba(255,200,255,0.8)')
  halo.addColorStop(0.3, 'rgba(220,140,240,0.4)')
  halo.addColorStop(1, 'rgba(120,40,180,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.4, 'rgba(255,210,255,0.95)')
  core.addColorStop(1, 'rgba(220,140,240,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2)
  ctx.fill()
}

function drawBlackHole(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Dim outer warp, bright orange ring, dark interior.
  const warp = ctx.createRadialGradient(cx, cy, r * 1.3, cx, cy, r * 3.5)
  warp.addColorStop(0, 'rgba(60,30,80,0.5)')
  warp.addColorStop(0.7, 'rgba(30,15,60,0.2)')
  warp.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = warp
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Accretion ring (additive)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const ringGrad = ctx.createRadialGradient(cx, cy, r * 0.95, cx, cy, r * 1.45)
  ringGrad.addColorStop(0, 'rgba(255,140,40,0)')
  ringGrad.addColorStop(0.4, 'rgba(255,180,80,0.95)')
  ringGrad.addColorStop(0.6, 'rgba(255,220,140,1)')
  ringGrad.addColorStop(1, 'rgba(255,140,40,0)')
  ctx.fillStyle = ringGrad
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Pure-black event horizon (overrides additive blend in StarMap by drawing a true black disc)
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawNebulaBlob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Diffuse multi-color cloud with no defined core.
  const layers: [number, number, number][] = [
    [120, 80, 200],   // purple
    [60, 110, 200],   // blue
    [200, 100, 130],  // pink
  ]
  for (const [rC, gC, bC] of layers) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4)
    grad.addColorStop(0, `rgba(${rC},${gC},${bC},0.35)`)
    grad.addColorStop(0.5, `rgba(${rC},${gC},${bC},0.12)`)
    grad.addColorStop(1, `rgba(${rC},${gC},${bC},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }
}

