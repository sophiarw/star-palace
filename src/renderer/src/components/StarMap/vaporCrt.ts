/**
 * F-NEXT-D — Vapor CRT post-pass effects.
 *
 * Two pure draw helpers ported verbatim from the graphics-update deck
 * (`docs/gui-update/star-renderers.js`, lines 740-755):
 *
 * - `drawScanlines` renders a 1px-tall black band every 3px under the
 *   `multiply` blend, simulating the dark gaps between CRT phosphor rows.
 *   Runs as a single full-frame pass at the end of the StarMap draw loop;
 *   gated on the vapor theme.
 * - `drawChromaticAberration` paints a magenta + cyan halo pair offset by
 *   ±2 px around a bright core under the `screen` blend, simulating the
 *   colour fringing of an analogue CRT under emphasis. Applied per focused
 *   star (selected / hovered / neighbour / highlight) in the decoration
 *   pass — calling it for every visible star would dwarf the rest of the
 *   frame budget.
 *
 * Both functions save / restore their own ctx state so callers can wrap
 * them without bracketing themselves. No allocation per call (no Path2D,
 * no gradient creation) — fillRect and arc fills only.
 */

/**
 * Full-frame CRT scanline overlay. Per the deck spec the bands are
 * `rgba(0,0,0,0.30)` under `multiply`, one row every 3 CSS px. The fillRect
 * loop stays sharp because the renderer disables image smoothing on vapor;
 * it stays cheap because it's all opaque-fill rectangles which Skia merges
 * into a single GPU draw on most hardware.
 */
export function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
  ctx.restore()
}

/**
 * Per-core chromatic aberration shimmer. Two filled arcs at ±2 px on the
 * x-axis (magenta left, cyan right) under `screen` blend so they brighten
 * the underlying core rather than overwriting it. Radius is `r * 0.6` —
 * smaller than the source halo so the shimmer reads as a bright nucleus
 * fringe, not a halo replacement.
 */
export function drawChromaticAberration(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = 'rgba(255, 0, 122, 0.20)'
  ctx.beginPath()
  ctx.arc(cx - 2, cy, r * 0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(0, 245, 255, 0.20)'
  ctx.beginPath()
  ctx.arc(cx + 2, cy, r * 0.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
