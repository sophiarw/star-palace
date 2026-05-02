import { CONSTELLATION_PALETTE } from '@shared/types'

const SIZE_RADII = [3, 4.5, 6, 8, 11] as const
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

export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
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
