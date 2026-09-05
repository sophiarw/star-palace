interface Target { x: number; y: number; radius: number; region?: unknown; cluster?: unknown }

/** CSS pixels: identical before/after hydration and independent of display density. */
export const starHitRadius = (artworkRadius: number): number => Math.max(24, artworkRadius * .6)

/** Pick the nearest star first; broad region targets must never steal its click. */
export function pickTarget<T extends Target>(targets: T[], x: number, y: number): T | null {
  let star: T | null = null, region: T | null = null, starDistance = Infinity, regionDistance = Infinity
  for (const target of targets) {
    const distance = Math.hypot(target.x - x, target.y - y)
    if (distance > target.radius) continue
    if (target.region || target.cluster) {
      if (distance < regionDistance) { region = target; regionDistance = distance }
    } else if (distance < starDistance) { star = target; starDistance = distance }
  }
  return star ?? region
}
