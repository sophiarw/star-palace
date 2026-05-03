// Deterministic per-star jitter so identical embeddings don't render on top
// of each other. Two files with the exact same embedding (the same content
// indexed under two galaxies, or near-duplicate text) project to the same
// PCA coordinates; without jitter they collapse to a single visual point.
//
// The offset is tiny (within JITTER_RADIUS world units, ≈6 at zoom 1, so
// invisible at fit-all but separable when zoomed in) and seeded purely on
// the file id, so the same star always lands at the same offset across
// retrains and daemon restarts.

const JITTER_RADIUS = 6  // world units

// FNV-1a 32-bit hash. Cheap, well-mixed enough for visual offsets.
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function jitterFor(id: string): [number, number] {
  const h = fnv1a(id)
  // Two independent uniforms from one hash via different mixes, so angle
  // and radius are not correlated.
  const u1 = ((h ^ 0x9E3779B1) >>> 0) / 0x100000000
  const u2 = (Math.imul(h, 0x85EBCA6B) >>> 0) / 0x100000000
  const angle = u1 * 2 * Math.PI
  // sqrt(uniform) → uniform sampling within a disk (no center clumping).
  const r = Math.sqrt(u2) * JITTER_RADIUS
  return [Math.cos(angle) * r, Math.sin(angle) * r]
}

export const JITTER_RADIUS_WORLD = JITTER_RADIUS
