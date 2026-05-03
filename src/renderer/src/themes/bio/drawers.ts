/**
 * Bioluminescent theme drawers — watercolor + ink + glow per-type variation.
 *
 * Ported from `docs/three-new-themes/new-themes.js` (`drawBioCreature`)
 * with no behavioural changes; rng() call order is identical so the same
 * star id renders identically to the deck preview.
 *
 * Each star type maps to a tide-pool creature or forest flora:
 * anemone, coral bloom, jellyfish, sea urchin, spores, angler-light,
 * twin flowers, mantaray, carnivorous flower, moss patch.
 */

import type { ThemedDrawer } from '../types'
import { applyCircularFade } from '../../components/StarMap/proc'

/* --------------------------------------------------------------------------
 * Palette + helpers (deck `BIO`, `softBlob`)
 * -------------------------------------------------------------------------- */

const BIO = {
  bg1:        '#0a1420',
  bg2:        '#1a2a3a',
  teal:       '#5fd2c0',
  mint:       '#a8f0c8',
  coral:      '#ff9a8b',
  pink:       '#ffc1d1',
  amber:      '#ffd591',
  violet:     '#9b7cd8',
  lavender:   '#d4c4f0',
  chartreuse: '#caff70',
  white:      '#fdfffe',
  ink:        '#0a1420',
} as const

/**
 * Soft circular gradient blob. `colorRgb` is an "rgb(r,g,b)" string; we
 * substitute the alpha. Same semantics as the deck's `softBlob`, kept as
 * a string-substitution helper (rather than parsing into RGB) so the port
 * stays line-for-line traceable.
 */
function softBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  colorRgb: string,
  alpha: number,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, colorRgb.replace(')', `,${alpha})`).replace('rgb', 'rgba'))
  g.addColorStop(1, colorRgb.replace(')', ',0)').replace('rgb', 'rgba'))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/* --------------------------------------------------------------------------
 * Per-creature drawers (deck `drawAnemone`, `drawCoralBloom`, …)
 *
 * Each runs inside a `ctx.save() + translate(cx, cy)` envelope, so all
 * coords below are relative to the sprite centre.
 * -------------------------------------------------------------------------- */

function drawAnemone(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Watercolor wash
  const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.3)
  wash.addColorStop(0, 'rgba(255,213,145,0.45)')
  wash.addColorStop(0.6, 'rgba(255,154,139,0.18)')
  wash.addColorStop(1, 'rgba(255,154,139,0)')
  ctx.fillStyle = wash
  ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, Math.PI * 2); ctx.fill()
  // Tendrils
  const arms = 16
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + rng() * 0.05
    const len = R * (0.85 + rng() * 0.4)
    const wave = (rng() - 0.5) * 0.8
    ctx.strokeStyle = `rgba(255,193,209,${0.6 + rng() * 0.3})`
    ctx.lineWidth = R * 0.04
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(
      Math.cos(a + wave * 0.3) * len * 0.4, Math.sin(a + wave * 0.3) * len * 0.4,
      Math.cos(a + wave) * len * 0.7, Math.sin(a + wave) * len * 0.7,
      Math.cos(a) * len, Math.sin(a) * len,
    )
    ctx.stroke()
    // Glowing tip
    const tipX = Math.cos(a) * len, tipY = Math.sin(a) * len
    const tg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, R * 0.1)
    tg.addColorStop(0, 'rgba(253,255,254,1)')
    tg.addColorStop(0.5, 'rgba(255,213,145,0.9)')
    tg.addColorStop(1, 'rgba(255,154,139,0)')
    ctx.fillStyle = tg
    ctx.beginPath(); ctx.arc(tipX, tipY, R * 0.1, 0, Math.PI * 2); ctx.fill()
  }
  // Hot center
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.35)
  core.addColorStop(0, 'rgba(253,255,254,1)')
  core.addColorStop(0.5, 'rgba(255,213,145,0.95)')
  core.addColorStop(1, 'rgba(255,154,139,0)')
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(0, 0, R * 0.35, 0, Math.PI * 2); ctx.fill()
}

function drawCoralBloom(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Multiple overlapping coral branches
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3
    ctx.strokeStyle = `rgba(255,154,139,0.85)`
    ctx.lineWidth = R * (0.08 + rng() * 0.05)
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    const mx = Math.cos(a) * R * 0.5, my = Math.sin(a) * R * 0.5
    const ex = Math.cos(a + (rng() - 0.5) * 0.6) * R, ey = Math.sin(a + (rng() - 0.5) * 0.6) * R
    ctx.bezierCurveTo(mx * 0.5, my * 0.5, mx, my, ex, ey)
    ctx.stroke()
    // Bud at tip
    ctx.fillStyle = 'rgba(255,154,139,0.95)'
    ctx.beginPath(); ctx.arc(ex, ey, R * 0.08, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,213,145,1)'
    ctx.beginPath(); ctx.arc(ex - R * 0.02, ey - R * 0.02, R * 0.04, 0, Math.PI * 2); ctx.fill()
  }
  // Center mass
  softBlob(ctx, 0, 0, R * 0.4, 'rgb(255,154,139)', 0.7)
  softBlob(ctx, 0, 0, R * 0.18, 'rgb(255,213,145)', 1)
}

function drawJellyfish(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Bell
  const bellGrad = ctx.createRadialGradient(0, -R * 0.1, 0, 0, -R * 0.1, R * 0.7)
  bellGrad.addColorStop(0, 'rgba(168,240,200,0.95)')
  bellGrad.addColorStop(0.6, 'rgba(95,210,192,0.7)')
  bellGrad.addColorStop(1, 'rgba(95,210,192,0)')
  ctx.fillStyle = bellGrad
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.15, R * 0.7, R * 0.5, 0, Math.PI, 0)
  ctx.lineTo(R * 0.55, R * 0.05)
  ctx.bezierCurveTo(R * 0.3, R * 0.15, -R * 0.3, R * 0.15, -R * 0.55, R * 0.05)
  ctx.closePath()
  ctx.fill()
  // Bell rim highlight
  ctx.strokeStyle = 'rgba(253,255,254,0.7)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.15, R * 0.7, R * 0.5, 0, Math.PI + 0.2, -0.2)
  ctx.stroke()
  // Inner bioluminescence
  softBlob(ctx, 0, -R * 0.2, R * 0.25, 'rgb(202,255,112)', 0.9)
  // Tentacles — long wavy
  const tents = 12
  for (let i = 0; i < tents; i++) {
    const xs = -R * 0.5 + (i / (tents - 1)) * R
    const len = R * (0.8 + rng() * 0.6)
    const g = ctx.createLinearGradient(xs, R * 0.05, xs + (rng() - 0.5) * R * 0.3, R * 0.05 + len)
    g.addColorStop(0, 'rgba(168,240,200,0.7)')
    g.addColorStop(1, 'rgba(95,210,192,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = 1.5 + rng()
    ctx.beginPath()
    ctx.moveTo(xs, R * 0.05)
    const cp1x = xs + Math.sin(rng() * 6) * R * 0.1
    const cp2x = xs + Math.sin(rng() * 6) * R * 0.2
    ctx.bezierCurveTo(
      cp1x, R * 0.05 + len * 0.4, cp2x, R * 0.05 + len * 0.7,
      xs + (rng() - 0.5) * R * 0.3, R * 0.05 + len,
    )
    ctx.stroke()
  }
  // Stinger glow dots
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(202,255,112,0.9)'
    ctx.beginPath(); ctx.arc((rng() - 0.5) * R, R * 0.4 + rng() * R * 0.4, 1.2, 0, Math.PI * 2); ctx.fill()
  }
}

function drawSeaUrchin(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Spines
  const spines = 32
  for (let i = 0; i < spines; i++) {
    const a = (i / spines) * Math.PI * 2
    const len = R * (0.7 + rng() * 0.5)
    const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len)
    g.addColorStop(0, 'rgba(155,124,216,0.95)')
    g.addColorStop(1, 'rgba(212,196,240,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = R * 0.025
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len)
    ctx.stroke()
  }
  // Body
  softBlob(ctx, 0, 0, R * 0.4, 'rgb(155,124,216)', 0.8)
  ctx.fillStyle = 'rgba(253,255,254,1)'
  ctx.beginPath(); ctx.arc(0, 0, R * 0.12, 0, Math.PI * 2); ctx.fill()
}

function drawSpores(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  const palette = ['rgb(168,240,200)', 'rgb(255,193,209)', 'rgb(212,196,240)'] as const
  const n = 24
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2
    const rad = Math.pow(rng(), 0.6) * R
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad
    const sz = R * (0.04 + rng() * 0.06)
    const c = palette[Math.floor(rng() * palette.length)]
    softBlob(ctx, x, y, sz * 2.5, c, 0.4)
    ctx.fillStyle = c.replace(')', ',1)').replace('rgb', 'rgba')
    ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(253,255,254,0.95)'
    ctx.beginPath(); ctx.arc(x, y, sz * 0.4, 0, Math.PI * 2); ctx.fill()
  }
}

function drawAnglerLight(ctx: CanvasRenderingContext2D, R: number): void {
  // Glowing lure with stalk and tendrils
  softBlob(ctx, 0, -R * 0.4, R * 0.3, 'rgb(202,255,112)', 0.9)
  ctx.fillStyle = 'rgba(253,255,254,1)'
  ctx.beginPath(); ctx.arc(0, -R * 0.4, R * 0.08, 0, Math.PI * 2); ctx.fill()
  // Stalk
  ctx.strokeStyle = 'rgba(155,124,216,0.85)'
  ctx.lineWidth = R * 0.05
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -R * 0.3)
  ctx.bezierCurveTo(R * 0.1, -R * 0.1, -R * 0.1, R * 0.2, 0, R * 0.5)
  ctx.stroke()
  // Body suggestion
  ctx.fillStyle = 'rgba(95,210,192,0.4)'
  ctx.beginPath()
  ctx.ellipse(0, R * 0.55, R * 0.5, R * 0.25, 0, 0, Math.PI * 2)
  ctx.fill()
  // Eye
  ctx.fillStyle = 'rgba(255,213,145,0.95)'
  ctx.beginPath(); ctx.arc(R * 0.15, R * 0.55, R * 0.05, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(10,20,32,1)'
  ctx.beginPath(); ctx.arc(R * 0.15, R * 0.55, R * 0.025, 0, Math.PI * 2); ctx.fill()
}

function drawTwinFlowers(ctx: CanvasRenderingContext2D, R: number): void {
  function flower(cx_: number, cy_: number, rr: number, c1: string, c2: string): void {
    const petals = 8
    ctx.fillStyle = c1
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2
      ctx.save(); ctx.translate(cx_, cy_); ctx.rotate(a)
      ctx.beginPath()
      ctx.ellipse(rr * 0.5, 0, rr * 0.45, rr * 0.18, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    ctx.fillStyle = c2
    ctx.beginPath(); ctx.arc(cx_, cy_, rr * 0.25, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(253,255,254,1)'
    ctx.beginPath(); ctx.arc(cx_, cy_, rr * 0.1, 0, Math.PI * 2); ctx.fill()
  }
  flower(-R * 0.4, R * 0.05, R * 0.55, 'rgba(255,154,139,0.9)', 'rgba(255,213,145,1)')
  flower(R * 0.45, -R * 0.1, R * 0.42, 'rgba(168,240,200,0.9)', 'rgba(202,255,112,1)')
  // Connecting tendril
  ctx.strokeStyle = 'rgba(212,196,240,0.7)'
  ctx.lineWidth = R * 0.03
  ctx.beginPath()
  ctx.moveTo(-R * 0.2, R * 0.05)
  ctx.bezierCurveTo(0, -R * 0.3, R * 0.2, -R * 0.3, R * 0.3, -R * 0.1)
  ctx.stroke()
}

function drawMantaray(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Soft ambient glow underneath
  const ambient = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.4)
  ambient.addColorStop(0, 'rgba(155,124,216,0.18)')
  ambient.addColorStop(1, 'rgba(155,124,216,0)')
  ctx.fillStyle = ambient
  ctx.beginPath(); ctx.arc(0, 0, R * 1.4, 0, Math.PI * 2); ctx.fill()

  // Trailing translucent veils
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * R * 0.04
    ctx.strokeStyle = `rgba(212,196,240,${0.18 - i * 0.03})`
    ctx.lineWidth = R * 0.05
    ctx.beginPath()
    ctx.moveTo(-R * 0.95, off)
    ctx.bezierCurveTo(-R * 0.4, R * 0.4 + off, R * 0.4, R * 0.4 + off, R * 0.95, off)
    ctx.stroke()
  }

  // Body — graceful arching wing
  const wingGrad = ctx.createLinearGradient(0, -R * 0.45, 0, R * 0.3)
  wingGrad.addColorStop(0, 'rgba(155,124,216,0.95)')
  wingGrad.addColorStop(0.6, 'rgba(123,152,210,0.9)')
  wingGrad.addColorStop(1, 'rgba(95,210,192,0.7)')
  ctx.fillStyle = wingGrad
  ctx.beginPath()
  ctx.moveTo(-R, R * 0.05)
  ctx.bezierCurveTo(-R * 0.85, -R * 0.45, -R * 0.3, -R * 0.55, 0, -R * 0.5)
  ctx.bezierCurveTo(R * 0.3, -R * 0.55, R * 0.85, -R * 0.45, R, R * 0.05)
  ctx.bezierCurveTo(R * 0.6, R * 0.22, R * 0.2, R * 0.28, 0, R * 0.18)
  ctx.bezierCurveTo(-R * 0.2, R * 0.28, -R * 0.6, R * 0.22, -R, R * 0.05)
  ctx.closePath()
  ctx.fill()

  // Spine band shading
  const spineGrad = ctx.createLinearGradient(0, -R * 0.4, 0, R * 0.1)
  spineGrad.addColorStop(0, 'rgba(95,80,160,0)')
  spineGrad.addColorStop(0.5, 'rgba(95,80,160,0.35)')
  spineGrad.addColorStop(1, 'rgba(95,80,160,0)')
  ctx.fillStyle = spineGrad
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.2, R * 0.1, R * 0.35, 0, 0, Math.PI * 2)
  ctx.fill()

  // Bioluminescent dotted edges along trailing edge
  const edgePoints = 18
  for (let i = 0; i < edgePoints; i++) {
    const t = i / (edgePoints - 1)
    const x = -R * 0.95 + t * R * 1.9
    const arch = Math.sin(t * Math.PI)
    const y = -R * 0.5 + arch * -R * 0.05 + (1 - arch) * R * 0.05
    const c = i % 4 === 0 ? 'rgba(202,255,112,1)' : 'rgba(168,240,200,0.9)'
    ctx.fillStyle = c
    ctx.beginPath(); ctx.arc(x, y - arch * R * 0.03, 2 + (1 - Math.abs(t - 0.5) * 2) * 1.5, 0, Math.PI * 2); ctx.fill()
  }

  // Constellation of softer glow dots scattered on the wings
  for (let i = 0; i < 14; i++) {
    const x = (rng() - 0.5) * R * 1.6
    const y = -R * 0.3 + rng() * R * 0.4
    const inBody = Math.abs(x) < R * 0.95 - Math.abs(y * 0.8)
    if (!inBody) continue
    ctx.fillStyle = 'rgba(202,255,112,0.85)'
    ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill()
    const halo = ctx.createRadialGradient(x, y, 0, x, y, R * 0.06)
    halo.addColorStop(0, 'rgba(202,255,112,0.4)')
    halo.addColorStop(1, 'rgba(202,255,112,0)')
    ctx.fillStyle = halo
    ctx.beginPath(); ctx.arc(x, y, R * 0.06, 0, Math.PI * 2); ctx.fill()
  }

  // Twin eye glow
  ctx.fillStyle = 'rgba(255,213,145,0.95)'
  ctx.beginPath(); ctx.arc(-R * 0.18, -R * 0.32, R * 0.025, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(R * 0.18, -R * 0.32, R * 0.025, 0, Math.PI * 2); ctx.fill()

  // Flowing tail
  const tailGrad = ctx.createLinearGradient(0, R * 0.18, 0, R * 1.1)
  tailGrad.addColorStop(0, 'rgba(155,124,216,0.85)')
  tailGrad.addColorStop(0.7, 'rgba(126,200,255,0.55)')
  tailGrad.addColorStop(1, 'rgba(126,200,255,0)')
  ctx.strokeStyle = tailGrad
  ctx.lineWidth = R * 0.045
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, R * 0.18)
  ctx.bezierCurveTo(R * 0.14, R * 0.45, -R * 0.14, R * 0.7, R * 0.05, R * 1.0)
  ctx.stroke()
  // Tail glow tip
  const tipGlow = ctx.createRadialGradient(R * 0.05, R * 1.0, 0, R * 0.05, R * 1.0, R * 0.12)
  tipGlow.addColorStop(0, 'rgba(202,255,112,0.95)')
  tipGlow.addColorStop(1, 'rgba(202,255,112,0)')
  ctx.fillStyle = tipGlow
  ctx.beginPath(); ctx.arc(R * 0.05, R * 1.0, R * 0.12, 0, Math.PI * 2); ctx.fill()
}

function drawCarnivorous(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Outer glow halo
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.3)
  halo.addColorStop(0, 'rgba(255,154,139,0.18)')
  halo.addColorStop(0.6, 'rgba(155,124,216,0.10)')
  halo.addColorStop(1, 'rgba(155,124,216,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, Math.PI * 2); ctx.fill()

  // Wispy filaments radiating out from the body
  const filaments = 22
  for (let i = 0; i < filaments; i++) {
    const a = (i / filaments) * Math.PI * 2 + rng() * 0.05
    const len = R * (0.85 + rng() * 0.45)
    const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len)
    grad.addColorStop(0, 'rgba(212,196,240,0)')
    grad.addColorStop(0.4, 'rgba(212,196,240,0.5)')
    grad.addColorStop(1, 'rgba(255,193,209,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = 1 + rng() * 0.6
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45)
    const wob = (rng() - 0.5) * 0.3
    const cx = Math.cos(a + wob) * len * 0.7
    const cy = Math.sin(a + wob) * len * 0.7
    ctx.quadraticCurveTo(cx, cy, Math.cos(a) * len, Math.sin(a) * len)
    ctx.stroke()
  }

  // Two opposing curved jaws — translucent petal shapes
  function jaw(rotate: number): void {
    ctx.save()
    ctx.rotate(rotate)
    const jawGrad = ctx.createLinearGradient(0, -R * 0.85, 0, 0)
    jawGrad.addColorStop(0, 'rgba(255,154,139,0.95)')
    jawGrad.addColorStop(0.5, 'rgba(255,193,209,0.85)')
    jawGrad.addColorStop(1, 'rgba(255,193,209,0.4)')
    ctx.fillStyle = jawGrad
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-R * 0.55, -R * 0.2, -R * 0.55, -R * 0.7, -R * 0.05, -R * 0.85)
    ctx.bezierCurveTo(0, -R * 0.95, 0, -R * 0.95, R * 0.05, -R * 0.85)
    ctx.bezierCurveTo(R * 0.55, -R * 0.7, R * 0.55, -R * 0.2, 0, 0)
    ctx.closePath()
    ctx.fill()
    // Inner darker shading
    const inner = ctx.createLinearGradient(0, -R * 0.85, 0, 0)
    inner.addColorStop(0, 'rgba(120,40,90,0)')
    inner.addColorStop(1, 'rgba(80,20,60,0.7)')
    ctx.fillStyle = inner
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-R * 0.4, -R * 0.15, -R * 0.4, -R * 0.5, -R * 0.04, -R * 0.65)
    ctx.bezierCurveTo(0, -R * 0.7, 0, -R * 0.7, R * 0.04, -R * 0.65)
    ctx.bezierCurveTo(R * 0.4, -R * 0.5, R * 0.4, -R * 0.15, 0, 0)
    ctx.closePath()
    ctx.fill()
    // Tiny luminescent teeth-cilia along the inner edge
    ctx.fillStyle = 'rgba(253,255,254,0.9)'
    const teeth = 8
    for (let i = 0; i < teeth; i++) {
      const t = i / (teeth - 1)
      const ang = Math.PI + t * Math.PI
      const x = Math.sin(ang) * R * 0.32
      const y = -R * 0.45 + Math.cos(ang) * -R * 0.25
      ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill()
    }
    // Rim highlight
    ctx.strokeStyle = 'rgba(253,255,254,0.6)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-R * 0.5, -R * 0.18)
    ctx.bezierCurveTo(-R * 0.52, -R * 0.65, -R * 0.04, -R * 0.85, 0, -R * 0.92)
    ctx.bezierCurveTo(R * 0.04, -R * 0.85, R * 0.52, -R * 0.65, R * 0.5, -R * 0.18)
    ctx.stroke()
    ctx.restore()
  }
  jaw(-0.18)
  jaw(Math.PI + 0.18)

  // Glowing pearl at the centre
  const pearlBase = ctx.createRadialGradient(-R * 0.04, -R * 0.04, 0, 0, 0, R * 0.18)
  pearlBase.addColorStop(0, 'rgba(255,255,210,1)')
  pearlBase.addColorStop(0.5, 'rgba(255,213,145,0.95)')
  pearlBase.addColorStop(1, 'rgba(255,154,139,0)')
  ctx.fillStyle = pearlBase
  ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill()
  // Hot core
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.07)
  core.addColorStop(0, 'rgba(253,255,254,1)')
  core.addColorStop(1, 'rgba(255,213,145,0)')
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, Math.PI * 2); ctx.fill()
  // Specular highlight on pearl
  ctx.fillStyle = 'rgba(253,255,254,0.9)'
  ctx.beginPath(); ctx.arc(-R * 0.025, -R * 0.025, R * 0.018, 0, Math.PI * 2); ctx.fill()

  // Slim stem connecting pearl to body
  ctx.strokeStyle = 'rgba(155,124,216,0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, R * 0.05)
  ctx.lineTo(R * 0.02, R * 0.4)
  ctx.stroke()
}

function drawMossPatch(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Big watercolor wash
  softBlob(ctx, 0, 0, R * 1.2, 'rgb(95,210,192)', 0.35)
  softBlob(ctx, R * 0.3, -R * 0.2, R * 0.7, 'rgb(155,124,216)', 0.25)
  softBlob(ctx, -R * 0.4, R * 0.3, R * 0.6, 'rgb(255,154,139)', 0.20)
  // Mushroom dots
  const palette = ['rgba(255,213,145,1)', 'rgba(202,255,112,1)', 'rgba(255,193,209,1)'] as const
  for (let i = 0; i < 18; i++) {
    const a = rng() * Math.PI * 2
    const rad = Math.pow(rng(), 0.6) * R
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad
    const sz = R * (0.04 + rng() * 0.04)
    const c = palette[Math.floor(rng() * palette.length)]
    // cap
    ctx.fillStyle = c
    ctx.beginPath(); ctx.arc(x, y, sz, Math.PI, 0); ctx.fill()
    // stem
    ctx.fillStyle = 'rgba(253,255,254,0.85)'
    ctx.fillRect(x - sz * 0.25, y, sz * 0.5, sz * 0.6)
    // glow
    softBlob(ctx, x, y, sz * 3, c.replace('rgba', 'rgb').replace(/,1\)$/, ')'), 0.4)
  }
}

/* --------------------------------------------------------------------------
 * Themed-drawer wrappers — match deck `drawBioCreature` envelope and
 * dispatch by type.
 * -------------------------------------------------------------------------- */

function withBioOrigin(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  body: () => void,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  body()
  ctx.restore()
}

const drawMainSequence: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawAnemone(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawRedGiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawCoralBloom(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawBlueSupergiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawJellyfish(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawWhiteDwarf: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawSeaUrchin(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.82)
}

const drawNeutronStar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawSpores(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.82)
}

const drawPulsar: ThemedDrawer = (ctx, cx, cy, r) => {
  withBioOrigin(ctx, cx, cy, () => drawAnglerLight(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawBinary: ThemedDrawer = (ctx, cx, cy, r) => {
  withBioOrigin(ctx, cx, cy, () => drawTwinFlowers(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawQuasar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawMantaray(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.7)
}

const drawBlackHole: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawCarnivorous(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawNebula: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => drawMossPatch(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.7)
}

/* --------------------------------------------------------------------------
 * Default drawer — soft glowing spore for cluster-hue stars. On-theme so
 * the cluster fallback doesn't read as a hole in the field.
 * -------------------------------------------------------------------------- */

const drawDefault: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withBioOrigin(ctx, cx, cy, () => {
    const palette = ['rgb(168,240,200)', 'rgb(255,193,209)', 'rgb(212,196,240)'] as const
    const c = palette[Math.floor(rng() * palette.length)]
    softBlob(ctx, 0, 0, r * 1.2, c, 0.55)
    ctx.fillStyle = 'rgba(253,255,254,1)'
    ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill()
  })
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.82)
}

export const bioDrawers = {
  'main-sequence': drawMainSequence,
  'red-giant': drawRedGiant,
  'blue-supergiant': drawBlueSupergiant,
  'white-dwarf': drawWhiteDwarf,
  'neutron-star': drawNeutronStar,
  'pulsar': drawPulsar,
  'binary': drawBinary,
  'quasar': drawQuasar,
  'black-hole': drawBlackHole,
  'nebula': drawNebula,
} as const

export const bioDefaultDrawer: ThemedDrawer = drawDefault

// Re-export palette for the background module so colours stay in sync.
export { BIO }
