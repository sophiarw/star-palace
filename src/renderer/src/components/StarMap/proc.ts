/// <reference lib="dom" />
/**
 * F8a foundation — pure-JS procedural helpers shared across themes.
 *
 * Imported by every themed drawer (jwst/vapor/...). Each drawer is fed an
 * `rng = seedFromId(starId)` and pulls values in a fixed order; reordering
 * `rng()` calls inside a drawer reseeds all downstream features. Keep call
 * order stable across edits.
 *
 * Nothing here imports React or browser APIs other than HTMLCanvasElement
 * (used as a value type in LRUSpriteCache). The pure helpers (seedFromId,
 * hash2, smoothNoise2D, fbm2D, rngRange, pickN, mix, buildRamp) run under
 * vitest's node environment without a DOM shim.
 */

/* -------------------------------------------------------------------------- */
/* String hash                                                                */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a 32-bit string hash. Identical implementation to the one originally
 * defined in `sprites.ts` (kept stable: cache keys + theme prefix depend on
 * the exact byte output). Re-exported here so foundation helpers don't pull
 * a DOM-typed module into node-only tests.
 */
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/* -------------------------------------------------------------------------- */
/* PRNG                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mulberry32 PRNG seeded from FNV-1a hash of an id.
 * Same id → same stream forever; renames / content edits don't reroll because
 * the id is upstream of content.
 */
export function seedFromId(id: string): () => number {
  let s = hashStr(id) >>> 0
  return function rng(): number {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Convenience: uniform sample in `[lo, hi)`. */
export const rngRange = (rng: () => number, lo: number, hi: number): number =>
  lo + rng() * (hi - lo)

/** Convenience: uniform pick from a non-empty array. */
export const rngPick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]

/**
 * Fisher-Yates partial shuffle: returns a new array of `n` distinct picks.
 * Consumes exactly `min(n, arr.length)` rng() values.
 */
export function pickN<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const idxs = arr.map((_, i) => i)
  const take = Math.min(n, idxs.length)
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idxs.length - i))
    const tmp = idxs[i]
    idxs[i] = idxs[j]
    idxs[j] = tmp
  }
  return idxs.slice(0, take).map((i) => arr[i])
}

/* -------------------------------------------------------------------------- */
/* RGB helpers                                                                */
/* -------------------------------------------------------------------------- */

export type RGB = [number, number, number]

/** Linear blend of two RGB triples. t=0 → a, t=1 → b. */
export function mix(a: RGB, b: RGB, t = 0.5): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/* -------------------------------------------------------------------------- */
/* 2D value noise (used by FBM nebula)                                        */
/* -------------------------------------------------------------------------- */

/** Cheap integer hash; returns float in [0, 1). */
export function hash2(xi: number, yi: number, seed: number): number {
  let h = (xi | 0) ^ Math.imul(yi | 0, 0x27d4eb2d) ^ (seed | 0)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h = h ^ (h >>> 16)
  return ((h >>> 0) & 0xffffff) / 0x1000000
}

/** Bilinearly interpolated value noise with smoothstep on the fractionals. */
export function smoothNoise2D(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi,     yi,     seed)
  const b = hash2(xi + 1, yi,     seed)
  const c = hash2(xi,     yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/**
 * Fractional Brownian Motion. Sums `octaves` of value noise at successive
 * frequencies (× lacunarity each step) with shrinking amplitude (× gain).
 * Output normalised to `[0, 1]`.
 */
export function fbm2D(
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
  seed: number,
): number {
  let amp = 1
  let freq = 1
  let sum = 0
  let total = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * smoothNoise2D(x * freq, y * freq, seed + i * 1013)
    total += amp
    amp *= gain
    freq *= lacunarity
  }
  return sum / total
}

/* -------------------------------------------------------------------------- */
/* Colour ramp                                                                */
/* -------------------------------------------------------------------------- */

export interface RampStop {
  d: number
  rgba: [number, number, number, number]
}

/**
 * Build a piecewise-linear colour ramp from sorted `{d, rgba}` stops.
 * Returns `(density) → [r, g, b, a]` with each channel 0..255.
 * Density values outside `[0, 1]` are clamped to the nearest stop.
 */
export function buildRamp(stops: readonly RampStop[]): (d: number) => [number, number, number, number] {
  const s = stops.slice().sort((p, q) => p.d - q.d)
  return (d: number): [number, number, number, number] => {
    if (d <= s[0].d) return [...s[0].rgba] as [number, number, number, number]
    const last = s[s.length - 1]
    if (d >= last.d) return [...last.rgba] as [number, number, number, number]
    for (let i = 0; i < s.length - 1; i++) {
      const lo = s[i]
      const hi = s[i + 1]
      if (d <= hi.d) {
        const t = (d - lo.d) / (hi.d - lo.d || 1)
        return [
          lo.rgba[0] + (hi.rgba[0] - lo.rgba[0]) * t,
          lo.rgba[1] + (hi.rgba[1] - lo.rgba[1]) * t,
          lo.rgba[2] + (hi.rgba[2] - lo.rgba[2]) * t,
          lo.rgba[3] + (hi.rgba[3] - lo.rgba[3]) * t,
        ]
      }
    }
    return [...last.rgba] as [number, number, number, number]
  }
}

/* -------------------------------------------------------------------------- */
/* Circular fade mask                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Soft circular alpha fade applied with `destination-in`. Every drawer ends
 * with this so the square sprite canvas reads as a round glowing object.
 * `innerStop` controls how much of the disc is held at full alpha before
 * the fade kicks in (higher = more interior brightness, sharper edge).
 */
export function applyCircularFade(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  half: number,
  innerStop = 0.85,
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-in'
  const mask = ctx.createRadialGradient(cx, cy, 0, cx, cy, half)
  mask.addColorStop(0, 'rgba(0,0,0,1)')
  mask.addColorStop(innerStop, 'rgba(0,0,0,1)')
  mask.addColorStop(Math.min(0.999, innerStop + (1 - innerStop) * 0.8), 'rgba(0,0,0,0.3)')
  mask.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = mask
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  ctx.restore()
}

/* -------------------------------------------------------------------------- */
/* LRU sprite cache                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Bounded least-recently-used cache for canvas sprites. `get()` refreshes
 * the entry's recency. `set()` evicts oldest entries past `cap`.
 *
 * Per F8a plan: cap=500 across all typed sprites. Theme prefix on the key
 * means switching themes does not evict the previous theme's entries until
 * they age out by churn — flipping back and forth is essentially free.
 */
export class LRUSpriteCache<K> {
  private readonly map = new Map<K, HTMLCanvasElement>()
  constructor(public cap: number) {}
  get(k: K): HTMLCanvasElement | null {
    const v = this.map.get(k)
    if (!v) return null
    this.map.delete(k)
    this.map.set(k, v)
    return v
  }
  set(k: K, v: HTMLCanvasElement): void {
    if (this.map.has(k)) this.map.delete(k)
    this.map.set(k, v)
    while (this.map.size > this.cap) {
      const first = this.map.keys().next().value
      if (first === undefined) break
      this.map.delete(first)
    }
  }
  size(): number {
    return this.map.size
  }
  clear(): void {
    this.map.clear()
  }
  /** Visible-for-tests: ordered key iterator (oldest first). */
  keys(): IterableIterator<K> {
    return this.map.keys()
  }
}
