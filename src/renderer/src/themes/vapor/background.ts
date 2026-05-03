/**
 * Vapor background — synthwave sunset gradient + Tron-grid horizon overlay
 * + CRT scanlines. Rebuilt per draw because the canvas size changes with
 * the viewport; cheap (a handful of fills + ~30 stroked lines).
 */

import type { ThemeBackground } from '../types'

const SUNSET_STOPS: ReadonlyArray<[number, string]> = [
  [0.00, '#1a0033'],
  [0.35, '#2a0050'],
  [0.55, '#5a0080'],
  [0.78, '#ff2a8a'],
  [0.92, '#ff7e1a'],
  [1.00, '#1a0033'],
]

function paintGridAndScanlines(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  // Tron-grid horizon — horizontal lines fading inward toward the horizon
  ctx.save()
  ctx.strokeStyle = 'rgba(0, 245, 255, 0.32)'
  ctx.lineWidth = 1
  for (let y = h * 0.6; y < h; y += 14) {
    const t = (y - h * 0.6) / (h * 0.4)
    ctx.globalAlpha = 0.15 + t * 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  // Vanishing-point vertical lines
  const vpx = w / 2
  const vpy = h * 0.6
  for (let i = -10; i <= 10; i++) {
    const x = vpx + i * (w / 20)
    ctx.globalAlpha = 0.25
    ctx.strokeStyle = 'rgba(255, 42, 252, 0.45)'
    ctx.beginPath()
    ctx.moveTo(vpx, vpy)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  ctx.restore()

  // CRT scanlines across the whole sky
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.fillRect(0, y, w, 1)
  }
  ctx.restore()
}

/**
 * `canvasFill` is sampled by StarMap as a solid CSS colour for the opaque
 * clear pass. The full sunset gradient + grid + scanlines are painted in
 * the per-frame `overlay`. The clear-pass colour is the gradient mid-tone
 * so any sliver that escapes the overlay still reads as vapor purple.
 */
export const vaporBackground: ThemeBackground = {
  canvasFill: '#2a0050',
  overlay(ctx, w, h) {
    // Sunset gradient (full repaint of the canvas — the StarMap clear pass
    // already runs before this; re-stamping here is intentional so the sky
    // sits over the vapor backdrop rather than the JWST deep-field cache).
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    for (const [t, col] of SUNSET_STOPS) bg.addColorStop(t, col)
    ctx.save()
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    ctx.restore()

    // Grid + scanlines overlay sit ON TOP of the existing scene so they
    // read as a CRT screen effect, not a backdrop. Source-over by default.
    paintGridAndScanlines(ctx, w, h)
  },
}
