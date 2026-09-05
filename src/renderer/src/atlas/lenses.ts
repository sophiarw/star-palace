import type { AtlasLens } from '@shared/atlas'
import { stellarMagnitude } from './stellarVisual'
import { ULTRAVIOLET, INFRARED } from './lensPalette'

export const LENSES: { id: AtlasLens; name: string; legend: string }[] = [
  { id: 'visible', name: 'Visible · Natural sky', legend: '' },
  { id: 'recent', name: 'Ultraviolet · Recent changes', legend: 'Bright violet: within a day · Lavender: this week · Muted violet: older · Dim: unknown' },
  { id: 'size', name: 'Infrared · File size', legend: 'Red: under 1 MiB · Orange: 1–16 MiB · Bright amber: over 16 MiB · Dim: unknown' },
  { id: 'connections', name: 'Radio · Connections', legend: 'White lines: folder siblings · Colored clouds: duplicates or strong similarity' },
]

/** Observing metaphors, not physical wavelength measurements. No geometry changes. */
export function lensAppearance(lens: AtlasLens, file: { size?: number; modifiedAt?: number }, now: number): { color?: string; alpha: number } {
  if (lens === 'recent') {
    if (!file.modifiedAt || !Number.isFinite(file.modifiedAt)) return { color: ULTRAVIOLET.unknown, alpha: .4 }
    const days = Math.max(0, now - file.modifiedAt) / 86400000
    return { color: days < 1 ? ULTRAVIOLET.day : days < 7 ? ULTRAVIOLET.week : ULTRAVIOLET.older, alpha: days < 1 ? 1 : days < 7 ? .8 : .4 }
  }
  if (lens === 'size') {
    if (file.size === undefined || !Number.isFinite(file.size) || file.size < 0) return { color: INFRARED.unknown, alpha: .4 }
    const magnitude = stellarMagnitude(file.size)
    return { color: magnitude < .5 ? INFRARED.small : magnitude <= .7 ? INFRARED.medium : INFRARED.large, alpha: .5 + magnitude * .5 }
  }
  return { alpha: lens === 'connections' ? .6 : 1 }
}
