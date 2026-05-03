/**
 * F11 — Theme registry. All registered themes by id.
 *
 * Adding a new theme = build a `Theme` object under `themes/<id>/index.ts`,
 * then register it here. The picker (StatsBar) enumerates `Object.values`.
 */

import type { Theme, ThemeSummary } from './types'
import { jwstTheme } from './jwst'

export const defaultThemeId = 'jwst'

const themes: Record<string, Theme> = {
  [jwstTheme.id]: jwstTheme,
}

export function getTheme(id: string): Theme | null {
  return themes[id] ?? null
}

export function getThemeOrDefault(id: string | null | undefined): Theme {
  if (id && themes[id]) return themes[id]
  return themes[defaultThemeId]
}

export function listThemes(): ThemeSummary[] {
  return Object.values(themes).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
  }))
}
