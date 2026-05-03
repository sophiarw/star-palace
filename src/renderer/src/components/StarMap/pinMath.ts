// F4 — renderer-side pin helpers. Mirrors src/daemon/math/pinMath.ts so we
// don't have to round-trip the daemon for every PC-dial offset application.
// Keep the two in sync; both are pure and trivially unit-tested.

// Apply a saved (α, β) pin to a single file's natural PC projection. Only
// active axes that match the saved axes pick up the offset; PC eigenvectors
// are orthonormal so cross terms collapse to zero (REQUIREMENTS.md L148-175).
export function applyPinOffset(
  pinAlpha: number,
  pinBeta: number,
  pinAxisA: number,
  pinAxisB: number,
  activeAxisX: number,
  activeAxisY: number
): { dx: number; dy: number } {
  let dx = 0
  let dy = 0
  if (activeAxisX === pinAxisA) dx += pinAlpha
  if (activeAxisX === pinAxisB) dx += pinBeta
  if (activeAxisY === pinAxisA) dy += pinAlpha
  if (activeAxisY === pinAxisB) dy += pinBeta
  return { dx, dy }
}

// Inverse of (raw - min) * scale - SCALE_RANGE/2 used in usePcDial. Given a
// world-space coord that the user dragged a star to, recover the matching
// raw PC coordinate so the daemon can solve the embedding delta.
export function worldToPc(world: number, min: number, scale: number, scaleRange: number): number {
  // world = (raw - min) * scale - scaleRange/2
  // → raw = (world + scaleRange/2) / scale + min
  if (scale === 0) return min
  return (world + scaleRange / 2) / scale + min
}
