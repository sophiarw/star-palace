# Procedural Graphics — F8a MVP

## Context

REQUIREMENTS.md F8 (L484–574) frames the full procedural ambition: typed-star variation (F8a), default cluster-hue jitter (F8b), per-cluster procedural nebulae (F8c), and deep-zoom planet view (F8d). This plan covers **F8a only** as a minimal, incremental MVP. Goal: every typed star (pulsar, red giant, nebula, etc.) gets 2–3 hash-derived features so two files of the same type stop looking identical.

Today's reality, from `src/renderer/src/components/StarMap/sprites.ts`:
- `getTypedStarSprite(type, sizeBucket)` returns a sprite cached on `(type, sizeBucket)` only. Every red giant in size bucket 3 is byte-identical.
- `hashStr(id)` already exists and is FNV-1a 32-bit; deterministic seed source.
- 9 typed drawers (`drawRedGiant`, `drawBlueSupergiant`, `drawWhiteDwarf`, `drawNeutronStar`, `drawPulsarStatic`, `drawBinary`, `drawQuasarStatic`, `drawBlackHole`, `drawNebulaBlob`) — each takes `(ctx, cx, cy, r)` (and `sizeBucket` for blue supergiant).
- Two call sites in `StarMap.tsx:418` and `:423`. F8a needs `getTypedStarSprite` to also accept `starId`.

The visual grammar is already strong (multi-stop radial gradients, screen-blend spikes, additive ring on black hole). What's missing is identity-derived asymmetry: rotation, count, eccentricity, color jitter, internal feature placement.

**Out of scope (later work):**
- F8b default cluster-hue jitter (runtime rotate/alpha on bucket sprites).
- F8c procedural cluster nebulae (replaces flat hull gradients).
- F8d deep-zoom planet view.
- WebGL / shader path.
- Animated cloud bands or per-frame procedural variation.

---

## Architecture

### Foundation

New file `src/renderer/src/components/StarMap/proc.ts`:

```ts
// Mulberry32 PRNG seeded from FNV hash of star id.
export function seedFromId(id: string): () => number {
  let s = hashStr(id) >>> 0
  return () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Bounded LRU. cap=500 across all typed sprites.
export class LRUSpriteCache<K> {
  private map = new Map<K, HTMLCanvasElement>()
  constructor(public cap: number) {}
  get(k: K): HTMLCanvasElement | null {
    const v = this.map.get(k); if (!v) return null
    this.map.delete(k); this.map.set(k, v)  // refresh recency
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
  size(): number { return this.map.size }
  clear(): void { this.map.clear() }
}

// Convenience helpers:
export const rngRange = (rng: () => number, lo: number, hi: number) => lo + rng() * (hi - lo)
export const rngPick = <T,>(rng: () => number, arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]
```

### Sprite key

`getTypedStarSprite` becomes:
```ts
getTypedStarSprite(type: StarType, sizeBucket: number, starId: string): HTMLCanvasElement
```

Cache key: `type:T|s:S|h:HASH12` where `HASH12 = hashStr(starId) & 0xFFF` (4096 buckets per `(type, size)` pair).

Total upper bound: 9 types × 7 sizes × 4096 = 258k sprites. LRU cap of **500** keeps working set tiny; eviction acceptable because the same id always recomputes deterministically.

Memory budget: 500 sprites × ~50 KB avg canvas = ~25 MB. Within spec target (`<200 MB` renderer).

### Drawer signature change

Each `drawXxx` switches to:
```ts
function drawRedGiant(ctx, cx, cy, r, rng): void
```

`rng = seedFromId(starId)` — already advanced in caller. Each drawer pulls as many `rng()` values as it needs; PRNG state is local to one sprite render so order-of-call within a drawer must stay stable across edits (any reorder reseeds downstream features). Document this contract at the top of `proc.ts`.

---

## Per-type feature inventory

Each type gets **2–3 hash-driven features**. Visual technique noted; "cool factor" calls out the grammar trick that makes it pop.

### 1. Red giant — convection mottling + solar prominences
- **Mottling** (3 rng()): 8–14 brightness blobs (radial gradients, additive `screen` blend) overlaid on the disc. Positions in unit-disc via rejection sampling, sizes `0.15r–0.4r`. Looks like roiling plasma.
- **Prominences** (3–5 rng()): 2–4 arcing flares from the limb. Quadratic Bezier from `(r·cos θ, r·sin θ)` → control point `1.6r` outward → tip `1.2r` outward, drawn as additive orange-yellow gradient stroke with line-width tapering via segment subdivision.
- **Limb darkening** (no rng): thin dark ring at `r·1.0`. Constant — not hash-driven, but ships with this commit because it makes the disc look spherical instead of flat.

Cool factor: prominence arcs are the signature visual; nothing else in the sky has soft non-radial geometry.

### 2. Blue supergiant — spike count + halo eccentricity
- **Spike count** (1 rng()): pick from `{4, 6, 8}` weighted by rng (4 most common, 8 rarest).
- **Halo eccentricity** (2 rng()): squish factor `0.75–1.25`, tilt `0–π`. Apply via `ctx.scale + ctx.rotate` around centre before drawing the radial halo gradient. The diffraction spikes stay symmetric in angle but their global rotation matches the squish tilt.
- **Spike base angle** (1 rng()): rotate the whole spike pattern by `rng() * π/N` so two same-count instances don't align identically.

Cool factor: ellipsoidal halo + asymmetric spike rotation breaks the "sticker" feel.

### 3. White dwarf — corona wisps + size jitter
- **Corona wisps** (4 rng()): 4–7 thin radial wisps as faint white lines from `r·1.1` to `r·2.0`. Random angles. Suggests cosmic-ray emission.
- **Size jitter** (1 rng()): scale the disc by `0.9–1.1` so dwarves vary in apparent magnitude.

Cool factor: tiny but characterful — the wisps make it feel like a hot point source.

### 4. Neutron star — spike count + spike length + base angle
- **Spike count** (1 rng()): `{4, 6, 8}`.
- **Spike length** (1 rng()): `r·4 – r·7`.
- **Base angle** (1 rng()): `0 – π/N`.

Cool factor: variation in reach makes a constellation of neutron stars look like a real star field instead of a stamp pattern.

### 5. Pulsar — beam tilt + beam asymmetry + intensity ratio
- **Beam axis angle** (1 rng()): `0–π`.
- **Beam misalignment** (1 rng()): the two cones aren't always 180° apart; ±15° drift `rngRange(rng, -π/12, π/12)` on the second beam relative to the antipode.
- **Intensity ratio** (1 rng()): one beam `0.7–1.3` brightness vs the other.

Cool factor: imperfect symmetry of beams reads as physics, not decoration. Combined with the existing per-frame rotation animation (in StarMap), each pulsar has a unique strobe signature.

### 6. Binary — separation + size ratio + orbit angle
- **Separation** (1 rng()): `0.8r – 1.6r` between cores.
- **Size ratio** (1 rng()): `0.5 – 1.5` between the two cores.
- **Orbit axis angle** (1 rng()): rotate the line connecting them.

Cool factor: lopsided binaries with one giant + one dwarf companion read like Algol vs. Sirius.

### 7. Quasar — jet length asymmetry + accent hue + disc tilt
- **Jet asymmetry** (1 rng()): polar jets, one `1.5–3×` the other (Doppler-beaming illusion).
- **Accent hue jitter** (1 rng()): pick complementary accent in `{cyan, magenta, yellow}` for jet edge, applied as a second additive gradient on the jet.
- **Accretion disc tilt** (1 rng()): rotate the elliptical disc.

Cool factor: long asymmetric jet beats every other type for screen presence.

### 8. Black hole — ring tilt + ring asymmetry + photon-sphere thickness
- **Ring tilt angle** (1 rng()): tilt the accretion ring (Einstein-ring effect via two off-centre arcs that meet at the limb).
- **Ring brightness asymmetry** (1 rng()): one half of the ring `1.5×` brighter than the other (Doppler beaming).
- **Photon-sphere thickness** (1 rng()): inner-ring radius `0.92r – 1.0r`, ring width `0.4r – 0.6r`.

Cool factor: tilted asymmetric ring evokes Interstellar/EHT imagery instead of generic donut.

### 9. Nebula — bezier silhouette + hot spots + colour mix
- **Bezier silhouette** (8 rng()): 6 control points around an ellipse, each radius perturbed by `rngRange(rng, 0.6, 1.4)`. Stitched as smooth quadratic Bezier path. Filled with multi-stop alpha-falloff radial gradient clipped to that path.
- **Hot spots** (4 rng()): 2–3 inner bright cores (small radial gradients) at random sub-disc positions, additive blend.
- **Colour mix** (2 rng()): pick 2 of 3 base palette colours `[purple, blue, pink]`; jitter mix ratio. Avoid pure single-colour nebulae.

Cool factor: bezier silhouette is the only non-circular shape in the type set — biggest visual win.

---

## "Looks really cool" toolkit

Apply these grammar tricks across every drawer:

- **Multi-stop radial gradients** (4–6 stops, not 2). Already used; keep.
- **`globalCompositeOperation = 'screen'` or `'lighter'`** for additive light. Already used in spikes; extend to mottling and prominences.
- **Limb darkening**: thin dark ring at the disc edge for spherical solidity (red giant, white dwarf).
- **Complementary accent**: WARM core + COOL halo edge; gives chromatic depth, harder to read as cartoon.
- **Bezier curves** for non-circular silhouettes (nebula, prominences). Quadratic is enough.
- **Sub-pixel positioning** of small features (hot spots, mottling): use floats, not rounded ints.
- **Soft alpha falloff everywhere** — never a hard edge. Even spikes taper to 0 at endpoints.
- **Asymmetry default**: every drawer perturbs at least one parameter from rng. Perfect symmetry reads as fake.

---

## Incremental rollout

One commit per type. Each lands a regression baseline first, then the variation.

| # | Commit | Scope |
|---|---|---|
| 1 | `feat(renderer): proc.ts — seedFromId + LRUSpriteCache` | Foundation only. Existing drawers ignore rng. Tests on rng + cache. |
| 2 | `refactor(sprites): thread starId into getTypedStarSprite` | Signature change + cache key update + StarMap call-site updates. Drawers still ignore rng. Visual diff: zero. |
| 3 | `feat(sprites): red giant convection + prominences` | Drawer rewrite. Tests + visual review. |
| 4 | `feat(sprites): nebula bezier silhouette + hot spots` | Highest visual impact, ship early. |
| 5 | `feat(sprites): pulsar asymmetric beams` | |
| 6 | `feat(sprites): black hole tilted ring` | |
| 7 | `feat(sprites): blue supergiant + binary + quasar variants` | Bundle smaller-impact types. |
| 8 | `feat(sprites): white dwarf + neutron star variants` | Smallest types last. |
| 9 | `docs: mark F8a done in REQUIREMENTS, log limitations` | |

Each `feat(sprites)` commit ships:
- Drawer rewrite using `rng`.
- Updated regression hashes in `tests/renderer/sprites.test.ts`.
- Manual visual review screenshot attached in the commit body or PR description.

---

## Testing strategy

Three layers, fastest first.

### Layer 1 — pure RNG (fast, headless)
`tests/renderer/proc.test.ts`:
- `seedFromId(id)` deterministic: same id → identical sequence.
- Different ids → independent streams (no obvious correlation in first 100 values).
- `LRUSpriteCache` eviction order: insert N+1 with cap N, oldest gone.
- `LRUSpriteCache` get-refresh: get(k) moves k to MRU.

These run under vitest as pure JS. No DOM needed.

### Layer 2 — sprite hash regression (medium, requires canvas)
`tests/renderer/sprites.test.ts`:
- For a fixed table of `(type, sizeBucket, id)` triples, assert `canvas.toDataURL()` matches a stored snapshot.
- Use `node-canvas` shim if `vitest-canvas-mock` doesn't suffice. **Open question** — verify the project already supports this; if not, this layer becomes a Playwright-driven snapshot test on a `/dev/sprites` debug page (slower but real browser canvas).
- Snapshots are *not* committed; instead store SHA-256 of the dataURL in the test file. Bytewise canvas drift on different OS/font stacks would otherwise break CI.

### Layer 3 — manual visual review (slow, gated per commit)
`scripts/sprite-grid.html` (NEW): self-contained HTML page that renders 12 sample ids of each type at 3 sizes (small/med/large) in a grid. Open in a browser, eyeball for variety + coolness.

For each variation commit:
1. Open `sprite-grid.html` before the commit. Screenshot baseline.
2. Apply the commit. Reload. Screenshot.
3. Side-by-side compare. Confirm: 12 reds look like 12 different reds, not 12 identical reds.
4. Attach screenshot to commit body.

Don't gate CI on the visual pass — reviewer signs off manually.

---

## Files to touch

Create:
- `src/renderer/src/components/StarMap/proc.ts`
- `tests/renderer/proc.test.ts`
- `tests/renderer/sprites.test.ts`
- `scripts/sprite-grid.html`

Modify:
- `src/renderer/src/components/StarMap/sprites.ts` — extend `getTypedStarSprite` signature, switch each drawer to `(ctx, cx, cy, r, rng)`, swap cache to `LRUSpriteCache` for typed sprites only (default cluster-hue cache stays as-is for now).
- `src/renderer/src/components/StarMap/StarMap.tsx:418` — pass `star.id` to `getTypedStarSprite(effectiveType, sb, star.id)`.
- `REQUIREMENTS.md` — flip F8 row from blank to `**IN PROGRESS**` on commit 1, then `**DONE (F8a)**` on commit 9. Note remaining F8b/F8c/F8d work.

---

## Reuse — already exists

- `hashStr` (`sprites.ts:41`) — FNV-1a 32-bit; perfect seed source.
- `parseHex`, `blend`, `rgbCss` (`sprites.ts:20–39`) — colour helpers; reuse in drawers.
- `CONSTELLATION_PALETTE` (`@shared/types`) — palette source for nebula colour mix.
- Existing radial-gradient + screen-blend grammar — extend, don't replace.

---

## Cache budget verification

After commit 2, add a one-time console log at app startup:
```ts
console.log(`[sprites] LRU cap=${typedCache.cap}, est=${typedCache.cap * 50}KB`)
```
Confirms 500 entries × ~50 KB = 25 MB ceiling. Remove the log before merge.

---

## Known limitations (document in REQUIREMENTS at completion)

1. **Canvas2D only.** Per-frame redraws of cached sprites; no GPU compositing. Animation (pulsar rotation, quasar shimmer) stays in the existing per-frame layer over the cached static sprite.
2. **Same id forever.** No way to reroll a star's look. Out of scope per spec L490.
3. **PRNG-order coupling.** Reordering `rng()` calls inside a drawer reseeds all downstream features. Drawers must keep call order stable across edits or break visual continuity.
4. **Cache thrash on rapid zoom.** If user pans across many stars in a short window, LRU cap of 500 may evict + re-render. Acceptable for v1; bump cap to 1000 if profiling shows churn.

---

## Verification

Per commit:
```bash
npm run typecheck && npm run lint && npm run test
```

After each variant commit, additionally:
1. Open `scripts/sprite-grid.html` in a browser.
2. Confirm the grid for the touched type shows 12 visually distinct sprites at each of 3 sizes.
3. Smoke-test the live app with `dummy-corpus` indexed: zoom around at zoom 1.0 and 4.0; same type stars look varied.

Final commit: REQUIREMENTS.md update.
