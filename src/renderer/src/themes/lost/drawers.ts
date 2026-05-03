/**
 * Lost in space theme drawers — illustrated, narrative.
 *
 * Ported from `docs/three-new-themes/new-themes.js` (`drawLostObject`)
 * with no behavioural changes; rng() call order is identical so the same
 * star id renders identically to the deck preview.
 *
 * No celestial bodies — every "star" is a tiny figure: astronauts, ships,
 * rockets, satellites, asteroids, lighthouses, jellyfish-pilots,
 * wormholes, debris fields. Same engine, different cast.
 */

import type { ThemedDrawer } from '../types'
import { applyCircularFade } from '../../components/StarMap/proc'

/* --------------------------------------------------------------------------
 * Palette + ink-stroke helper (deck `LOST`, `inkStroke`)
 * -------------------------------------------------------------------------- */

const LOST = {
  bg:      '#0d1224',
  deep:    '#080b18',
  white:   '#f2f4ff',
  visor:   '#7ec8ff',
  helmet:  '#e8e8ee',
  suit:    '#d4d8e2',
  rust:    '#c47a3a',
  rock:    '#6b5a4a',
  shadow:  '#2b3148',
  red:     '#e85c5c',
  orange:  '#ffb15c',
  cyan:    '#60d8d8',
  pink:    '#ff8fb1',
  purple:  '#a585d8',
  yellow:  '#ffd35c',
} as const

function inkStroke(ctx: CanvasRenderingContext2D, color: string, lw: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/* --------------------------------------------------------------------------
 * Per-object drawers (deck `drawAstronaut`, `drawRustyShip`, …)
 *
 * Each one is called inside a `ctx.save() + translate(cx, cy) + rotate(tilt)`
 * block, so all coords below are relative to the origin (the sprite centre).
 * -------------------------------------------------------------------------- */

function drawAstronaut(ctx: CanvasRenderingContext2D, R: number): void {
  // tether
  inkStroke(ctx, LOST.cyan, 1.5)
  ctx.beginPath()
  ctx.moveTo(R * 0.4, R * 0.3)
  ctx.bezierCurveTo(R, R, R * 1.4, R * 0.3, R * 1.6, -R * 0.2)
  ctx.stroke()
  // body
  ctx.fillStyle = LOST.suit
  ctx.beginPath()
  ctx.ellipse(0, R * 0.15, R * 0.32, R * 0.4, 0, 0, Math.PI * 2)
  ctx.fill()
  // arms
  inkStroke(ctx, LOST.suit, R * 0.18)
  ctx.beginPath()
  ctx.moveTo(-R * 0.25, R * 0.1); ctx.lineTo(-R * 0.55, R * 0.35)
  ctx.moveTo(R * 0.25, R * 0.1); ctx.lineTo(R * 0.5, R * 0.35)
  ctx.stroke()
  // legs
  inkStroke(ctx, LOST.suit, R * 0.16)
  ctx.beginPath()
  ctx.moveTo(-R * 0.15, R * 0.45); ctx.lineTo(-R * 0.25, R * 0.75)
  ctx.moveTo(R * 0.15, R * 0.45); ctx.lineTo(R * 0.22, R * 0.78)
  ctx.stroke()
  // helmet
  ctx.fillStyle = LOST.helmet
  ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 0.32, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = LOST.visor
  ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 0.22, 0, Math.PI * 2); ctx.fill()
  // visor reflection
  ctx.fillStyle = LOST.white
  ctx.beginPath(); ctx.arc(-R * 0.1, -R * 0.32, R * 0.06, 0, Math.PI * 2); ctx.fill()
  // chestplate
  ctx.fillStyle = LOST.shadow
  ctx.fillRect(-R * 0.12, R * 0.05, R * 0.24, R * 0.14)
  ctx.fillStyle = LOST.red
  ctx.beginPath(); ctx.arc(-R * 0.05, R * 0.12, R * 0.025, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = LOST.cyan
  ctx.beginPath(); ctx.arc(R * 0.05, R * 0.12, R * 0.025, 0, Math.PI * 2); ctx.fill()
}

function drawRustyShip(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // squat hull
  ctx.fillStyle = LOST.rust
  ctx.beginPath()
  ctx.ellipse(0, 0, R, R * 0.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // dome
  ctx.fillStyle = LOST.cyan
  ctx.beginPath()
  ctx.arc(0, -R * 0.15, R * 0.4, Math.PI, 0)
  ctx.fill()
  // window highlight
  ctx.fillStyle = LOST.white
  ctx.beginPath(); ctx.arc(-R * 0.12, -R * 0.25, R * 0.05, 0, Math.PI * 2); ctx.fill()
  // stripe
  ctx.fillStyle = LOST.shadow
  ctx.fillRect(-R, -R * 0.05, R * 2, R * 0.1)
  // landing legs
  inkStroke(ctx, LOST.shadow, 3)
  ctx.beginPath()
  for (const x of [-R * 0.6, 0, R * 0.6]) {
    ctx.moveTo(x, R * 0.35); ctx.lineTo(x * 1.2, R * 0.7)
  }
  ctx.stroke()
  // rust patches
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.arc((rng() - 0.5) * R * 1.6, (rng() - 0.5) * R * 0.5, R * 0.04 + rng() * R * 0.05, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawRocket(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.rotate(-Math.PI / 6)
  // body
  ctx.fillStyle = LOST.helmet
  ctx.beginPath()
  ctx.moveTo(0, -R)
  ctx.bezierCurveTo(R * 0.4, -R * 0.6, R * 0.4, R * 0.5, R * 0.25, R * 0.7)
  ctx.lineTo(-R * 0.25, R * 0.7)
  ctx.bezierCurveTo(-R * 0.4, R * 0.5, -R * 0.4, -R * 0.6, 0, -R)
  ctx.fill()
  // window
  ctx.fillStyle = LOST.cyan
  ctx.beginPath(); ctx.arc(0, -R * 0.15, R * 0.18, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = LOST.white
  ctx.beginPath(); ctx.arc(-R * 0.06, -R * 0.2, R * 0.05, 0, Math.PI * 2); ctx.fill()
  // fins
  ctx.fillStyle = LOST.red
  ctx.beginPath()
  ctx.moveTo(R * 0.25, R * 0.4); ctx.lineTo(R * 0.55, R * 0.85); ctx.lineTo(R * 0.25, R * 0.7); ctx.fill()
  ctx.beginPath()
  ctx.moveTo(-R * 0.25, R * 0.4); ctx.lineTo(-R * 0.55, R * 0.85); ctx.lineTo(-R * 0.25, R * 0.7); ctx.fill()
  // flame
  ctx.fillStyle = LOST.orange
  ctx.beginPath()
  ctx.moveTo(-R * 0.18, R * 0.7)
  ctx.bezierCurveTo(-R * 0.1, R * 1.2, R * 0.1, R * 1.2, R * 0.18, R * 0.7)
  ctx.fill()
  ctx.fillStyle = LOST.yellow
  ctx.beginPath()
  ctx.moveTo(-R * 0.10, R * 0.7)
  ctx.bezierCurveTo(-R * 0.05, R * 1.0, R * 0.05, R * 1.0, R * 0.10, R * 0.7)
  ctx.fill()
}

function drawSatellite(ctx: CanvasRenderingContext2D, R: number): void {
  // body
  ctx.fillStyle = LOST.helmet
  ctx.fillRect(-R * 0.2, -R * 0.25, R * 0.4, R * 0.5)
  // dish
  ctx.fillStyle = LOST.cyan
  ctx.beginPath()
  ctx.arc(0, -R * 0.45, R * 0.3, Math.PI, 0); ctx.fill()
  inkStroke(ctx, LOST.shadow, 2)
  ctx.beginPath(); ctx.moveTo(0, -R * 0.45); ctx.lineTo(0, -R * 0.75); ctx.stroke()
  // solar panels
  ctx.fillStyle = LOST.shadow
  ctx.fillRect(-R * 0.95, -R * 0.15, R * 0.7, R * 0.3)
  ctx.fillRect(R * 0.25, -R * 0.15, R * 0.7, R * 0.3)
  ctx.fillStyle = LOST.purple
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(-R * 0.92 + i * R * 0.23, -R * 0.13, R * 0.18, R * 0.26)
    ctx.fillRect(R * 0.28 + i * R * 0.23, -R * 0.13, R * 0.18, R * 0.26)
  }
}

function drawAsteroidCluster(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  const n = 7
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rng() * 0.3
    const rad = R * (0.4 + rng() * 0.6)
    const x = Math.cos(ang) * rad
    const y = Math.sin(ang) * rad
    const sz = R * (0.15 + rng() * 0.2)
    ctx.fillStyle = LOST.rock
    ctx.beginPath()
    const sides = 6 + Math.floor(rng() * 3)
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2
      const rr = sz * (0.7 + rng() * 0.6)
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
    }
    ctx.closePath(); ctx.fill()
    // crater
    ctx.fillStyle = LOST.shadow
    ctx.beginPath(); ctx.arc(x - sz * 0.2, y - sz * 0.1, sz * 0.18, 0, Math.PI * 2); ctx.fill()
  }
}

function drawSpaceLighthouse(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Octagonal beacon
  ctx.fillStyle = LOST.helmet
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const px = Math.cos(a) * R * 0.35, py = Math.sin(a) * R * 0.35
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  }
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = LOST.shadow
  ctx.fillRect(-R * 0.04, -R * 0.35, R * 0.08, R * 0.7)
  // Beam
  const beamAng = rng() * Math.PI * 2
  for (const sign of [1, -1]) {
    const a = beamAng + (sign < 0 ? Math.PI : 0)
    ctx.save()
    ctx.rotate(a)
    const grad = ctx.createLinearGradient(0, 0, R * 1.6, 0)
    grad.addColorStop(0, 'rgba(255,180,90,0.9)')
    grad.addColorStop(1, 'rgba(255,180,90,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(0, 0); ctx.lineTo(R * 1.6, R * 0.3); ctx.lineTo(R * 1.6, -R * 0.3); ctx.closePath(); ctx.fill()
    ctx.restore()
  }
  ctx.fillStyle = LOST.yellow
  ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = LOST.white
  ctx.beginPath(); ctx.arc(0, 0, R * 0.08, 0, Math.PI * 2); ctx.fill()
}

function drawTwoAstronauts(ctx: CanvasRenderingContext2D, R: number): void {
  ctx.save()
  ctx.translate(-R * 0.5, R * 0.1); ctx.scale(0.7, 0.7); drawAstronaut(ctx, R)
  ctx.restore()
  ctx.save()
  ctx.translate(R * 0.55, -R * 0.1); ctx.rotate(0.5); ctx.scale(0.6, 0.6); drawAstronaut(ctx, R)
  ctx.restore()
  inkStroke(ctx, LOST.cyan, 2)
  ctx.beginPath()
  ctx.moveTo(-R * 0.25, R * 0.1)
  ctx.bezierCurveTo(0, -R * 0.5, R * 0.2, -R * 0.4, R * 0.3, -R * 0.1)
  ctx.stroke()
}

function drawSpaceJellyfish(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  // Bell — translucent purple with cyan rim
  const bellGrad = ctx.createRadialGradient(0, -R * 0.15, 0, 0, -R * 0.15, R * 0.85)
  bellGrad.addColorStop(0, 'rgba(212,196,240,0.95)')
  bellGrad.addColorStop(0.55, 'rgba(155,124,216,0.75)')
  bellGrad.addColorStop(1, 'rgba(155,124,216,0)')
  ctx.fillStyle = bellGrad
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.2, R * 0.85, R * 0.6, 0, Math.PI, 0)
  ctx.lineTo(R * 0.7, R * 0.05)
  ctx.bezierCurveTo(R * 0.4, R * 0.18, -R * 0.4, R * 0.18, -R * 0.7, R * 0.05)
  ctx.closePath()
  ctx.fill()
  // Bell rim — bright cyan accent
  ctx.strokeStyle = 'rgba(126,200,255,0.9)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.2, R * 0.85, R * 0.6, 0, Math.PI + 0.15, -0.15)
  ctx.stroke()
  // Bioluminescent dot ring along bell underside
  for (let i = 0; i < 14; i++) {
    const t = i / 13
    const x = -R * 0.7 + t * R * 1.4
    const y = R * 0.05 + Math.sin(t * Math.PI) * (-R * 0.08)
    const c = i % 3 === 0 ? 'rgba(202,255,112,1)' : 'rgba(126,200,255,0.95)'
    ctx.fillStyle = c
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill()
  }
  // Inner cabin glow
  const cabinGrad = ctx.createRadialGradient(0, -R * 0.25, 0, 0, -R * 0.25, R * 0.3)
  cabinGrad.addColorStop(0, 'rgba(255,213,145,0.9)')
  cabinGrad.addColorStop(1, 'rgba(255,213,145,0)')
  ctx.fillStyle = cabinGrad
  ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 0.3, 0, Math.PI * 2); ctx.fill()
  // Tiny astronaut silhouette inside
  ctx.fillStyle = 'rgba(232,232,238,0.9)'
  ctx.beginPath(); ctx.arc(0, -R * 0.32, R * 0.11, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(126,200,255,0.95)'
  ctx.beginPath(); ctx.arc(0, -R * 0.32, R * 0.075, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(232,232,238,0.9)'
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.18, R * 0.09, R * 0.12, 0, 0, Math.PI * 2)
  ctx.fill()
  // Tentacles — long wavy neon trails
  const tents = 11
  for (let i = 0; i < tents; i++) {
    const xs = -R * 0.6 + (i / (tents - 1)) * R * 1.2
    const len = R * (0.85 + rng() * 0.7)
    const phase = rng() * 6
    const isAccent = i % 2 === 0
    const c1 = isAccent ? 'rgba(126,200,255,0.85)' : 'rgba(212,196,240,0.7)'
    const c2 = isAccent ? 'rgba(202,255,112,0)' : 'rgba(155,124,216,0)'
    const grad = ctx.createLinearGradient(xs, R * 0.05, xs, R * 0.05 + len)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.strokeStyle = grad
    ctx.lineWidth = 1.8 + rng() * 1.2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(xs, R * 0.05)
    const cp1x = xs + Math.sin(phase) * R * 0.18
    const cp2x = xs + Math.sin(phase + 1.5) * R * 0.25
    const ex = xs + (rng() - 0.5) * R * 0.3
    ctx.bezierCurveTo(cp1x, R * 0.05 + len * 0.4, cp2x, R * 0.05 + len * 0.75, ex, R * 0.05 + len)
    ctx.stroke()
    ctx.fillStyle = isAccent ? 'rgba(202,255,112,0.95)' : 'rgba(126,200,255,0.85)'
    ctx.beginPath(); ctx.arc(ex, R * 0.05 + len, 1.6, 0, Math.PI * 2); ctx.fill()
  }
  // Outer ambient glow halo
  const halo = ctx.createRadialGradient(0, -R * 0.1, R * 0.4, 0, -R * 0.1, R * 1.4)
  halo.addColorStop(0, 'rgba(155,124,216,0.18)')
  halo.addColorStop(1, 'rgba(155,124,216,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, -R * 0.1, R * 1.4, 0, Math.PI * 2); ctx.fill()
}

function drawWormhole(ctx: CanvasRenderingContext2D, R: number): void {
  // Concentric rings spiraling inward
  for (let i = 0; i < 8; i++) {
    const t = i / 8
    const rr = R * (1 - t * 0.85)
    ctx.strokeStyle = `rgba(${Math.round(150 - t * 100)}, ${Math.round(120 + t * 60)}, ${Math.round(220 - t * 40)}, ${0.4 + t * 0.5})`
    ctx.lineWidth = R * 0.06
    ctx.beginPath()
    ctx.ellipse(t * R * 0.05, 0, rr, rr * (0.95 - t * 0.3), 0, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = LOST.deep
  ctx.beginPath(); ctx.arc(R * 0.4, 0, R * 0.15, 0, Math.PI * 2); ctx.fill()
}

interface DebrisItem {
  kind: 'gear' | 'glove' | 'panel' | 'bolt' | 'helmet'
  x: number
  y: number
  sz: number
}

function drawDebrisField(ctx: CanvasRenderingContext2D, R: number, rng: () => number): void {
  const items: DebrisItem[] = [
    { kind: 'gear', x: -R * 0.5, y: -R * 0.3, sz: R * 0.25 },
    { kind: 'glove', x: R * 0.4, y: -R * 0.4, sz: R * 0.2 },
    { kind: 'panel', x: -R * 0.3, y: R * 0.45, sz: R * 0.35 },
    { kind: 'bolt', x: R * 0.5, y: R * 0.3, sz: R * 0.12 },
    { kind: 'helmet', x: 0, y: 0, sz: R * 0.3 },
  ]
  for (const it of items) {
    ctx.save()
    ctx.translate(it.x, it.y)
    ctx.rotate(rng() * Math.PI * 2)
    if (it.kind === 'gear') {
      ctx.fillStyle = LOST.rust
      ctx.beginPath()
      const teeth = 10
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2
        const rr = i % 2 ? it.sz : it.sz * 0.78
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr)
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = LOST.deep
      ctx.beginPath(); ctx.arc(0, 0, it.sz * 0.3, 0, Math.PI * 2); ctx.fill()
    } else if (it.kind === 'glove') {
      ctx.fillStyle = LOST.suit
      ctx.beginPath()
      ctx.ellipse(0, 0, it.sz, it.sz * 0.7, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = LOST.shadow
      ctx.fillRect(-it.sz, it.sz * 0.55, it.sz * 2, it.sz * 0.2)
    } else if (it.kind === 'panel') {
      ctx.fillStyle = LOST.shadow
      ctx.fillRect(-it.sz, -it.sz * 0.5, it.sz * 2, it.sz)
      ctx.fillStyle = LOST.purple
      for (let i = 0; i < 4; i++) ctx.fillRect(-it.sz * 0.95 + i * it.sz * 0.5, -it.sz * 0.45, it.sz * 0.45, it.sz * 0.9)
    } else if (it.kind === 'bolt') {
      ctx.fillStyle = LOST.helmet
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        if (i === 0) ctx.moveTo(Math.cos(a) * it.sz, Math.sin(a) * it.sz)
        else ctx.lineTo(Math.cos(a) * it.sz, Math.sin(a) * it.sz)
      }
      ctx.closePath(); ctx.fill()
    } else {
      // helmet
      ctx.fillStyle = LOST.helmet
      ctx.beginPath(); ctx.arc(0, 0, it.sz, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = LOST.visor
      ctx.beginPath(); ctx.arc(0, 0, it.sz * 0.7, 0, Math.PI * 2); ctx.fill()
      // crack
      inkStroke(ctx, LOST.shadow, 2)
      ctx.beginPath()
      ctx.moveTo(-it.sz * 0.5, -it.sz * 0.2)
      ctx.lineTo(it.sz * 0.1, it.sz * 0.1)
      ctx.lineTo(it.sz * 0.4, -it.sz * 0.1)
      ctx.stroke()
    }
    ctx.restore()
  }
}

/* --------------------------------------------------------------------------
 * Themed-drawer wrappers — match the deck's `drawLostObject` envelope
 * (translate + tilt) and dispatch.
 * -------------------------------------------------------------------------- */

function withTilt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rng: () => number,
  body: () => void,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  const tilt = (rng() - 0.5) * 0.8
  ctx.rotate(tilt)
  body()
  ctx.restore()
}

const drawMainSequence: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawAstronaut(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawRedGiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawRustyShip(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawBlueSupergiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawRocket(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawWhiteDwarf: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawSatellite(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawNeutronStar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawAsteroidCluster(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawPulsar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawSpaceLighthouse(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawBinary: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawTwoAstronauts(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawQuasar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawSpaceJellyfish(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawBlackHole: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawWormhole(ctx, r))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawNebula: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => drawDebrisField(ctx, r, rng))
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

/* --------------------------------------------------------------------------
 * Default drawer — small rotating debris bolt for cluster-hue stars. Cheap
 * and on-theme so the cluster fallback doesn't read as "missing data."
 * -------------------------------------------------------------------------- */

const drawDefault: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  withTilt(ctx, cx, cy, rng, () => {
    // soft ambient glow
    const ambient = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.2)
    ambient.addColorStop(0, 'rgba(126,200,255,0.4)')
    ambient.addColorStop(1, 'rgba(126,200,255,0)')
    ctx.fillStyle = ambient
    ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.fill()
    // small floating bolt — same shape as the debris-field bolt item.
    ctx.fillStyle = LOST.helmet
    const sz = r * 0.55
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      if (i === 0) ctx.moveTo(Math.cos(a) * sz, Math.sin(a) * sz)
      else ctx.lineTo(Math.cos(a) * sz, Math.sin(a) * sz)
    }
    ctx.closePath(); ctx.fill()
    ctx.fillStyle = LOST.cyan
    ctx.beginPath(); ctx.arc(0, 0, sz * 0.3, 0, Math.PI * 2); ctx.fill()
  })
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

export const lostDrawers = {
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

export const lostDefaultDrawer: ThemedDrawer = drawDefault
