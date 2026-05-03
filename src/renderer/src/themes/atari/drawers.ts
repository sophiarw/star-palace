/**
 * Atari low-res theme drawers — 8-bit pixel-art per-type variation.
 *
 * Ported from `docs/three-new-themes/new-themes.js` (`drawAtariStar`) with
 * no behavioural changes; rng() call order is identical so the same star
 * id renders identically to the deck preview.
 *
 * Each drawer paints onto a transparent sprite canvas using a fixed
 * 8-colour Atari-ish palette and a derived `px` block size. The renderer
 * paints the per-theme background under the sprites, so the deck's
 * `atariBg` step is intentionally NOT folded in here — it lives in
 * `atari/background.ts` and runs once per frame as the canvas overlay.
 */

import type { ThemedDrawer } from '../types'
import { applyCircularFade } from '../../components/StarMap/proc'

/* --------------------------------------------------------------------------
 * 8-colour palette (deck `ATARI`)
 * -------------------------------------------------------------------------- */

const ATARI = {
  bg:      '#1a1a2e',
  dark:    '#0a0a1a',
  white:   '#fff8d8',
  yellow:  '#ffd23f',
  orange:  '#ff7f3f',
  red:     '#e63946',
  cyan:    '#7fdbff',
  green:   '#7be3a8',
  purple:  '#a06cd5',
  magenta: '#ff5fb4',
} as const

const PALETTE_COLORS = [
  ATARI.white, ATARI.yellow, ATARI.orange, ATARI.red,
  ATARI.cyan, ATARI.green, ATARI.purple, ATARI.magenta,
] as const

/* --------------------------------------------------------------------------
 * Pixel-grid primitives — every draw call snaps to integer offsets so the
 * image stays crisp under the theme's nearest-neighbour smoothing. The
 * backing-store DPR cap (set in the theme: `dprCap: 1.0`) makes each
 * `px` step physically chunky on retina displays as well.
 * -------------------------------------------------------------------------- */

function atariPx(ctx: CanvasRenderingContext2D, x: number, y: number, sz: number, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), sz, sz)
}

function atariDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rad: number,
  px: number,
  color: string,
): void {
  const rr = Math.round(rad / px)
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy <= rr * rr) {
        atariPx(ctx, cx + dx * px, cy + dy * px, px, color)
      }
    }
  }
}

function atariRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rad: number,
  px: number,
  color: string,
  dither: boolean,
): void {
  const rr = Math.round(rad / px)
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const d = dx * dx + dy * dy
      if (d <= rr * rr && d >= (rr - 1) * (rr - 1)) {
        if (!dither || (dx + dy) % 2 === 0) {
          atariPx(ctx, cx + dx * px, cy + dy * px, px, color)
        }
      }
    }
  }
}

function atariSpike(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ang: number,
  len: number,
  px: number,
  color: string,
  rng: () => number,
): void {
  const steps = Math.round(len / px)
  for (let i = 0; i < steps; i++) {
    const t = i / steps
    const r = len * t
    if (rng() > t * 0.5) {
      atariPx(ctx, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, px, color)
    }
  }
}

/** Pixel block size derived from the sprite radius. Caps at ≥ 2 so the
 * smallest size buckets still get visible blocks. */
function atariPixelSize(R: number): number {
  return Math.max(2, Math.round(R / 16))
}

/* --------------------------------------------------------------------------
 * Per-type drawers
 * -------------------------------------------------------------------------- */

const drawMainSequence: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  // Bullseye: red → orange → yellow → white
  atariDisc(ctx, cx, cy, r, px, ATARI.red)
  atariDisc(ctx, cx, cy, r * 0.75, px, ATARI.orange)
  atariDisc(ctx, cx, cy, r * 0.5, px, ATARI.yellow)
  atariDisc(ctx, cx, cy, r * 0.22, px, ATARI.white)
  for (let i = 0; i < 4; i++) atariSpike(ctx, cx, cy, (i / 4) * Math.PI, r * 1.6, px, ATARI.yellow, rng)
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.82)
}

const drawRedGiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  atariDisc(ctx, cx, cy, r * 1.2, px, ATARI.red)
  atariRing(ctx, cx, cy, r * 1.05, px, ATARI.orange, true)
  atariDisc(ctx, cx, cy, r * 0.7, px, ATARI.orange)
  atariDisc(ctx, cx, cy, r * 0.4, px, ATARI.yellow)
  // Mottled pixels for convection
  const mottlePalette = [ATARI.yellow, ATARI.white, ATARI.red] as const
  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2
    const rad = rng() * r * 0.9
    const c = mottlePalette[Math.floor(rng() * mottlePalette.length)]
    atariPx(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, px, c)
  }
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawBlueSupergiant: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  atariDisc(ctx, cx, cy, r * 1.1, px, ATARI.purple)
  atariDisc(ctx, cx, cy, r * 0.85, px, ATARI.cyan)
  atariDisc(ctx, cx, cy, r * 0.45, px, ATARI.white)
  for (let i = 0; i < 4; i++) atariSpike(ctx, cx, cy, (i / 4) * Math.PI, r * 2, px, ATARI.cyan, rng)
  for (let i = 0; i < 4; i++) atariSpike(ctx, cx, cy, (i / 4) * Math.PI + Math.PI / 4, r * 1.4, px, ATARI.white, rng)
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawWhiteDwarf: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  atariDisc(ctx, cx, cy, r * 0.55, px, ATARI.cyan)
  atariDisc(ctx, cx, cy, r * 0.35, px, ATARI.white)
  atariRing(ctx, cx, cy, r * 0.9, px, ATARI.cyan, true)
  for (let i = 0; i < 6; i++) atariSpike(ctx, cx, cy, (i / 6) * Math.PI * 2, r * 1.3, px, ATARI.white, rng)
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.82)
}

const drawNeutronStar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  // Pixel field of red+white dots in a disc; deck used a fixed 16×16 grid.
  const rr = 16
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy <= rr * rr && rng() > 0.55) {
        const c = rng() < 0.6 ? ATARI.red : ATARI.white
        atariPx(ctx, cx + dx * px, cy + dy * px, px, c)
      }
    }
  }
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawPulsar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  const tilt = rng() * Math.PI
  atariDisc(ctx, cx, cy, r * 0.5, px, ATARI.cyan)
  atariDisc(ctx, cx, cy, r * 0.28, px, ATARI.white)
  const beamPalette = [ATARI.cyan, ATARI.white, ATARI.purple] as const
  for (const sign of [1, -1]) {
    const ang = tilt + (sign < 0 ? Math.PI : 0)
    const len = r * 2.5
    const steps = Math.round(len / px)
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      const w = (1 - t) * 3
      for (let k = -Math.floor(w); k <= Math.floor(w); k++) {
        const px2 = cx + Math.cos(ang) * t * len + Math.cos(ang + Math.PI / 2) * k * px
        const py2 = cy + Math.sin(ang) * t * len + Math.sin(ang + Math.PI / 2) * k * px
        if (rng() > t * 0.4) {
          atariPx(ctx, px2, py2, px, beamPalette[Math.floor(rng() * beamPalette.length)])
        }
      }
    }
  }
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawBinary: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  const sep = r * 0.7
  const ang = rng() * Math.PI
  const x1 = cx - Math.cos(ang) * sep, y1 = cy - Math.sin(ang) * sep
  const x2 = cx + Math.cos(ang) * sep, y2 = cy + Math.sin(ang) * sep
  atariDisc(ctx, x1, y1, r * 0.55, px, ATARI.orange)
  atariDisc(ctx, x1, y1, r * 0.3, px, ATARI.yellow)
  atariDisc(ctx, x2, y2, r * 0.4, px, ATARI.cyan)
  atariDisc(ctx, x2, y2, r * 0.22, px, ATARI.white)
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawQuasar: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  const tilt = rng() * Math.PI
  // Edge-on disc as wide ellipse rendered pixel-ily
  const a = Math.round(r * 1.4 / px)
  const b = Math.round(r * 0.4 / px)
  for (let dy = -b; dy <= b; dy++) {
    for (let dx = -a; dx <= a; dx++) {
      if ((dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1) {
        const t = Math.abs(dx) / a
        const c = t < 0.4 ? ATARI.white : t < 0.7 ? ATARI.yellow : ATARI.magenta
        const wx = cx + (dx * Math.cos(tilt) - dy * Math.sin(tilt)) * px
        const wy = cy + (dx * Math.sin(tilt) + dy * Math.cos(tilt)) * px
        atariPx(ctx, wx, wy, px, c)
      }
    }
  }
  // Jets perpendicular to the disc
  const jetAng = tilt + Math.PI / 2
  for (const sign of [1, -1]) {
    const len = r * 2
    const steps = Math.round(len / px)
    for (let i = 0; i < steps; i++) {
      const t = i / steps
      atariPx(
        ctx,
        cx + Math.cos(jetAng) * sign * t * len,
        cy + Math.sin(jetAng) * sign * t * len,
        px,
        ATARI.green,
      )
    }
  }
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.78)
}

const drawBlackHole: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  // Ring + dark center
  atariRing(ctx, cx, cy, r * 1.0, px, ATARI.orange, false)
  atariRing(ctx, cx, cy, r * 0.95, px, ATARI.yellow, true)
  atariRing(ctx, cx, cy, r * 0.85, px, ATARI.orange, false)
  atariDisc(ctx, cx, cy, r * 0.7, px, ATARI.dark)
  // Swirl pixels around
  const swirl = [ATARI.orange, ATARI.red, ATARI.magenta] as const
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2
    const rad = r * (0.95 + rng() * 0.4)
    atariPx(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, px, swirl[Math.floor(rng() * swirl.length)])
  }
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.85)
}

const drawNebula: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  // Cloud of magenta+cyan+green pixels w/ density falloff
  const colors = [ATARI.magenta, ATARI.cyan, ATARI.purple, ATARI.green, ATARI.yellow] as const
  for (let i = 0; i < 220; i++) {
    const a = rng() * Math.PI * 2
    const rad = Math.pow(rng(), 0.7) * r * 1.4
    const c = colors[Math.floor(rng() * colors.length)]
    atariPx(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, px, c)
  }
  // Bright center pinpoints
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2
    const rad = rng() * r * 0.5
    atariPx(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, px, ATARI.white)
  }
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.7)
}

/* --------------------------------------------------------------------------
 * Default drawer for cluster-hue / no-type stars
 * -------------------------------------------------------------------------- */

const drawDefault: ThemedDrawer = (ctx, cx, cy, r, rng) => {
  const px = atariPixelSize(r)
  // Generic 3-band pixel disc; colour pick is rng-driven so cluster-hue
  // stars look variety-rich without sharing an off-palette tint.
  const tint = PALETTE_COLORS[Math.floor(rng() * PALETTE_COLORS.length)]
  atariDisc(ctx, cx, cy, r, px, ATARI.dark)
  atariDisc(ctx, cx, cy, r * 0.65, px, tint)
  atariDisc(ctx, cx, cy, r * 0.3, px, ATARI.white)
  applyCircularFade(ctx, cx, cy, ctx.canvas.width / 2, 0.82)
}

export const atariDrawers = {
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

export const atariDefaultDrawer: ThemedDrawer = drawDefault
