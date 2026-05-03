/**
 * JWST theme drawers — F8a per-type variation, deep-space-realism aesthetic.
 *
 * Ported from `prototypes/f8a/index.html` (worktree-agent-af8ce890cf5c7d92b)
 * with no behavioural changes; rng() call order is identical so the same
 * star id renders identically to the prototype deck.
 *
 * Each drawer pulls rng() in a fixed order; reordering reseeds downstream
 * features. Comments tag the call order at the top of each function.
 */

import type { ThemedDrawer } from '../types'
import {
  applyCircularFade,
  rngPick,
  rngRange,
} from '../../components/StarMap/proc'
import { paintNebulaCloud } from '../../components/StarMap/backgroundNebula'

/* --------------------------------------------------------------------------
 * 1. RED GIANT — convection mottling + solar prominences + limb darkening
 * -------------------------------------------------------------------------- */

const drawRedGiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  // F15 — outer halo alphas reduced ~30% (×0.7) so convection mottling reads.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.2)
  halo.addColorStop(0,    'rgba(255,210,160,0.6)')
  halo.addColorStop(0.18, 'rgba(255,150,90,0.39)')
  halo.addColorStop(0.40, 'rgba(220,90,50,0.21)')
  halo.addColorStop(0.65, 'rgba(160,40,30,0.10)')
  halo.addColorStop(1,    'rgba(110,20,10,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Convection mottling — additive blobs over the disc
  // rng() ord: A) blob count, B..) per-blob {angle, radial-pos, size, alpha}
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const blobCount = 8 + Math.floor(rng() * 7) // 8..14
  for (let i = 0; i < blobCount; i++) {
    let bx = 0, by = 0, ok = false
    for (let t = 0; t < 6; t++) {
      const u = rng() * 2 - 1
      const v = rng() * 2 - 1
      if (u * u + v * v < 0.85) { bx = u; by = v; ok = true; break }
    }
    if (!ok) { bx = 0; by = 0 }
    const sz = rngRange(rng, 0.15, 0.40) * r
    const a = rngRange(rng, 0.18, 0.45)
    const px = cx + bx * r * 0.85
    const py = cy + by * r * 0.85
    const g = ctx.createRadialGradient(px, py, 0, px, py, sz)
    g.addColorStop(0,   `rgba(255,235,200,${a})`)
    g.addColorStop(0.5, `rgba(255,170,90,${a * 0.6})`)
    g.addColorStop(1,   'rgba(255,120,40,0)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()

  // Limb darkening (no rng) — thin dark ring at r*1.0 for spherical solidity
  const limb = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.05)
  limb.addColorStop(0,    'rgba(0,0,0,0)')
  limb.addColorStop(0.7,  'rgba(80,20,10,0.0)')
  limb.addColorStop(0.92, 'rgba(60,15,5,0.45)')
  limb.addColorStop(1,    'rgba(20,5,0,0)')
  ctx.fillStyle = limb
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2); ctx.fill()

  // Prominences — 2..4 arcing flares from the limb
  // rng() ord: count, then per-prominence {angle, length, drift}
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const promCount = 2 + Math.floor(rng() * 3) // 2..4
  for (let i = 0; i < promCount; i++) {
    const ang = rng() * Math.PI * 2
    const length = rngRange(rng, 1.15, 1.55)
    const drift  = rngRange(rng, -0.6, 0.6)
    const sx = cx + Math.cos(ang) * r * 0.98
    const sy = cy + Math.sin(ang) * r * 0.98
    const cpAng = ang + drift
    const cpx = cx + Math.cos(cpAng) * r * 1.65
    const cpy = cy + Math.sin(cpAng) * r * 1.65
    const ex = cx + Math.cos(ang + drift * 1.4) * r * length
    const ey = cy + Math.sin(ang + drift * 1.4) * r * length

    const STEPS = 14
    let prevX = sx, prevY = sy
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS
      const it = 1 - t
      const nx = it * it * sx + 2 * it * t * cpx + t * t * ex
      const ny = it * it * sy + 2 * it * t * cpy + t * t * ey
      const lw = (1 - t * 0.7) * Math.max(1.0, r * 0.10)
      const a = (1 - t * 0.85) * 0.7
      const g = ctx.createLinearGradient(prevX, prevY, nx, ny)
      g.addColorStop(0, `rgba(255,210,140,${a})`)
      g.addColorStop(1, `rgba(255,140,80,${a * 0.6})`)
      ctx.strokeStyle = g
      ctx.lineWidth = lw
      ctx.beginPath(); ctx.moveTo(prevX, prevY); ctx.lineTo(nx, ny); ctx.stroke()
      prevX = nx; prevY = ny
    }
  }
  ctx.restore()

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.9)
  core.addColorStop(0,   'rgba(255,235,210,0.85)')
  core.addColorStop(0.6, 'rgba(255,170,100,0.30)')
  core.addColorStop(1,   'rgba(255,140,80,0)')
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  applyCircularFade(ctx, cx, cy, cx, 0.78)
}

/* --------------------------------------------------------------------------
 * 2. BLUE SUPERGIANT — spike count + halo eccentricity + spike base angle
 * -------------------------------------------------------------------------- */

const drawBlueSupergiant: ThemedDrawer = (ctx, cx, cy, r, rng, sizeBucket) => {
  // rng() ord: A) spike count, B) halo squish, C) halo tilt, D) spike base angle
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

  // Eccentric halo
  // F15 — outer halo alphas reduced ~30% (×0.7) so spike + core interior reads.
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.scale(squish, 1 / squish)
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.2)
  halo.addColorStop(0,    'rgba(230,240,255,0.67)')
  halo.addColorStop(0.15, 'rgba(160,190,255,0.42)')
  halo.addColorStop(0.40, 'rgba(80,120,230,0.25)')
  halo.addColorStop(0.70, 'rgba(40,70,180,0.11)')
  halo.addColorStop(1,    'rgba(0,10,80,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, r * 3.2, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  // Spikes
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt + base)
  ctx.globalCompositeOperation = 'screen'
  const reach = r * 3.0
  const lineWidth = sizeBucket >= 4 ? 1.6 : 1.3
  for (let i = 0; i < spikeCount; i++) {
    const ang = (i / spikeCount) * Math.PI
    const dx = Math.cos(ang) * reach
    const dy = Math.sin(ang) * reach
    const grad = ctx.createLinearGradient(-dx, -dy, dx, dy)
    grad.addColorStop(0,    'rgba(120,160,255,0)')
    grad.addColorStop(0.45, 'rgba(220,235,255,0.85)')
    grad.addColorStop(0.5,  'rgba(255,255,255,1)')
    grad.addColorStop(0.55, 'rgba(220,235,255,0.85)')
    grad.addColorStop(1,    'rgba(120,160,255,0)')
    ctx.strokeStyle = grad
    ctx.lineWidth = lineWidth
    ctx.beginPath(); ctx.moveTo(-dx, -dy); ctx.lineTo(dx, dy); ctx.stroke()
  }
  ctx.restore()

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4)
  core.addColorStop(0,    'rgba(255,250,235,1)')
  core.addColorStop(0.30, 'rgba(220,230,255,0.95)')
  core.addColorStop(0.65, 'rgba(150,180,255,0.55)')
  core.addColorStop(1,    'rgba(60,120,220,0)')
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill()

  applyCircularFade(ctx, cx, cy, cx, 0.78)
}

/* --------------------------------------------------------------------------
 * 3a. MAIN SEQUENCE — F10: warm yellow Sun-like core, modest halo, no spikes
 *
 * Sits between white-dwarf (small/cool/white) and red-giant (large/warm
 * /orange) on the usage-mode lifecycle scale. Slightly bigger and warmer
 * than the white-dwarf so the bucket reads "settled, frequently touched."
 * Stylistically a quieter, smaller relative of red-giant — same warmth
 * family but no convection mottling, no prominences, no diffraction
 * spikes. Procedural variation deferred to F8a follow-up.
 * -------------------------------------------------------------------------- */

const drawMainSequence: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  // rng() ord: A) size jitter (kept tiny so Sun-like uniformity wins).
  const jitter = rngRange(rng, 0.95, 1.08)
  r = r * jitter

  // Soft warm halo — sun-yellow/amber falloff, no spikes baked.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4)
  halo.addColorStop(0,    'rgba(255, 240, 200, 0.85)')
  halo.addColorStop(0.20, 'rgba(255, 215, 130, 0.55)')
  halo.addColorStop(0.45, 'rgba(255, 175, 80, 0.28)')
  halo.addColorStop(0.75, 'rgba(220, 130, 50, 0.10)')
  halo.addColorStop(1,    'rgba(160, 80, 30, 0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Limb darkening — thin warm ring near the disc edge for spherical solidity.
  const limb = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.05)
  limb.addColorStop(0,    'rgba(0, 0, 0, 0)')
  limb.addColorStop(0.92, 'rgba(180, 100, 40, 0.30)')
  limb.addColorStop(1,    'rgba(60, 30, 10, 0)')
  ctx.fillStyle = limb
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2); ctx.fill()

  // Bright Sun-yellow core, slightly hot at the very center.
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.0)
  core.addColorStop(0,    'rgba(255, 250, 220, 1)')
  core.addColorStop(0.35, 'rgba(255, 230, 160, 0.95)')
  core.addColorStop(0.70, 'rgba(255, 195, 110, 0.55)')
  core.addColorStop(1,    'rgba(240, 150, 60, 0)')
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.0, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  applyCircularFade(ctx, cx, cy, cx, 0.80)
}

/* --------------------------------------------------------------------------
 * 3. WHITE DWARF — corona wisps + size jitter
 * -------------------------------------------------------------------------- */

const drawWhiteDwarf: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  // rng() ord: A) size jitter, B..) per-wisp {count, angles, lengths}
  const jitter = rngRange(rng, 0.9, 1.1)
  r = r * jitter

  // F15 — outer halo stops (0.65 onward) reduced ~30% so wisps read against
  // the disc; core (0, 0.35) untouched to keep the bright nucleus.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6)
  grad.addColorStop(0,    'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(240,245,255,0.85)')
  grad.addColorStop(0.65, 'rgba(200,220,255,0.28)')
  grad.addColorStop(1,    'rgba(160,190,240,0)')
  ctx.fillStyle = grad
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2); ctx.fill()

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const wispCount = 4 + Math.floor(rng() * 4) // 4..7
  for (let i = 0; i < wispCount; i++) {
    const ang = rng() * Math.PI * 2
    const lenScale = rngRange(rng, 1.5, 2.4)
    const inner = r * 1.05
    const outer = r * lenScale
    const ix = cx + Math.cos(ang) * inner
    const iy = cy + Math.sin(ang) * inner
    const ox = cx + Math.cos(ang) * outer
    const oy = cy + Math.sin(ang) * outer
    const g = ctx.createLinearGradient(ix, iy, ox, oy)
    g.addColorStop(0, 'rgba(220,235,255,0.55)')
    g.addColorStop(1, 'rgba(160,200,255,0)')
    ctx.strokeStyle = g
    ctx.lineWidth = 0.9
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ox, oy); ctx.stroke()
  }
  ctx.restore()

  applyCircularFade(ctx, cx, cy, cx, 0.82)
}

/* --------------------------------------------------------------------------
 * 4. NEUTRON STAR — nucleus of glowing red+grey dots (no rays)
 * -------------------------------------------------------------------------- */

const drawNeutronStar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  // Soft outer halo
  // F15 — outer halo alphas reduced ~30% (×0.7) so the nucleus dot field reads.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4)
  halo.addColorStop(0,    'rgba(255,180,170,0.21)')
  halo.addColorStop(0.35, 'rgba(220,140,150,0.13)')
  halo.addColorStop(0.7,  'rgba(160,90,110,0.05)')
  halo.addColorStop(1,    'rgba(80,40,60,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Faint inner backing
  const back = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6)
  back.addColorStop(0,    'rgba(60,30,40,0.85)')
  back.addColorStop(0.7,  'rgba(40,20,30,0.45)')
  back.addColorStop(1,    'rgba(20,10,20,0)')
  ctx.fillStyle = back
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2); ctx.fill()

  const dotCount = 28 + Math.floor(rng() * 22) // 28..49
  const clusterR = rngRange(rng, 1.35, 1.7) * r
  const minSep   = r * 0.18

  const RED  = { core: '255,90,80',    glow: '255,150,120' }
  const GREY = { core: '220,225,235',  glow: '180,190,210' }

  interface Dot { x: number; y: number; isRed: boolean; dotR: number; alpha: number }
  const placed: Dot[] = []
  let tries = 0
  while (placed.length < dotCount && tries < dotCount * 18) {
    tries++
    const u = rng() * 2 - 1
    const v = rng() * 2 - 1
    if (u * u + v * v > 1) continue
    const pullF = 0.85
    const px = cx + u * clusterR * pullF
    const py = cy + v * clusterR * pullF
    let ok = true
    for (const p of placed) {
      const dx = p.x - px, dy = p.y - py
      if (dx * dx + dy * dy < minSep * minSep) { ok = false; break }
    }
    if (!ok) continue
    const isRed = rng() < 0.6
    const dotR = rngRange(rng, 0.12, 0.20) * r
    const alpha = rngRange(rng, 0.85, 1.0)
    placed.push({ x: px, y: py, isRed, dotR, alpha })
  }

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  for (const p of placed) {
    const palette = p.isRed ? RED : GREY
    const haloR = p.dotR * 2.2
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR)
    g.addColorStop(0,   `rgba(${palette.glow},${0.55 * p.alpha})`)
    g.addColorStop(0.5, `rgba(${palette.glow},${0.22 * p.alpha})`)
    g.addColorStop(1,   `rgba(${palette.glow},0)`)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()

  for (const p of placed) {
    const palette = p.isRed ? RED : GREY
    const cg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.dotR)
    cg.addColorStop(0,    `rgba(255,255,255,${p.alpha})`)
    cg.addColorStop(0.35, `rgba(${palette.core},${p.alpha})`)
    cg.addColorStop(1,    `rgba(${palette.core},0)`)
    ctx.fillStyle = cg
    ctx.beginPath(); ctx.arc(p.x, p.y, p.dotR, 0, Math.PI * 2); ctx.fill()
  }

  applyCircularFade(ctx, cx, cy, cx, 0.85)
}

/* --------------------------------------------------------------------------
 * 5. PULSAR — beam tilt + asymmetry + intensity ratio + plasma mottling
 * -------------------------------------------------------------------------- */

const drawPulsar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const tilt = rng() * Math.PI
  const drift = rngRange(rng, -Math.PI / 12, Math.PI / 12)
  const ratio = rngRange(rng, 0.7, 1.3)

  // F15 — outer halo alphas reduced ~30% (×0.7) so plasma mottling pops.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5)
  halo.addColorStop(0,    'rgba(210,235,255,0.55)')
  halo.addColorStop(0.18, 'rgba(170,215,255,0.35)')
  halo.addColorStop(0.38, 'rgba(130,185,250,0.20)')
  halo.addColorStop(0.58, 'rgba(95,155,235,0.10)')
  halo.addColorStop(0.80, 'rgba(60,115,205,0.04)')
  halo.addColorStop(1,    'rgba(40,80,170,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Plasma mottling
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const mottleCount = 8 + Math.floor(rng() * 7) // 8..14
  for (let i = 0; i < mottleCount; i++) {
    let bx = 0, by = 0, ok = false
    for (let t = 0; t < 6; t++) {
      const u = rng() * 2 - 1, v = rng() * 2 - 1
      if (u * u + v * v < 0.85) { bx = u; by = v; ok = true; break }
    }
    if (!ok) { bx = 0; by = 0 }
    const sz = rngRange(rng, 0.18, 0.42) * r
    const a = rngRange(rng, 0.25, 0.55)
    const px = cx + bx * r * 0.85
    const py = cy + by * r * 0.85
    const warm = rng() < 0.45
    const g = ctx.createRadialGradient(px, py, 0, px, py, sz)
    if (warm) {
      g.addColorStop(0,   `rgba(255,250,235,${a})`)
      g.addColorStop(0.5, `rgba(190,220,255,${a * 0.5})`)
      g.addColorStop(1,   'rgba(120,170,240,0)')
    } else {
      g.addColorStop(0,   `rgba(220,240,255,${a})`)
      g.addColorStop(0.5, `rgba(120,180,255,${a * 0.6})`)
      g.addColorStop(1,   'rgba(60,120,220,0)')
    }
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()

  // Fine plasma pinpoints
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  const fineCount = 12 + Math.floor(rng() * 9) // 12..20
  for (let i = 0; i < fineCount; i++) {
    let bx = 0, by = 0, ok = false
    for (let t = 0; t < 6; t++) {
      const u = rng() * 2 - 1, v = rng() * 2 - 1
      if (u * u + v * v < 0.7) { bx = u; by = v; ok = true; break }
    }
    if (!ok) { bx = 0; by = 0 }
    const px = cx + bx * r * 0.7
    const py = cy + by * r * 0.7
    const pr = rngRange(rng, 0.6, 1.6)
    const a = rngRange(rng, 0.55, 0.95)
    const pg = ctx.createRadialGradient(px, py, 0, px, py, pr * 2)
    pg.addColorStop(0,   `rgba(255,255,255,${a})`)
    pg.addColorStop(0.5, `rgba(220,240,255,${a * 0.5})`)
    pg.addColorStop(1,   'rgba(180,220,255,0)')
    ctx.fillStyle = pg
    ctx.beginPath(); ctx.arc(px, py, pr * 2, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()

  // Two beams with bright core overlay
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const beamLen = r * 4.5
  const drawBeam = (angle: number, intensity: number): void => {
    const tx = cx + Math.cos(angle) * beamLen
    const ty = cy + Math.sin(angle) * beamLen
    const px = -Math.sin(angle), py = Math.cos(angle)

    const g = ctx.createLinearGradient(cx, cy, tx, ty)
    const a = Math.min(1, 0.95 * intensity)
    g.addColorStop(0,    `rgba(220,240,255,${a})`)
    g.addColorStop(0.35, `rgba(160,210,255,${a * 0.55})`)
    g.addColorStop(0.7,  `rgba(110,170,240,${a * 0.18})`)
    g.addColorStop(1,    'rgba(80,140,220,0)')
    const w = r * 0.55 * intensity
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(cx + px * w * 0.25, cy + py * w * 0.25)
    ctx.lineTo(tx + px * w, ty + py * w)
    ctx.lineTo(tx - px * w, ty - py * w)
    ctx.lineTo(cx - px * w * 0.25, cy - py * w * 0.25)
    ctx.closePath(); ctx.fill()

    const cw = w * 0.32
    const cg = ctx.createLinearGradient(cx, cy, tx, ty)
    const ca = Math.min(1, 0.85 * intensity)
    cg.addColorStop(0,    `rgba(255,255,255,${ca})`)
    cg.addColorStop(0.45, `rgba(220,240,255,${ca * 0.5})`)
    cg.addColorStop(0.85, `rgba(180,220,255,${ca * 0.10})`)
    cg.addColorStop(1,    'rgba(160,210,255,0)')
    ctx.fillStyle = cg
    ctx.beginPath()
    ctx.moveTo(cx + px * cw * 0.15, cy + py * cw * 0.15)
    ctx.lineTo(tx + px * cw, ty + py * cw)
    ctx.lineTo(tx - px * cw, ty - py * cw)
    ctx.lineTo(cx - px * cw * 0.15, cy - py * cw * 0.15)
    ctx.closePath(); ctx.fill()
  }
  drawBeam(tilt, ratio)
  drawBeam(tilt + Math.PI + drift, 2 - ratio)
  ctx.restore()

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.0)
  core.addColorStop(0,    'rgba(255,255,255,1)')
  core.addColorStop(0.4,  'rgba(230,245,255,0.95)')
  core.addColorStop(0.75, 'rgba(180,210,255,0.5)')
  core.addColorStop(1,    'rgba(120,170,240,0)')
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.0, 0, Math.PI * 2); ctx.fill()

  applyCircularFade(ctx, cx, cy, cx, 0.78)
}

/* --------------------------------------------------------------------------
 * 6. BINARY — separation + size ratio + orbit angle
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
  // F15 — outer halo alphas reduced ~30% (×0.7) so the two cores read distinctly.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, (r + sep) * 1.6)
  halo.addColorStop(0,    'rgba(255,220,180,0.39)')
  halo.addColorStop(0.35, 'rgba(255,180,130,0.15)')
  halo.addColorStop(0.7,  'rgba(220,90,60,0.06)')
  halo.addColorStop(1,    'rgba(120,40,30,0)')
  ctx.scale(1.4, 0.85)
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, (r + sep) * 1.6, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  const drawCore = (x: number, y: number, rr: number, palette: [string, string, string, string]): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr * 1.4)
    g.addColorStop(0,    palette[0])
    g.addColorStop(0.35, palette[1])
    g.addColorStop(0.7,  palette[2])
    g.addColorStop(1,    palette[3])
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, rr * 1.4, 0, Math.PI * 2); ctx.fill()
  }
  drawCore(x1, y1, r1, [
    'rgba(255,245,215,1)',
    'rgba(255,200,140,0.95)',
    'rgba(255,140,80,0.45)',
    'rgba(220,90,40,0)',
  ])
  drawCore(x2, y2, r2, [
    'rgba(255,235,200,1)',
    'rgba(255,170,110,0.95)',
    'rgba(255,110,70,0.45)',
    'rgba(180,60,40,0)',
  ])

  applyCircularFade(ctx, cx, cy, cx, 0.78)
}

/* --------------------------------------------------------------------------
 * 7. QUASAR — jet asymmetry + accent hue + accretion disc tilt
 * -------------------------------------------------------------------------- */

const drawQuasar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const asym = rngRange(rng, 1.5, 3.0)
  const accents = [
    { stop1: 'rgba(120,255,255,0.8)', stop2: 'rgba(80,200,240,0)' },
    { stop1: 'rgba(255,120,255,0.8)', stop2: 'rgba(220,80,200,0)' },
    { stop1: 'rgba(255,235,140,0.8)', stop2: 'rgba(220,180,80,0)' },
  ] as const
  const accent = rngPick(rng, accents)
  const tilt = rng() * Math.PI

  // F15 — outer halo alphas reduced ~30% (×0.7) so accretion disc + jets read.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.4)
  halo.addColorStop(0,    'rgba(255,220,255,0.6)')
  halo.addColorStop(0.25, 'rgba(220,150,240,0.32)')
  halo.addColorStop(0.6,  'rgba(160,80,220,0.13)')
  halo.addColorStop(1,    'rgba(80,30,160,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.globalCompositeOperation = 'lighter'
  const disc = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.8)
  disc.addColorStop(0,    'rgba(255,210,140,0)')
  disc.addColorStop(0.3,  'rgba(255,180,110,0.6)')
  disc.addColorStop(0.55, 'rgba(255,210,160,0.85)')
  disc.addColorStop(0.8,  'rgba(220,140,100,0.35)')
  disc.addColorStop(1,    'rgba(120,40,30,0)')
  ctx.scale(1, 0.32)
  ctx.fillStyle = disc
  ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt + Math.PI / 2)
  ctx.globalCompositeOperation = 'lighter'
  const baseLen = r * 4.0
  const lens = [baseLen * Math.sqrt(asym), baseLen / Math.sqrt(asym)]
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? 1 : -1
    const tx = 0, ty = sign * lens[i]
    const g = ctx.createLinearGradient(0, 0, tx, ty)
    g.addColorStop(0,    'rgba(255,255,255,0.95)')
    g.addColorStop(0.4,  'rgba(255,210,255,0.45)')
    g.addColorStop(0.8,  'rgba(220,140,240,0.15)')
    g.addColorStop(1,    'rgba(180,80,220,0)')
    ctx.fillStyle = g
    const w = r * 0.4
    ctx.beginPath()
    ctx.moveTo(-w * 0.3, 0)
    ctx.lineTo(-w * 1.0, ty)
    ctx.lineTo( w * 1.0, ty)
    ctx.lineTo( w * 0.3, 0)
    ctx.closePath(); ctx.fill()
    const ag = ctx.createLinearGradient(0, 0, tx, ty)
    ag.addColorStop(0,    accent.stop1)
    ag.addColorStop(0.5,  accent.stop1.replace(/,0\.8\)/, ',0.4)'))
    ag.addColorStop(1,    accent.stop2)
    ctx.strokeStyle = ag
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(-w * 0.3, 0); ctx.lineTo(-w * 1.0, ty)
    ctx.moveTo( w * 0.3, 0); ctx.lineTo( w * 1.0, ty)
    ctx.stroke()
  }
  ctx.restore()

  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4)
  core.addColorStop(0,    'rgba(255,255,255,1)')
  core.addColorStop(0.35, 'rgba(255,225,255,0.95)')
  core.addColorStop(0.7,  'rgba(220,150,240,0.4)')
  core.addColorStop(1,    'rgba(160,60,220,0)')
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill()

  applyCircularFade(ctx, cx, cy, cx, 0.7)
}

/* --------------------------------------------------------------------------
 * 8. BLACK HOLE — ring tilt + asymmetric brightness + photon-sphere thickness
 * -------------------------------------------------------------------------- */

const drawBlackHole: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const tilt = rng() * Math.PI
  const asymPhase = rng() * Math.PI * 2
  const innerR = rngRange(rng, 0.92, 1.00) * r
  const ringW  = rngRange(rng, 0.4, 0.6) * r

  // F15 — outer warp gradient alphas reduced ~30% (×0.7) so the accretion ring
  // + asymmetric Doppler arc read sharply against the void.
  const warp = ctx.createRadialGradient(cx, cy, r * 1.3, cx, cy, r * 3.5)
  warp.addColorStop(0,    'rgba(80,40,100,0.39)')
  warp.addColorStop(0.45, 'rgba(50,25,80,0.21)')
  warp.addColorStop(0.8,  'rgba(20,10,50,0.07)')
  warp.addColorStop(1,    'rgba(0,0,0,0)')
  ctx.fillStyle = warp
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(tilt)
  ctx.globalCompositeOperation = 'lighter'

  const outerR = innerR + ringW
  const baseRing = ctx.createRadialGradient(0, 0, innerR, 0, 0, outerR)
  baseRing.addColorStop(0,    'rgba(255,140,40,0)')
  baseRing.addColorStop(0.45, 'rgba(255,170,70,0.7)')
  baseRing.addColorStop(0.6,  'rgba(255,210,130,0.95)')
  baseRing.addColorStop(1,    'rgba(255,140,40,0)')
  ctx.fillStyle = baseRing
  ctx.beginPath(); ctx.arc(0, 0, outerR, 0, Math.PI * 2); ctx.fill()

  const halfStart = asymPhase - Math.PI / 2
  const ARC_SEGS = 14
  for (let i = 0; i < ARC_SEGS; i++) {
    const t0 = halfStart + (i / ARC_SEGS) * Math.PI
    const t1 = halfStart + ((i + 1) / ARC_SEGS) * Math.PI
    const mid = (i + 0.5) / ARC_SEGS
    const k = Math.sin(mid * Math.PI)
    const a = 0.55 * k
    const segGrad = ctx.createRadialGradient(0, 0, innerR, 0, 0, outerR)
    segGrad.addColorStop(0,   'rgba(255,200,120,0)')
    segGrad.addColorStop(0.5, `rgba(255,230,160,${a})`)
    segGrad.addColorStop(0.7, `rgba(255,250,200,${a * 1.5})`)
    segGrad.addColorStop(1,   'rgba(255,200,120,0)')
    ctx.fillStyle = segGrad
    ctx.beginPath()
    ctx.arc(0, 0, outerR, t0, t1)
    ctx.arc(0, 0, innerR, t1, t0, true)
    ctx.closePath(); ctx.fill()
  }

  const tiltSquish = 0.55
  ctx.save()
  ctx.scale(1, tiltSquish)
  ctx.strokeStyle = 'rgba(255,220,140,0.55)'
  ctx.lineWidth = ringW * 0.18
  ctx.beginPath()
  ctx.arc(0, 0, (innerR + outerR) / 2 / tiltSquish, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  ctx.restore()

  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(0,0,0,1)'
  ctx.beginPath(); ctx.arc(cx, cy, innerR * 0.92, 0, Math.PI * 2); ctx.fill()
  ctx.restore()

  applyCircularFade(ctx, cx, cy, cx, 0.78)
}

/* --------------------------------------------------------------------------
 * 9. NEBULA — Carina-inspired stacked-blob cloud
 *
 * Painter body lives in `../../components/StarMap/backgroundNebula.ts` so
 * the same six-pass cloud engine is shared between the typed nebula sprite
 * (here) and the JWST background-nebula wash (Stage C). Pass `feather:
 * true` so the sprite tile gets the destination-out radial mask that
 * softens the hard clip boundary at deep zoom.
 *
 * rng() call order is intentional and stable; reordering reseeds every
 * downstream feature and shifts the visual identity of every nebula sprite.
 * -------------------------------------------------------------------------- */

const drawNebula: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  paintNebulaCloud(ctx, cx, cy, r * 2.4, rng, {
    // Carina-inspired but pushed +25% saturation per visual review feedback.
    // Cool teal base, brighter warm tan, saturated gold, deeper magenta,
    // brighter teal highlight. Hot knots: warm peach + blue-white + warm pink.
    bands: [
      [40, 100, 145],    // deep teal/blue (cool base, more saturated)
      [210, 140, 80],    // warm tan (brighter)
      [255, 175, 95],    // gold (more saturated)
      [225, 90, 145],    // dusty magenta (deeper)
      [110, 220, 220],   // teal highlight (brighter)
    ],
    hot: [[255, 220, 180], [220, 240, 255], [255, 180, 140]],
    dustAlpha: 0.55,
    filaments: 9,
    shape: { ax: 1.0, ay: 0.78, rot: rng() * Math.PI },
    intensity: 1.3,
    feather: true,
  })
}

/* --------------------------------------------------------------------------
 * Default drawer for cluster-hue / no-type stars
 * -------------------------------------------------------------------------- */

/**
 * Soft warm/cool generic glow — used when the star has no `star_type` and
 * no auto-default. The bucket-sprite path (`getStarSprite`) still owns
 * default cluster-hue rendering for now; this is the fallback if a future
 * call site routes through `getTypedStarSprite` with no type.
 */
const drawDefault: ThemedDrawer = (ctx, cx, cy, r) => {
  // F15 — outer halo alphas reduced ~30% (×0.7) for parity with typed drawers.
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3.0)
  halo.addColorStop(0,    'rgba(220,235,255,0.49)')
  halo.addColorStop(0.4,  'rgba(120,160,220,0.18)')
  halo.addColorStop(1,    'rgba(40,60,120,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.2)
  core.addColorStop(0,   'rgba(255,255,255,1)')
  core.addColorStop(0.5, 'rgba(220,235,255,0.85)')
  core.addColorStop(1,   'rgba(140,180,240,0)')
  ctx.fillStyle = core
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, Math.PI * 2); ctx.fill()
  applyCircularFade(ctx, cx, cy, cx, 0.82)
}

export const jwstDrawers = {
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

export const jwstDefaultDrawer: ThemedDrawer = drawDefault
