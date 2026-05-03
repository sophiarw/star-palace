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
  /** Solid CSS colour or CSS gradient string applied to the StarMap clear pass. */
  canvasFill: string
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
  ui: ThemeUi
}

/** Picker-friendly summary; cheap to enumerate without loading drawers. */
export interface ThemeSummary {
  id: string
  name: string
  description: string
}
