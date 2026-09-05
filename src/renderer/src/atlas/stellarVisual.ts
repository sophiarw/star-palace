import type { StarType } from '@shared/types'

export const STELLAR_BASE_COLORS = ['#f1f1e9', '#f1f1e9', '#eadfca', '#ead2a0', '#c4dcf1', '#dfb994'] as const
export const FAVORITE_COLOR = '#d5dfe9'
function mixColor(base: string, target: string, amount: number): string {
  return '#' + [1, 3, 5].map(at => Math.round(parseInt(base.slice(at, at + 2), 16) * (1 - amount) + parseInt(target.slice(at, at + 2), 16) * amount).toString(16).padStart(2, '0')).join('')
}
/** A finite palette bakes pale cores correctly in both Canvas and WebGL. */
export const STELLAR_PALETTE = [...new Set(STELLAR_BASE_COLORS.flatMap(base => [base, ...['#e88e72', '#6eace6'].flatMap(target => [.24, .48, .72].map(amount => mixColor(base, target, amount)))]))]
export function stellarMagnitude(bytes: number | undefined): number {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return .5
  return Math.max(0, Math.min(1, (Math.log2(Math.max(1024, bytes)) - 10) / 20))
}
/** Truncated Lorentzian; stable for a file, independent of library membership. */
export function stellarSaturation(seed: number, bytes: number | undefined): number {
  const safeBytes = bytes === undefined || !Number.isFinite(bytes) || bytes < 0 ? 1048576 : bytes
  let hash = (seed ^ Math.round(Math.log2(Math.max(1, safeBytes)) * 16777216)) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b); hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b)
  const u = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296, center = .08, width = .035
  const lo = Math.atan((.03 - center) / width), hi = Math.atan((.5 - center) / width)
  return center + width * Math.tan(lo + (hi - lo) * u)
}
export interface StellarAppearance { radiusScale: number; alpha: number; color: string; paletteIndex: number; objectType: StarType }
export function stellarAppearance(seed: number, bytes: number | undefined, favoriteType?: 'pulsar' | 'black-hole'): StellarAppearance {
  const unsignedSeed = seed >>> 0, magnitude = stellarMagnitude(bytes), tail = stellarSaturation(unsignedSeed, bytes)
  let color: string = STELLAR_BASE_COLORS[unsignedSeed % STELLAR_BASE_COLORS.length]
  if (magnitude >= .68 && tail >= .19) color = mixColor(color, unsignedSeed % 2 ? '#e88e72' : '#6eace6', Math.min(.72, Math.round((tail - .12) / .38 * 3) / 3 * .72))
  return { radiusScale: favoriteType ? 1.8 : .38 + 1.72 * magnitude ** 3.4, alpha: favoriteType ? 1 : .66 + .34 * magnitude ** 1.7, color: favoriteType ? FAVORITE_COLOR : color, paletteIndex: STELLAR_PALETTE.indexOf(color), objectType: favoriteType ?? 'main-sequence' }
}
export function stellarSeed(id: string): number {
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
  return seed >>> 0
}
export function fileStellarAppearance(file: { id: string; size?: number; isFavorite?: boolean; favoriteAppearance?: 'pulsar' | 'black-hole' }): StellarAppearance {
  return stellarAppearance(stellarSeed(file.id), file.size, file.isFavorite ? file.favoriteAppearance ?? 'pulsar' : undefined)
}
interface StellarPoint { lensColor?: string; id?: string; sizeBytes?: number; objectType?: StarType }
const pointAppearances = new WeakMap<StellarPoint, { id?: string; bytes?: number; type?: StarType; color?: string; value: StellarAppearance }>()
export function pointStellarAppearance(point: StellarPoint): StellarAppearance {
  const previous = pointAppearances.get(point)
  if (previous && previous.id === point.id && Object.is(previous.bytes, point.sizeBytes) && previous.type === point.objectType && previous.color === point.lensColor) return previous.value
  const value = stellarAppearance(stellarSeed(point.id ?? ''), point.sizeBytes, point.objectType === 'pulsar' || point.objectType === 'black-hole' ? point.objectType : undefined)
  if (point.lensColor) value.color = point.lensColor
  pointAppearances.set(point, { color: point.lensColor, id: point.id, bytes: point.sizeBytes, type: point.objectType, value })
  return value
}
