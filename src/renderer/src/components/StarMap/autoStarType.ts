export { defaultStarType } from '@shared/celestial'

// Human-readable label describing why a default was applied, for use in the UI.
export function defaultStarTypeReason(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return ext.length > 1 ? ext : 'file type'
}
