/**
 * F11 — Theme contract.
 *
 * Themes are pluggable visual aesthetics for the StarMap. Each theme owns
 * the 9 typed drawers, a fallback drawer for cluster-hue stars, the canvas
 * backdrop, and chrome (accent colour, font stack, title casing). Adding a
 * new theme = add a new directory under `themes/` and register it.
 *
 * Drawers run after `getTypedStarSprite()` has set up the offscreen canvas
 * (size + center). They draw inside the sprite canvas using `proc.ts`
 * helpers; the cache key includes the theme id so swapping themes is
 * O(visible-stars) re-renders rather than a full repaint.
 */

import type { StarType } from '@shared/types'

/**
 * Per-instance procedural drawer. `(cx, cy)` is the sprite centre in
 * canvas-pixel coords; `r` is the base sprite radius (already scaled by
 * `TYPED_SCALE[type] × spriteCoreRadius(sizeBucket)`); `rng` is a per-id
 * mulberry32 stream from `seedFromId(starId)`. The drawer pulls a fixed
 * number of `rng()` values in a stable order (any reorder reseeds
 * downstream features and shifts the visual identity of every star).
 *
 * `sizeBucket` is supplied for drawers that adjust line widths or detail
 * count by zoom tier (e.g. blue supergiant spike thickness).
 */
export type ThemedDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rng: () => number,
  sizeBucket: number,
) => void

export interface ThemeBackground {
  /**
   * Solid CSS colour applied to the StarMap clear pass. Always painted so
   * resize / DPR transitions don't reveal stale pixels even when `paint`
   * is provided. Themes that ship a full-canvas `paint` painter still
   * supply a sensible fallback colour in case the painter no-ops (e.g.
   * cache miss during the very first frame).
   */
  canvasFill: string
  /**
   * F-NEXT-C — optional far-background painter sitting between the canvas
   * clear and the prerendered backdrop. JWST uses this for the deep-field
   * teal+pink wash + 180 colour-temp pinpoints; vapor uses it for the
   * synthwave gradient + Tron-grid horizon. The painter owns its own
   * offscreen-canvas cache (see `backgroundNebula.ts`); the call site
   * doesn't need to memoise. `seedKey` is a stable identifier (typically
   * the theme id) folded into the cache key + per-cloud PRNG seeds.
   */
  paint?: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    dpr: number,
    seedKey: string,
  ) => void
  /**
   * When true, signals that `paint` covers the full canvas with an opaque
   * image of its own — the StarMap draw loop should skip the prerendered
   * deep-field backdrop (`getBackdrop`) for this theme since it would
   * just clobber `paint`. Vapor sets this; JWST keeps the prerendered
   * backdrop for its parallax pan/zoom effect on top of the wash.
   */
  replacesBackdrop?: boolean
  /**
   * Optional per-frame overlay drawn after the sky and before HUD. Use for
   * scanlines, Tron grids, vignettes, etc. Receives canvas-pixel size.
   */
  overlay?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

export interface ThemeUi {
  /** Single accent colour written to `--starpalace-accent` on `<html>`. */
  accentColor: string
  /** Chrome font stack applied to slide / panel chrome via `--starpalace-font`. */
  fontStack: string
  /** Optional CSS text-transform for slide titles (e.g. uppercase for vapor). */
  titleTransform?: 'uppercase' | 'none'
  /** Optional letter-spacing for the same titles. */
  titleLetterSpacing?: string
}

/**
 * F-NEXT-B — image smoothing applied to the main canvas ctx each frame.
 * `'high'` = bilinear with `imageSmoothingQuality='high'` for soft realistic
 * sprites (JWST). `'off'` = nearest-neighbour (`imageSmoothingEnabled=false`)
 * to preserve hard pixel edges in arcade aesthetics (Vapor, Atari).
 */
export type ThemeSmoothing = 'high' | 'off'

export interface Theme {
  /** Stable id; persisted in localStorage. */
  id: string
  /** Human label shown in the picker. */
  name: string
  /** One-line description shown alongside the picker entry. */
  description: string
  /** Per-type drawer table; missing entries fall back to `defaultDrawer`. */
  drawers: Partial<Record<StarType, ThemedDrawer>>
  /** Drawer used for cluster-hue stars (no manual `star_type`). */
  defaultDrawer: ThemedDrawer
  background: ThemeBackground
  /** Image smoothing mode applied to the main canvas ctx each frame. */
  smoothing: ThemeSmoothing
  /**
   * F-NEXT-D — optional final-frame post-pass. Runs after every other draw
   * pass (sprites, decorations, theme overlay, HUD chevrons, lock glyphs,
   * pin-drag preview, labels). Use for screen-space CRT scanlines, bloom,
   * vignette darken, etc. Receives canvas size in CSS pixels and the
   * effective DPR — most callers need only the size.
   */
  postPass?: (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => void
  /**
   * Backing-store DPR cap. `effectiveDpr = min(window.devicePixelRatio, dprCap)`.
   * Themes that intentionally render at low resolution (e.g. Atari 8-bit
   * aesthetic) set this to `1.0`. Omitted / `undefined` = no cap (native DPR
   * for high-DPI displays). The renderer re-runs its resize handler when the
   * theme flips so the cap takes effect immediately.
   */
  dprCap?: number
  ui: ThemeUi
}

/** Picker-friendly summary; cheap to enumerate without loading drawers. */
export interface ThemeSummary {
  id: string
  name: string
  description: string
}
