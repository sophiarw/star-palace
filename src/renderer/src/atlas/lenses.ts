import type { AtlasLens } from '@shared/atlas'
import { stellarMagnitude, STELLAR_BASE_COLORS } from './stellarVisual'

export const LENSES: { id: AtlasLens; name: string; legend: string }[] = [
  { id: 'visible', name: 'Visible · Natural sky', legend: '' },
  { id: 'recent', name: 'Ultraviolet · Recent changes', legend: 'Blue: modified within a day · Ivory: this week · Gold: older · Dim: unknown' },
  { id: 'size', name: 'Infrared · File size', legend: 'Blue: under 1 MiB · Ivory: 1–16 MiB · Gold: over 16 MiB · Scale follows bytes' },
  { id: 'connections', name: 'Radio · Connections', legend: 'White lines: folder siblings · Colored clouds: duplicates or strong similarity' },
]

/** Observing metaphors, not physical wavelength measurements. No geometry changes. */
export function lensAppearance(lens: AtlasLens, file: { size?: number; modifiedAt?: number }, now: number): { color?: string; alpha: number } {
  if (lens === 'recent') {
    if (!file.modifiedAt || !Number.isFinite(file.modifiedAt)) return { alpha: .4 }
    const days = Math.max(0, now - file.modifiedAt) / 86400000
    return { color: days < 1 ? STELLAR_BASE_COLORS[4] : days < 7 ? STELLAR_BASE_COLORS[0] : STELLAR_BASE_COLORS[3], alpha: days < 1 ? 1 : days < 7 ? .8 : .4 }
  }
  if (lens === 'size') {
    const magnitude = stellarMagnitude(file.size)
    return { color: magnitude < .5 ? STELLAR_BASE_COLORS[4] : magnitude <= .7 ? STELLAR_BASE_COLORS[0] : STELLAR_BASE_COLORS[3], alpha: .5 + magnitude * .5 }
  }
  return { alpha: lens === 'connections' ? .6 : 1 }
}
