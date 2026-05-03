// F4 — pure pin-math helpers shared by Relayouter (sign-flip detection) and
// the pin endpoint handlers (target-to-α/β solve). Renderer mirrors a subset
// of these in src/renderer/src/components/StarMap/pinMath.ts so we keep both
// sides drift-free.

const SIGN_FLIP_DOT_THRESHOLD = 0.9

// Compute the inner product between two equal-length vectors. Used for
// PCA-axis stability detection at retrain time.
export function dotVectors(a: number[] | Float32Array, b: number[] | Float32Array): number {
  const n = Math.min(a.length, b.length)
  let acc = 0
  for (let i = 0; i < n; i++) acc += a[i] * b[i]
  return acc
}

// Project an embedding onto a single PCA axis. `mean` is the column-mean
// vector that PCA centred its training data on; `axis` is the eigenvector
// for that PC. Returns the same value as StarPca.project / projectAll for
// the matching axis index.
export function projectOnAxis(
  embedding: Float32Array,
  axis: number[],
  mean: number[]
): number {
  const n = Math.min(embedding.length, axis.length, mean.length)
  let acc = 0
  for (let i = 0; i < n; i++) acc += axis[i] * (embedding[i] - mean[i])
  return acc
}

// Solve for the embedding-delta coefficients (α, β) given the user's chosen
// target PC-space coords and the file's natural projection on the same axes.
// PC eigenvectors are orthonormal so the solve is trivial.
export function solvePin(
  naturalPc: [number, number],
  targetPc: [number, number]
): { alpha: number; beta: number } {
  return {
    alpha: targetPc[0] - naturalPc[0],
    beta: targetPc[1] - naturalPc[1],
  }
}

// Build a "flips" array suitable for FileIndex.applyPinSignFlips.
//   +1: axis k is stable (or only minor noise)
//   -1: axis k flipped sign (need to negate any α/β tied to it)
//    0: axis k is unstable (e.g. eigenvalue swap with a neighbour); leave
//       offsets alone and log a warning at the call site
export function detectSignFlips(
  oldComponents: number[][],
  newComponents: number[][]
): number[] {
  const k = Math.min(oldComponents.length, newComponents.length)
  const flips: number[] = []
  for (let i = 0; i < k; i++) {
    const dot = dotVectors(oldComponents[i], newComponents[i])
    if (Math.abs(dot) < SIGN_FLIP_DOT_THRESHOLD) {
      flips.push(0)
    } else {
      flips.push(dot >= 0 ? 1 : -1)
    }
  }
  return flips
}

// Given a saved pin (α, β, axisA, axisB) and the *currently active* X/Y axes,
// compute the delta the renderer needs to add on each axis. PC eigenvectors
// are orthonormal so cross terms are zero; the offset only manifests when
// the active axis matches one of the saved axes.
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
