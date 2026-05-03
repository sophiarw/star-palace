/**
 * Vapor theme drawers — F8a per-type variation, synthwave/chromatic-
 * aberration aesthetic.
 *
 * Ported from `prototypes/f8a-vapor/index.html` (worktree-agent-acb91a52b583dc370)
 * with no behavioural changes; rng() call order is identical so the same
 * star id renders identically to the prototype deck.
 *
 * Common motifs:
 *  - Posterized colour bands (3-4 hard stops, no smooth gradients)
 *  - 1px neon outlines in contrasting hues
 *  - Hot-pink / cyan / lime / hyper-yellow accents
 *  - ~10% of sprites get glitch-slice displacement (last-roll hash)
 */

import type { ThemedDrawer } from '../types'
import { applyCircularFade, rngPick, rngRange } from '../../components/StarMap/proc'

/* --------------------------------------------------------------------------
 * Vapor utility helpers (private to this module)
 * -------------------------------------------------------------------------- */

type ColorStop = [number, string]  // [t, rgba]

/**
 * Posterized circular halo — N hard colour bands instead of smooth gradient.
 * `bands[i] = [t, 'rgba(...)']`; rings are painted outer-first so inner ones
 * overdraw cleanly.
 */
function paintPosterizedDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  bands: ReadonlyArray<ColorStop>,
  blend?: GlobalCompositeOperation,
): void {
  ctx.save()
  if (blend) ctx.globalCompositeOperation = blend
  const ordered = [...bands].sort((a, b) => b[0] - a[0])
  for (const [t, col] of ordered) {
    ctx.fillStyle = col
    ctx.beginPath()
    ctx.arc(cx, cy, radius * t, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/**
 * Horizontal glitch-slice displacement. Picks 1-3 random horizontal bands
 * inside the bounding box and shifts them sideways by a few pixels.
 * Uses `getImageData` / `putImageData` per the v1 plan; idempotent.
 *
 * Roughly 10% of sprites get this — the rest call `rollGlitch` and skip.
 */
function applyGlitchDisplacement(
  ctx: CanvasRenderingContext2D,
  cy: number,
  half: number,
  rng: () => number,
): void {
  const sliceCount = 1 + Math.floor(rng() * 3)
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const snap = ctx.getImageData(0, 0, w, h)
  ctx.save()
  for (let i = 0; i < sliceCount; i++) {
    const y0 = Math.max(0, Math.floor(cy - half + rng() * half * 2))
    const sliceH = Math.max(1, Math.floor(rng() * (half * 0.18) + 1))
    const dx = Math.floor((rng() * 2 - 1) * half * 0.18)
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = sliceH
    const tctx = tmp.getContext('2d')!
    tctx.putImageData(snap, 0, -y0)
    ctx.clearRect(0, y0, w, sliceH)
    ctx.drawImage(tmp, dx, y0)
  }
  ctx.restore()
}

/** Roll once per sprite; ~10% of sprites get glitch displacement. */
function rollGlitch(rng: () => number): boolean {
  return rng() < 0.10
}

/* --------------------------------------------------------------------------
 * 1. RED GIANT — magenta sphere + chromatic ghost + cyan electric arcs
 * -------------------------------------------------------------------------- */

const drawRedGiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  paintPosterizedDisc(ctx, cx, cy, r * 3.0, [
    [1.00, 'rgba(40, 0, 60, 0.0)'],
    [0.85, 'rgba(120, 0, 100, 0.40)'],
    [0.60, 'rgba(255, 0, 122, 0.65)'],
    [0.40, 'rgba(255, 42, 252, 0.90)'],
    [0.22, 'rgba(255, 200, 240, 1.0)'],
  ])

  // Quantized mottling — hot-pink/magenta hard-edged squares
  const blobCount = 8 + Math.floor(rng() * 7) // 8..14
  const blockHues = [
    'rgba(255, 0, 122, 0.85)',
    'rgba(255, 42, 252, 0.95)',
    'rgba(255, 242, 0, 0.7)',
  ]
  ctx.save()
  for (let i = 0; i < blobCount; i++) {
    const ang = rng() * Math.PI * 2
    const radial = rng() * 0.7
    const sz = rngRange(rng, 0.10, 0.24) * r
    const px = cx + Math.cos(ang) * radial * r
    const py = cy + Math.sin(ang) * radial * r
    const hue = rngPick(rng, blockHues)
    ctx.fillStyle = hue
    ctx.fillRect(px - sz / 2, py - sz / 2, sz, sz)
  }
  ctx.restore()

  // Cyan electric arc prominences — jagged lightning, not smooth bezier
  const promCount = 2 + Math.floor(rng() * 3) // 2..4
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  for (let i = 0; i < promCount; i++) {
    const ang = rng() * Math.PI * 2
    const length = rngRange(rng, 1.20, 1.80)
    const jag = rngRange(rng, 0.08, 0.18)
    const sx = cx + Math.cos(ang) * r * 0.95
    const sy = cy + Math.sin(ang) * r * 0.95
    const ex = cx + Math.cos(ang) * r * length
    const ey = cy + Math.sin(ang) * r * length
    const STEPS = 6
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.95)'
    ctx.lineWidth = 1.6
    ctx.shadowColor = 'rgba(0, 245, 255, 0.9)'
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS
      const lx = sx + (ex - sx) * t
      const ly = sy + (ey - sy) * t
      const px = -(ey - sy)
      const py =  (ex - sx)
      const plen = Math.hypot(px, py) || 1
      const jx = (px / plen) * (rng() * 2 - 1) * jag * r
      const jy = (py / plen) * (rng() * 2 - 1) * jag * r
      ctx.lineTo(lx + jx, ly + jy)
    }
    ctx.lineTo(ex, ey)
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.restore()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.78)
}

/* --------------------------------------------------------------------------
 * 2. BLUE SUPERGIANT — hot cyan core + hyper-yellow X-spikes
 * -------------------------------------------------------------------------- */

const drawBlueSupergiant: ThemedDrawer = (ctx, cx, cy, r, rng, sizeBucket) => {
  const spikeWeights: Array<{ n: number; w: number }> = [
    { n: 4, w: 0.55 },
    { n: 6, w: 0.30 },
    { n: 8, w: 0.15 },
  ]
  const u = rng()
  let acc = 0, spikeCount = 4
  for (const { n, w } of spikeWeights) { acc += w; if (u <= acc) { spikeCount = n; break } }

  const squish = rngRange(rng, 0.75, 1.25)
  const tilt   = rng() * Math.PI
  const base   = rng() * (Math.PI / spikeCount)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(squish, 1 / squish)
  paintPosterizedDisc(ctx, 0, 0, r * 3.0, [
    [1.00, 'rgba(0, 30, 80, 0.0)'],
    [0.85, 'rgba(0, 60, 160, 0.35)'],
    [0.55, 'rgba(0, 245, 255, 0.65)'],
    [0.35, 'rgba(140, 255, 255, 0.9)'],
    [0.20, 'rgba(255, 255, 255, 1.0)'],
  ])
  ctx.restore()

  // Hard hyper-yellow X-spikes
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt + base)
  const reach = r * 3.0
  const lineWidth = sizeBucket >= 4 ? 2.2 : 1.6
  for (let i = 0; i < spikeCount; i++) {
    const ang = (i / spikeCount) * Math.PI
    const dx = Math.cos(ang) * reach
    const dy = Math.sin(ang) * reach
    ctx.strokeStyle = 'rgba(255, 242, 0, 0.95)'
    ctx.lineWidth = lineWidth
    ctx.beginPath()
    ctx.moveTo(-dx, -dy); ctx.lineTo(dx, dy)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255, 255, 255, 1.0)'
    ctx.lineWidth = Math.max(1, lineWidth - 1)
    ctx.beginPath()
    ctx.moveTo(-dx, -dy); ctx.lineTo(dx, dy)
    ctx.stroke()
  }
  ctx.restore()

  // Hot cyan core with magenta outline + bright nucleus
  ctx.fillStyle = 'rgba(0, 245, 255, 1.0)'
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255, 42, 252, 0.85)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fill()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.82)
}

/* --------------------------------------------------------------------------
 * 3a. MAIN SEQUENCE — F10: yellow neon, posterized like other vapor drawers
 *
 * Vapor counterpart of the JWST sun-like main-sequence. Posterized hyper
 * -yellow disc with a magenta outer ring (signature vapor clash) and a
 * white-hot core. No spikes; sits between white-dwarf and red-giant in
 * the usage-mode lifecycle.
 * -------------------------------------------------------------------------- */

const drawMainSequence: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  // rng() ord: A) size jitter (sun-like uniformity).
  const jitter = rngRange(rng, 0.95, 1.08)
  r = r * jitter

  // Posterized warm disc — magenta outer band, hyper-yellow mid, white core.
  paintPosterizedDisc(ctx, cx, cy, r * 1.9, [
    [1.00, 'rgba(120, 0, 100, 0.0)'],
    [0.82, 'rgba(255, 0, 122, 0.55)'],
    [0.62, 'rgba(255, 140, 40, 0.75)'],
    [0.42, 'rgba(255, 242, 0, 0.95)'],
    [0.22, 'rgba(255, 255, 255, 1.0)'],
  ])

  // Single neon ring outline at the limb so the disc reads cleanly against
  // the canvas backdrop without bleeding into halo.
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 245, 255, 0.65)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.80)
}

/* --------------------------------------------------------------------------
 * 3. WHITE DWARF — vapor-white core + posterized rainbow halo + Tron wisps
 * -------------------------------------------------------------------------- */

const drawWhiteDwarf: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const jitter = rngRange(rng, 0.9, 1.1)
  r = r * jitter

  paintPosterizedDisc(ctx, cx, cy, r * 1.7, [
    [1.00, 'rgba(255, 0, 122, 0.0)'],
    [0.78, 'rgba(255, 0, 122, 0.55)'],
    [0.62, 'rgba(0, 245, 255, 0.65)'],
    [0.46, 'rgba(57, 255, 20, 0.75)'],
    [0.28, 'rgba(255, 255, 255, 1.0)'],
  ])

  const wispCount = 4 + Math.floor(rng() * 4) // 4..7
  const dirs: Array<[number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ]
  ctx.save()
  ctx.lineWidth = 0.9
  ctx.shadowColor = 'rgba(0, 245, 255, 0.7)'
  ctx.shadowBlur = 4
  for (let i = 0; i < wispCount; i++) {
    const dir = rngPick(rng, dirs)
    const len = rngRange(rng, 1.6, 2.6) * r
    const norm = Math.hypot(dir[0], dir[1])
    const dx = (dir[0] / norm) * len
    const dy = (dir[1] / norm) * len
    const innerR = r * 1.05
    const ix = cx + (dir[0] / norm) * innerR
    const iy = cy + (dir[1] / norm) * innerR
    const ox = cx + dx
    const oy = cy + dy
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.85)'
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ox, oy); ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.restore()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.78)
}

/* --------------------------------------------------------------------------
 * 4. NEUTRON STAR — vapor-palette dots, hard outlines, no soft glow
 * -------------------------------------------------------------------------- */

const drawNeutronStar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const dotCount = 25 + Math.floor(rng() * 26) // 25..50
  const dotHues = [
    'rgba(255, 42, 252, 1.0)',
    'rgba(0, 245, 255, 1.0)',
    'rgba(255, 242, 0, 1.0)',
  ]

  paintPosterizedDisc(ctx, cx, cy, r * 1.6, [
    [1.0, 'rgba(20, 0, 40, 0.0)'],
    [0.85, 'rgba(40, 0, 60, 0.5)'],
  ])

  ctx.save()
  for (let i = 0; i < dotCount; i++) {
    let bx = 0, by = 0
    for (let t = 0; t < 6; t++) {
      const u = rng() * 2 - 1
      const v = rng() * 2 - 1
      if (u * u + v * v < 0.85) { bx = u; by = v; break }
    }
    const px = cx + bx * r * 1.0
    const py = cy + by * r * 1.0
    const sz = rngRange(rng, 1.0, 2.4)
    const hue = rngPick(rng, dotHues)
    ctx.fillStyle = hue
    ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.arc(px, py, sz + 0.4, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.85)
}

/* --------------------------------------------------------------------------
 * 5. PULSAR — dual-color (cyan + magenta) beams with chromatic split
 * -------------------------------------------------------------------------- */

const drawPulsar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const tilt = rng() * Math.PI
  const drift = rngRange(rng, -Math.PI / 12, Math.PI / 12)
  const ratio = rngRange(rng, 0.7, 1.3)

  paintPosterizedDisc(ctx, cx, cy, r * 2.5, [
    [1.00, 'rgba(0, 0, 60, 0.0)'],
    [0.80, 'rgba(90, 0, 255, 0.40)'],
    [0.55, 'rgba(0, 245, 255, 0.55)'],
    [0.35, 'rgba(255, 42, 252, 0.65)'],
    [0.18, 'rgba(255, 255, 255, 1.0)'],
  ])

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const beamLen = r * 4.5

  const drawBeamPair = (angle: number, intensity: number): void => {
    const tx = cx + Math.cos(angle) * beamLen
    const ty = cy + Math.sin(angle) * beamLen
    const w = r * 0.55 * intensity
    const px = -Math.sin(angle), py = Math.cos(angle)
    const a = Math.min(1, intensity)
    const sh = r * 0.10

    ctx.fillStyle = `rgba(0, 245, 255, ${a * 0.85})`
    ctx.beginPath()
    ctx.moveTo(cx + px * w * 0.25 - Math.cos(angle) * sh, cy + py * w * 0.25 - Math.sin(angle) * sh)
    ctx.lineTo(tx + px * w - Math.cos(angle) * sh, ty + py * w - Math.sin(angle) * sh)
    ctx.lineTo(tx - px * w - Math.cos(angle) * sh, ty - py * w - Math.sin(angle) * sh)
    ctx.lineTo(cx - px * w * 0.25 - Math.cos(angle) * sh, cy - py * w * 0.25 - Math.sin(angle) * sh)
    ctx.closePath(); ctx.fill()

    ctx.fillStyle = `rgba(255, 42, 252, ${a * 0.85})`
    ctx.beginPath()
    ctx.moveTo(cx + px * w * 0.25 + Math.cos(angle) * sh, cy + py * w * 0.25 + Math.sin(angle) * sh)
    ctx.lineTo(tx + px * w + Math.cos(angle) * sh, ty + py * w + Math.sin(angle) * sh)
    ctx.lineTo(tx - px * w + Math.cos(angle) * sh, ty - py * w + Math.sin(angle) * sh)
    ctx.lineTo(cx - px * w * 0.25 + Math.cos(angle) * sh, cy - py * w * 0.25 + Math.sin(angle) * sh)
    ctx.closePath(); ctx.fill()

    ctx.strokeStyle = `rgba(255, 255, 255, ${a})`
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke()
  }
  drawBeamPair(tilt, ratio)
  drawBeamPair(tilt + Math.PI + drift, 2 - ratio)
  ctx.restore()

  // Scanline interference pattern over the halo
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  const halfMid = ctx.canvas.width / 2
  for (let y = Math.floor(cy - halfMid); y < cy + halfMid; y += 4) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
    ctx.fillRect(cx - halfMid, y, halfMid * 2, 1)
  }
  ctx.restore()

  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(0, 245, 255, 1)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.stroke()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.82)
}

/* --------------------------------------------------------------------------
 * 6. BINARY — magenta + cyan cores, doppler-tinted inner rings
 * -------------------------------------------------------------------------- */

const drawBinary: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const sep = rngRange(rng, 0.8, 1.6) * r
  const ratio = rngRange(rng, 0.5, 1.5)
  const ax = rng() * Math.PI

  const ux = Math.cos(ax), uy = Math.sin(ax)
  const r1 = r * 1.0
  const r2 = r * ratio
  const x1 = cx - ux * sep, y1 = cy - uy * sep
  const x2 = cx + ux * sep, y2 = cy + uy * sep

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(ax)
  ctx.scale(1.4, 0.85)
  paintPosterizedDisc(ctx, 0, 0, (r + sep) * 1.5, [
    [1.0, 'rgba(0, 0, 80, 0.0)'],
    [0.85, 'rgba(90, 0, 255, 0.30)'],
    [0.55, 'rgba(255, 0, 122, 0.45)'],
  ])
  ctx.restore()

  // Star A — magenta core + yellow doppler ring
  paintPosterizedDisc(ctx, x1, y1, r1 * 1.5, [
    [1.00, 'rgba(255, 0, 122, 0.0)'],
    [0.80, 'rgba(255, 0, 122, 0.55)'],
    [0.50, 'rgba(255, 42, 252, 0.85)'],
    [0.25, 'rgba(255, 242, 0, 1.0)'],
  ])
  ctx.strokeStyle = 'rgba(0, 245, 255, 0.7)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(x1, y1, r1 * 1.2, 0, Math.PI * 2); ctx.stroke()

  // Star B — cyan core + lime doppler ring
  paintPosterizedDisc(ctx, x2, y2, r2 * 1.5, [
    [1.00, 'rgba(0, 60, 160, 0.0)'],
    [0.80, 'rgba(0, 245, 255, 0.55)'],
    [0.50, 'rgba(140, 255, 255, 0.85)'],
    [0.25, 'rgba(57, 255, 20, 1.0)'],
  ])
  ctx.strokeStyle = 'rgba(255, 42, 252, 0.7)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(x2, y2, r2 * 1.2, 0, Math.PI * 2); ctx.stroke()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.78)
}

/* --------------------------------------------------------------------------
 * 7. QUASAR — long polar jets in pure neon, accent {lime, yellow, pink}
 * -------------------------------------------------------------------------- */

const drawQuasar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const asym = rngRange(rng, 1.5, 3.0)
  const accents = [
    { core: 'rgba(57, 255, 20, 1.0)',  edge: 'rgba(57, 255, 20, 0.8)' },
    { core: 'rgba(255, 242, 0, 1.0)',  edge: 'rgba(255, 242, 0, 0.8)' },
    { core: 'rgba(255, 0, 122, 1.0)',  edge: 'rgba(255, 0, 122, 0.8)' },
  ] as const
  const accent = rngPick(rng, accents)
  const tilt = rng() * Math.PI

  paintPosterizedDisc(ctx, cx, cy, r * 2.4, [
    [1.00, 'rgba(20, 0, 60, 0.0)'],
    [0.80, 'rgba(90, 0, 255, 0.40)'],
    [0.55, 'rgba(255, 42, 252, 0.55)'],
    [0.30, 'rgba(255, 200, 240, 0.85)'],
  ])

  // Tilted accretion disc
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(1, 0.32)
  paintPosterizedDisc(ctx, 0, 0, r * 1.9, [
    [1.00, 'rgba(255, 42, 252, 0.0)'],
    [0.80, 'rgba(255, 0, 122, 0.55)'],
    [0.55, 'rgba(255, 242, 0, 0.75)'],
    [0.30, 'rgba(255, 255, 255, 1.0)'],
  ])
  ctx.restore()

  // Polar jets — long pure-neon rectangles
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt + Math.PI / 2)
  const baseLen = r * 4.2
  const lens = [baseLen * Math.sqrt(asym), baseLen / Math.sqrt(asym)]
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? 1 : -1
    const ty = sign * lens[i]
    const w = r * 0.5
    ctx.fillStyle = accent.edge
    ctx.fillRect(-w, 0, w * 2, ty)
    ctx.fillStyle = accent.core
    ctx.fillRect(-w * 0.4, 0, w * 0.8, ty)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.fillRect(-w * 0.12, 0, w * 0.24, ty)
  }
  ctx.restore()

  // AGN core with chromatic outlines
  ctx.fillStyle = 'rgba(255, 255, 255, 1.0)'
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255, 42, 252, 0.9)'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.arc(cx - 1.5, cy, r * 0.85, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = 'rgba(0, 245, 255, 0.9)'
  ctx.beginPath(); ctx.arc(cx + 1.5, cy, r * 0.85, 0, Math.PI * 2); ctx.stroke()

  const half = ctx.canvas.width / 2
  // Quasars get glitch more often (signature trick) — 25% chance
  if (rng() < 0.25) applyGlitchDisplacement(ctx, cy, half, rng)
  else if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.82)
}

/* --------------------------------------------------------------------------
 * 8. BLACK HOLE — vortex bands + asymmetric Doppler arc + chromatic ghost
 * -------------------------------------------------------------------------- */

const drawBlackHole: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const tilt = rng() * Math.PI
  const asymPhase = rng() * Math.PI * 2
  const innerR = rngRange(rng, 0.92, 1.00) * r
  const ringW  = rngRange(rng, 0.4, 0.6) * r

  paintPosterizedDisc(ctx, cx, cy, r * 3.2, [
    [1.00, 'rgba(0, 0, 0, 0.0)'],
    [0.85, 'rgba(40, 0, 80, 0.35)'],
    [0.55, 'rgba(90, 0, 255, 0.45)'],
    [0.40, 'rgba(255, 0, 122, 0.55)'],
  ])

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(1, 0.55)

  const outerR = innerR + ringW
  const ringBands: Array<{ t: number; col: string }> = [
    { t: outerR * 1.00, col: 'rgba(255, 42, 252, 0.0)' },
    { t: outerR * 0.95, col: 'rgba(255, 42, 252, 0.85)' },
    { t: outerR * 0.78, col: 'rgba(255, 0, 122, 0.95)' },
    { t: outerR * 0.62, col: 'rgba(90, 0, 255, 0.85)' },
    { t: outerR * 0.50, col: 'rgba(40, 0, 60, 0.6)' },
  ]
  for (const band of ringBands) {
    ctx.fillStyle = band.col
    ctx.beginPath()
    ctx.arc(0, 0, band.t, 0, Math.PI * 2)
    ctx.fill()
  }

  const halfStart = asymPhase - Math.PI / 2
  const ARC_SEGS = 14
  for (let i = 0; i < ARC_SEGS; i++) {
    const t0 = halfStart + (i / ARC_SEGS) * Math.PI
    const t1 = halfStart + ((i + 1) / ARC_SEGS) * Math.PI
    const mid = (i + 0.5) / ARC_SEGS
    const k = Math.sin(mid * Math.PI)
    const a = 0.85 * k
    ctx.fillStyle = `rgba(255, 242, 0, ${a})`
    ctx.beginPath()
    ctx.arc(0, 0, outerR, t0, t1)
    ctx.arc(0, 0, innerR, t1, t0, true)
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = `rgba(255, 255, 255, ${a * 0.7})`
    ctx.beginPath()
    ctx.arc(0, 0, outerR * 0.95, t0, t1)
    ctx.arc(0, 0, innerR * 1.05, t1, t0, true)
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  // Pure black event horizon
  ctx.fillStyle = 'rgba(0, 0, 0, 1)'
  ctx.beginPath(); ctx.arc(cx, cy, innerR * 0.92, 0, Math.PI * 2); ctx.fill()

  // Chromatic ghost on asymmetry side
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(1, 0.55)
  const ghostShift = 4
  ctx.translate(Math.cos(asymPhase) * ghostShift, Math.sin(asymPhase) * ghostShift)
  for (let i = 0; i < ARC_SEGS; i++) {
    const t0 = halfStart + (i / ARC_SEGS) * Math.PI
    const t1 = halfStart + ((i + 1) / ARC_SEGS) * Math.PI
    const mid = (i + 0.5) / ARC_SEGS
    const k = Math.sin(mid * Math.PI)
    const a = 0.45 * k
    ctx.fillStyle = `rgba(0, 245, 255, ${a})`
    ctx.beginPath()
    ctx.arc(0, 0, outerR, t0, t1)
    ctx.arc(0, 0, innerR, t1, t0, true)
    ctx.closePath(); ctx.fill()
  }
  ctx.restore()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.85)
}

/* --------------------------------------------------------------------------
 * 9. NEBULA — clipped bezier silhouette + posterized cellular noise
 * -------------------------------------------------------------------------- */

const drawNebula: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  // Pick 3 of 5 vapor hues, deliberately clashing
  const vapors: ReadonlyArray<[number, number, number]> = [
    [255, 42, 252],   // magenta
    [0, 245, 255],    // cyan
    [57, 255, 20],    // lime
    [255, 242, 0],    // yellow
    [255, 0, 122],    // pink
  ]
  const picks = new Set<number>()
  while (picks.size < 3) picks.add(Math.floor(rng() * vapors.length))
  const colors = [...picks].map((i) => vapors[i])

  // 6 control points for the bezier silhouette
  const N_CTRL = 6
  const ctrlPts: Array<{ ang: number; rad: number }> = []
  for (let i = 0; i < N_CTRL; i++) {
    const ang = (i / N_CTRL) * Math.PI * 2
    const radPert = rngRange(rng, 0.6, 1.4) * r * 1.3
    ctrlPts.push({ ang, rad: radPert })
  }
  const silTilt = rng() * Math.PI * 2

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(silTilt)
  ctx.beginPath()
  const pts = ctrlPts.map((p) => ({
    x: Math.cos(p.ang) * p.rad,
    y: Math.sin(p.ang) * p.rad,
  }))
  const startMid = {
    x: (pts[pts.length - 1].x + pts[0].x) / 2,
    y: (pts[pts.length - 1].y + pts[0].y) / 2,
  }
  ctx.moveTo(startMid.x, startMid.y)
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    const next = pts[(i + 1) % pts.length]
    const mid = { x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2 }
    ctx.quadraticCurveTo(cur.x, cur.y, mid.x, mid.y)
  }
  ctx.closePath()
  ctx.clip()

  const [r0, g0, b0] = colors[0]
  ctx.fillStyle = `rgba(${r0},${g0},${b0},0.55)`
  ctx.fillRect(-r * 2, -r * 2, r * 4, r * 4)

  const cellCount = 12 + Math.floor(rng() * 7) // 12..18
  for (let i = 0; i < cellCount; i++) {
    const ang = rng() * Math.PI * 2
    const radial = rng() * 0.85
    const px = Math.cos(ang) * radial * r * 1.1
    const py = Math.sin(ang) * radial * r * 1.1
    const sz = rngRange(rng, 0.18, 0.40) * r
    const c = colors[1 + Math.floor(rng() * (colors.length - 1))]
    const a = rngRange(rng, 0.55, 0.95)
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`
    ctx.beginPath()
    ctx.arc(px, py, sz, 0, Math.PI * 2)
    ctx.fill()
  }

  const hotCount = 3 + Math.floor(rng() * 3) // 3..5
  for (let i = 0; i < hotCount; i++) {
    const ang = rng() * Math.PI * 2
    const radial = rng() * 0.5
    const px = Math.cos(ang) * radial * r
    const py = Math.sin(ang) * radial * r
    const sz = rngRange(rng, 0.08, 0.16) * r
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.beginPath()
    ctx.arc(px, py, sz, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  const half = ctx.canvas.width / 2
  if (rollGlitch(rng)) applyGlitchDisplacement(ctx, cy, half, rng)
  applyCircularFade(ctx, cx, cy, half, 0.65)
}

/* --------------------------------------------------------------------------
 * Default drawer (cluster-hue / no-type fallback)
 * -------------------------------------------------------------------------- */

const drawDefault: ThemedDrawer = (ctx, cx, cy, r) => {
  paintPosterizedDisc(ctx, cx, cy, r * 1.8, [
    [1.00, 'rgba(90, 0, 255, 0.0)'],
    [0.75, 'rgba(255, 42, 252, 0.55)'],
    [0.50, 'rgba(0, 245, 255, 0.65)'],
    [0.30, 'rgba(255, 255, 255, 1.0)'],
  ])
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

export const vaporDrawers = {
  'red-giant': drawRedGiant,
  'blue-supergiant': drawBlueSupergiant,
  'white-dwarf': drawWhiteDwarf,
  'main-sequence': drawMainSequence,
  'neutron-star': drawNeutronStar,
  'pulsar': drawPulsar,
  'binary': drawBinary,
  'quasar': drawQuasar,
  'black-hole': drawBlackHole,
  'nebula': drawNebula,
} as const

export const vaporDefaultDrawer: ThemedDrawer = drawDefault
