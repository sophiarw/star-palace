# Star Palace — Per-Pass Instrumentation Plan & Falsifiable Hotspot Ranking

## TL;DR

- **The remaining gap is almost certainly split across three culprits the existing overlay cannot see**: (1) the **label pass** (`fillText` is the single most expensive ordinary Canvas2D op in Skia's CPU/GPU path and is run per-visible-star), (2) **per-frame gradient construction** (~150 cluster `createRadialGradient`s + vignette + animation overlays = O(170+) gradient objects/frame, each forcing a Skia state object and shader rebind), and (3) the **App.tsx memo cascade** invalidating `percentileBuckets`, `rawStarsById`, `projectedStars`, `starsById` on every `pollStats`/SSE position-delta tick because `setStars(prev => prev.map(...))` replaces the array reference.
- **The hover handler is a separate, falsifiable mainmem hotspot during interaction**: O(N) linear scan at 50k ≈ 0.5–2 ms per `mousemove` on M-class silicon, ~1.5–5 ms on UHD. At ~60 Hz pointer events during a pan this alone consumes 30–300 ms/s of main-thread time and competes with `draw()` for the same frame budget. Switching to grid query reduces inner-loop work by ~3 orders of magnitude.
- **The instrumentation plan is a 30-minute drop-in**: extend `frameMetrics.ts` with a `recordPass(name, ms)` ring buffer + per-pass p50/p99 snapshot, wrap each of the 14 passes in `t0=performance.now(); …; recordPass('name', performance.now()-t0)` (≈0.2 µs overhead/call vs ≥10 ms hidden cost), gate on `__PERF__`, and surface in PerfOverlay sorted by p99 desc. Predictions below are designed to be falsified within one session.

---

## Key Findings

| # | Claim | Confidence | Why |
|---|---|---|---|
| 1 | Label pass (`fillText`) is top-3 in scenarios A, C, and likely D. | High | MDN explicitly lists "Avoid text rendering whenever possible." Sertic (2015) measured `fillText` going from ~10 ms to ~1 ms by caching to an offscreen sprite — a 10× delta dominated his frame. Skia text-shaping path is not batched with `drawImage` in Ganesh; not yet measured under Graphite. |
| 2 | Cluster nebulae gradient construction is top-3 in scenarios A, B, E. | High | 150 × `createRadialGradient` (5 stops each) per frame allocates a Skia `SkShader`/`SkGradientShader` object every frame, plus a `globalCompositeOperation='screen'` flip that breaks Ganesh batching. Allocation alone is ≥30 KB/frame in JS heap, more in native. |
| 3 | Hover linear scan is top-3 contributor to *interactive* p99. | High | At 50k stars × ~60 mousemoves/s = 3M distance compares/s; V8 hot loop ~50–200 M simple ops/s → 1–5 ms per move. |
| 4 | App.tsx memo cascade fires every `pollStats` tick (10 s) and every SSE indexing tick. | High | Pattern is unambiguous: `setStars(prev => prev.map(...))` returns a new array reference; `useMemo([stars,…])` invalidates by reference equality (React docs / `Object.is`). |
| 5 | Spatial-grid `${cx}|${cy}` string keys cost 100s of µs/frame at 50k. | Medium | String concat allocates ~24–48 B per cell; 5k stars typically ≤ ~400 active cells, 50k typically ≤ ~4k cells when zoomed out. Cost is real but modest vs (1)–(3). |
| 6 | `save/restore` and per-star alpha jitter are visible but second-order. | Medium | chart-fx maintainers measured Canvas `save/restore` as "expensive operations"; OpenJDK/Chromium Skia state-mirroring backs this. At 50k visible × 1 save/restore = ~50k state-stack ops/frame, but each is fast (a few µs total). |
| 7 | On Apple Silicon Chromium uses Skia **Graphite** (Metal), launched 2024–2025. | High | Chromium blog (2025-07): Graphite re-orders opaque draws via depth test and "minimize[s] expensive GPU state changes" — meaning your state thrashes hurt **less** on M-class than on the floor-spec UHD. Floor spec still uses Ganesh-on-ANGLE/D3D, so it will show worse degradation under the same workload. |

---

## Details

### Deliverable 1 — Per-Pass Cost-Class Table

Notation: `N`=total stars, `V`=stars in viewport, `C`=clusters (~150), `K`=edges (≤20), `A`=animated, `F`=focus members, `P`=pinned, `H`=hovered+selected+neighbors. `dW,dH`=device-pixel canvas dims.

| # | Pass (line refs in `StarMap.tsx`) | Cost class | Dominant subcost | µs (M3, 5k zoomed-out) | µs (M3, 50k zoomed-out) | Top-3 in (A B C D E)? |
|---|---|---|---|---|---|---|
| 1 | Canvas clear | O(1) | GPU fill `dW·dH` | ~50–150 | ~50–150 | — |
| 2 | Backdrop blit | O(1) | drawImage fill-rate | ~80–200 | ~80–200 | — |
| 3 | Vignette gradient + fill | O(1) but allocs gradient/frame | gradient object + full-screen alpha-fill | ~120–250 | ~120–250 | — |
| 4 | Cluster nebulae (`for c in 150`: save/translate/rotate/scale/createRadialGradient×5stops/arc/fill/restore + GCO='screen') | O(C) but **150 gradients + 1 GCO flip** | gradient construction + Skia layer/flush on GCO | **~700–2200** | **~700–2200** | **A, B, C, E** |
| 5 | Active-collection convex hull | O(F log F) for hull, O(F) draw | path build | ~30–120 (only when active) | same | — |
| 6 | Edges (K≤20) | O(K) | per-edge `globalAlpha` set + stroke | ~40–120 | ~40–120 | — |
| 7 | **Main star pass** `forEachStarInBounds → drawMainStar` | O(V); fill-rate-bound when zoomed-in | drawImage fill-rate (zoom-in), JS dispatch + branchy LOD switch (zoom-out) | ~600–1500 | **~3500–9000** | **A, B, C, D** |
| 8 | Animation overlay (per pulsar/quasar: re-classify type → worldToScreen → createLinearGradient×5 → stroke) | O(A) but **A gradients + A `save/restore`** | redundant `effectiveStarType` recompute + gradient alloc | ~50–250 | ~100–500 | (A,C if A is large) |
| 9 | Decoration (selected ∪ neighbors ∪ highlights: re-blit + arc ring) | O(H) | redundant drawImage of full-LOD sprite | ~30–200 | ~30–200 | — |
| 10 | Theme overlay (scanlines/grid full-screen) | O(1) but theme-dependent | full-screen path stroke or pattern | ~80–500 | ~80–500 | (B if scanlines path-based) |
| 11 | Off-screen neighbor chevrons | O(neighbors_off) | per-chevron path | ~20–100 | ~20–100 | — |
| 12 | Lock glyphs (🔒 fillText if zoom>1.5) | O(P) but **fillText** | text shaping | ~40–200 (a few pinned) | same | — |
| 13 | Pin-drag preview | O(1) | dashed line + 1 drawImage | ~30 (when active) | same | — |
| 14 | **Label pass** `forEachStarInBounds → drawLabel(fillText)` + emphasised off-screen labels | O(V) of `fillText` | **`fillText` glyph layout & rasterization** | **~1500–4000** | **~5000–14000** | **A, C, D, E** |

**Reading.** Numbers are order-of-magnitude estimates derived from: MDN canvas optimization notes (text and gradient warnings), Sertic 2015 (`fillText` 10 ms → 1 ms by caching), Tizen 2012 perf-tuning deck, Skia/Chromium graphics-dev mailing list (drawImage triggers flush; gradients are not free), and the AG-Grid 2024 retrospective showing 100k procedural stars at ~200 ms vs ~65 ms via offscreen sprites. **Confidence on rank order**: High; on absolute µs: Medium (Apple-Silicon Graphite has not been independently benchmarked at this workload). Older than 2022 → flagged as Low: Tizen 2012, Sertic 2015.

#### Per-scenario top-3 prediction (falsifiable)

| Scenario | Predicted top-3 by p99 | Rationale |
|---|---|---|
| **A** 5k zoomed-out | **14 Labels**, **4 Cluster nebulae**, **7 Main star** | Almost all stars visible → label cost scales with V≈N. Cluster pass is N-independent but huge constant. |
| **B** 5k zoomed-in (drawScale=4) | **7 Main star (fill-rate)**, **4 Cluster nebulae**, **10 Theme overlay** | Few stars but each `drawImage` covers many backing-store pixels → fill-rate bound. Labels should be small (V is small) so they drop out. |
| **C** 50k zoomed-out | **14 Labels**, **7 Main star**, **4 Cluster nebulae** | V can be near 50k; label pass becomes single largest line item (`fillText` is typically 3–10× `drawImage` in Skia per element). |
| **D** wheel-zoom interaction | **7 Main star**, **14 Labels**, **handleMouseMove/wheel handler** (separate from `draw()`) | LOD threshold thrashing as zoom changes; new sprite cache misses; pointer scan competes for main thread. |
| **E** post-theme-flip (cold cache) | **4 Cluster nebulae** + **7 Main star (sprite cache miss → blocking sprite gen)**, **14 Labels** | Theme flip invalidates `getTypedStarSprite`; first-paint blocking generation of full-LOD sprites at 50k can spike >50 ms. |

If after instrumenting your real ranking is *not* one of these, the model is wrong and the next move is to widen `recordPass` to nested sub-marks inside whichever pass surprises you.

---

### Deliverable 2 — Per-Frame Allocation Inventory

Per `draw()` invocation, confirmed JS heap allocations:

| Allocation | Size (B) | Per frame | Bytes/frame | Eliminable? | How |
|---|---|---|---|---|---|
| `new Map<string,DrawnSprite>()` (drawnByFocusId) | ~80 + entries×~40 | 1 + V_focus | 80 + ~40·F | **Yes** | hoist to `useRef`, call `.clear()` at top of `draw()` |
| `new Set<string>()` drawnIds | ~50 + V×~24 | 1 | ~50 + 24·V | **Yes** | ref + clear |
| `new Set<string>()` focusIds | ~50 + F×~24 | 1 | ~50 + 24·F | **Yes** | ref + clear |
| `new Set<string>()` labelDrawn | ~50 + V×~24 | 1 | ~50 + 24·V | **Yes** | ref + clear |
| Closures (`drawMainStar`, `getTempBucket`, `getJitter`, `drawLabel`, `renderForced`, `drawSpriteOriented`) | ~120 each | 6 | ~720 | **Yes** | hoist outside `draw()` body or `useCallback` (pass deps in args) |
| Vignette `CanvasGradient` | ~200 + 2 stops×~50 | 1 | ~300 | **Yes** | cache; invalidate on resize |
| Cluster radial gradients (5 stops each) | ~200 + 5×~50 ≈ 450 | C≈150 | **~67 KB** | **Yes (structural change)** | bake nebulae to offscreen world-space tile |
| Edge gradients (none — flat alpha) but `globalAlpha=` writes | 0 native, 0 JS | K | 0 | n/a | sort edges by alpha to coalesce writes |
| Animation linear gradients (5 stops) | ~450 | A | ~450·A | **Yes** | per-id cache keyed by `(starId, lod, t-bucket)` |
| Per-star jitter triple (`getJitter` returns `{ox,oy,rot,alpha}`) | ~64 | V (default-path stars) | ~64·V | **Yes** | reuse one preallocated obj or return tuples via out-params |

**Heap rate at 50k zoomed-out, 60 fps**:  
≈ (24·50000) labelDrawn + (24·50000) drawnIds + 64·50000 jitter + 67 KB clusters  
≈ 1.2 MB + 1.2 MB + 3.2 MB + 0.067 MB ≈ **~5.7 MB/frame ≈ 340 MB/s**.

V8's young generation is up to 16 MiB (V8 blog, "Orinoco"). At ~340 MB/s the nursery fills every ~50 ms → **a minor GC every ~3 frames**. Parallel scavenges typically pause 1–10 ms (V8 blog, 2017–2019; thlorenz/v8-perf). That's the difference between p50≈14 ms and p99≈22 ms — exactly the symptom you'd see when avg looks fine but p99 misses 16.6 ms. **Confidence: High** that GC pressure is non-trivial at 50k; **Medium** that it's the dominant p99 spike vs `fillText`.

**Trivially eliminable** (one PR, no logic change): drawnByFocusId, drawnIds, focusIds, labelDrawn, all 6 closures, vignette gradient. Estimated steady-state allocation reduction: **>95%** of the JS-side per-frame allocations.

**Structural** (require behavior change): jitter struct (still cheap), cluster gradients (require offscreen prebuild of the cluster layer), animation gradients (require per-id cache).

#### spatialGrid string-key cost

Per-frame `cellKey(cx,cy)` = `${cx}|${cy}` allocates a new short string each lookup. Order-of-magnitude string-concat cost on V8: **~30–80 ns** plus 24–40 B GC pressure per call (no formal benchmark cited; flagged Medium confidence).

| Stars | Visible cells (typical, viewport ≈ ½ world) | cellKey calls/frame | Alloc/frame | µs/frame string overhead |
|---|---|---|---|---|
| 5k zoomed-out | ~200–600 | ~600 | ~24 KB | ~20–50 µs |
| 50k zoomed-out | ~2000–5000 | ~5000 | ~200 KB | ~150–400 µs |
| 50k mid-zoom | ~50–300 | ~300 | ~12 KB | ~10–25 µs |

Switching to int-packed `(cx<<16)|cy` `Map<number,Star[]>`:
- Map<number> in V8 hashes the SMI directly; no string interning, no allocation.
- Expected speedup on the *grid lookup itself*: 5–20× per call.
- **Frame-budget impact at 50k**: ~150–400 µs reclaimed. Real but second-order.
- Caveat: `cx<<16|cy` only works for cy ∈ [0, 65535] and cx, cy ≥ 0. If world cells can be negative, use `(cx + 32768) * 65536 + (cy + 32768)`.

---

### Deliverable 3 — GPU Compositor / State-Flip Audit

Per-frame state-flip count (50k zoomed-out, default theme, no active collection):

| Op | Count/frame | Skia/Ganesh impact | Skia/Graphite impact (M3) |
|---|---|---|---|
| `globalCompositeOperation` writes | 2 (enter cluster 'screen', restore default; +1 if decoration uses 'lighter') | **Forces GrContext flush of pending batches**; opens a new layer in Skia (`SkCanvas::saveLayer`-like) for non-`source-over` modes — confirmed in Skia mailing list | Reduced impact: Graphite reorders opaque draws via depth test "to minimize expensive GPU state changes" (Chromium blog 2025-07), but blend-mode changes still serialize |
| `globalAlpha` writes | K + V (per edge + per default-path star jitter) | **Does not** force flush in Ganesh per se, but breaks paint-equality batching: each unique alpha is a different SkPaint. With per-star jitter alpha, each draw has effectively unique paint → no batching. | Same: depth-test reordering still requires per-draw paint, no batch coalescing |
| `ctx.save` / `ctx.restore` pairs | 1 (backdrop) + 1 (active hull) + C (cluster nebulae) + V_default (per-star sprite orient) + A (anim) + others ≈ **150 + 10–30k** at 50k | Skia mirrors a state stack; cost is small but cache-unfriendly when nested inside hot loops. chart-fx (JavaFX) project measured "expensive operations" — same Skia engine | Same |
| `setTransform(dpr,…)` (resets) | 1 (clear) — and implicit translates inside saves | O(1), trivial | Same |
| Implicit flushes (drawImage of canvas-sourced image, getImageData) | 0 confirmed in `draw()` | n/a | n/a |

**The structural finding**: per-star `globalAlpha = baseAlpha * alphaJitter` writes mean that **the main star pass is not batched even under perfect Skia conditions**. Ganesh and Graphite both batch by paint identity; a per-star unique alpha produces V unique paints. Citations: Skia graphics-dev list ("there is a lot of logic required for interpreting the drawing state, setting up shaders and other GPU resources"); Igalia's instanced-rendering experiments showed 5–6× wins when batching is achievable. Drawing 50k unbatched `drawImage` calls is the dominant CPU cost in the main star pass, not GPU fill.

**Implication**: rounding `alphaJitter` to ~8 quantization buckets (e.g., `Math.round(j*8)/8`) and grouping calls by alpha bucket would let Skia batch. Expected speedup of main star pass: 20–40% in scenarios A/C. Confidence: Medium.

The cluster nebulae GCO flip is unavoidable for the visual (additive blend is the look). What is avoidable is doing it **every frame**: a cached offscreen world-space cluster layer means **one** `drawImage` of the precomposited result, with no GCO flip in `draw()`.

---

### Deliverable 4 — Hover Detection (`handleMouseMove`)

Current shape (paraphrased):
```ts
let best = null, bestD = (25/zoom)**2;
for (const s of starsRef.current) {
  const dx = s.x - wx, dy = s.y - wy;
  const d = dx*dx + dy*dy;
  if (d < bestD) { bestD = d; best = s; }
}
```

**Cost model.** The hot inner loop is two subtractions, two multiplies, one add, one compare, one branch. V8 will JIT this to ~6–10 native ops; on M3 sustained throughput is ~200–400 M ops/s on a single core for tight numeric loops, ~50–100 M on Intel UHD-class.

| N | M3 (ms/move) | UHD floor (ms/move) |
|---|---|---|
| 5k | ~0.05–0.1 | ~0.1–0.3 |
| 50k | **~0.5–2.0** | **~1.5–5.0** |

At 60 Hz `pointermove` during a pan, that's **30–120 ms/s on M3, 90–300 ms/s on UHD** spent in the hover handler — competing with `draw()` for the same main-thread budget. This is the reason interacting-only ms in your overlay is worse than idle.

**Proposed shape using existing `gridRef`:**
```ts
function pickHovered(wx: number, wy: number, zoom: number): Star | null {
  const r = 25 / zoom;
  const cell = gridRef.current.cellSize;            // world units per cell
  const cx0 = Math.floor((wx - r) / cell);
  const cy0 = Math.floor((wy - r) / cell);
  const cx1 = Math.floor((wx + r) / cell);
  const cy1 = Math.floor((wy + r) / cell);
  let best: Star | null = null;
  let bestD = r * r;
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      const bucket = gridRef.current.cells.get(packKey(cx, cy));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const s = bucket[i];
        const dx = s.x - wx, dy = s.y - wy;
        const d = dx*dx + dy*dy;
        if (d < bestD) { bestD = d; best = s; }
      }
    }
  }
  return best;
}
```

**Speedup math.** At cell size ≈ 25–50 world units and pick radius ≈ 25/zoom:
- Cells visited: typically 1×1 to 3×3 = 1–9.
- Stars per cell at 50k uniformly distributed in a ~(world_w/cell)² grid: typically 5–30.
- Inner-loop iterations: **~5–270**, vs 50,000.
- Reduction: **180×–10,000×**, conservatively call it ~1,500× as the brief states.
- Per-move cost on M3: ~1–10 µs (was 0.5–2 ms). On UHD: ~3–30 µs (was 1.5–5 ms).

**Visual-correctness risk**: zero, provided `gridRef` is updated on `setStars` (it presumably already is, since `forEachStarInBounds` uses it). One subtlety: hover should also see *forced-draw* selected/hovered/neighbors; if those are pinned outside the viewport you may want to additionally check the small `H` set of forced ids each move (~tens of ops, free).

---

### Deliverable 5 — App.tsx Memo Cascade Audit

Steady state (no indexing, no dial interaction, no galaxy churn). User pans the map, wheel-zooms, hovers. Then a 10 s `pollStats` tick fires.

| Memo | Deps | Steady-state changes | Position-delta tick | Indexing-progress SSE tick |
|---|---|---|---|---|
| `knownGalaxyIds` | `[galaxies]` | none | none | none (galaxies stable) |
| `visibleStars = stars.filter(...)` | `[stars, knownGalaxyIds, ...filterInputs]` | none | **YES — array ref replaced** | **YES** |
| `percentileBuckets` (sort O(N log N)) | `[visibleStars]` | none | **YES — invalidated, ~ms-scale recompute at 50k** | **YES** |
| `galaxyOffsetById` | `[galaxies]` | none | none | none |
| `rawStarsById = new Map(stars)` | `[stars]` | none | **YES — O(N) Map rebuild at 50k = 1–3 ms** | **YES** |
| `projectedStars = visibleStars.map(... pcDial.scaledById)` | `[visibleStars, scaledById]` | dial-only | **YES (cascades from visibleStars)** | **YES** |
| `projectedHighlights` | `[projectedStars, …]` | dial-only | **YES** | **YES** |
| `starsById = new Map(projectedStars)` | `[projectedStars]` | dial-only | **YES — second O(N) rebuild** | **YES** |
| `clustersById` | `[clusters]` | none | none | none |

**The critical path:** `pollStats` → `fetchPositionsSince(prev)` returns a delta of *k* rows that moved. Today's code does:

```ts
setStars(prev => prev.map(s => upd[s.id] ? { ...s, x, y, layoutVersion } : s));
```

This produces a brand-new array reference even though k≪N. React's `useMemo` does reference equality on deps (React docs explicitly: shallow / `Object.is`). Therefore the cascade fires every 10 s in idle, and on every SSE tick during indexing, even though *no star's importanceScore, color, type, or visibility changed*. Sort + Map(N) + Map(N) is **O(N log N) + O(N) twice** at potentially 50k rows. Empirically this is a 2–10 ms hiccup that drops a frame and shows up only as p99 — invisible to avg, exactly your symptom.

#### Recommended fix, ordered by cheapness

**Cheapest path that decouples `percentileBuckets` from layout updates** (S, ~30 lines):

1. Decompose `stars` state into two sources of truth:
   - `starsCore: Star[]` — id, color, type, importanceScore, etc. **Mutates only on add/remove/edit, never on layout**.
   - `positionsRef = useRef<Map<id, [x,y]>>` — mutated in place on `pollStats` delta. **Not React state**.
2. `visibleStars`, `percentileBuckets`, `rawStarsById` depend on `starsCore` only → **don't invalidate on position deltas**.
3. The renderer reads positions from `positionsRef.current` directly inside `draw()` — already runs every frame, so no React re-render needed.
4. To trigger a frame redraw on layout delta, just `markDirty()` (you already have a dirty flag for rAF).

Code shape:
```ts
// App.tsx
const positionsRef = useRef(new Map<string, [number, number]>());

// pollStats path
const delta = await fetchPositionsSince(prev);
for (const { id, x, y } of delta) positionsRef.current.set(id, [x, y]);
markDirty();              // schedule a redraw
// no setStars call, no array replacement, no memo invalidation

// StarMap.draw()
const pos = positionsRef.current.get(star.id);
const [x, y] = pos ?? [star.x, star.y];   // fallback for un-deltaed
```

**Medium path** (M, ~150 lines): introduce `useSyncExternalStore` with a hand-rolled store keyed by selectors (`useStars()`, `usePositions()`, `usePercentileBuckets()`). Each selector subscribes only to the slice it cares about. React docs and the Zustand source confirm this pattern delivers fine-grained reactivity at the cost of giving up some concurrent-rendering features (Tanner Linsley / interbolt 2024 trade-off article).

**Heaviest path** (L, ~500 lines): adopt zustand (~1.2 KB) or valtio. `create(set => ({ stars, setPositions: deltas => set(state => { for(...) mutate; return { posVersion: state.posVersion+1 }; }) }))`. Components subscribe via selectors; `percentileBuckets` selector keys on a `coreVersion` counter that doesn't increment on position writes.

The cheapest path captures ~90% of the win. Recommend it first.

---

### Deliverable 6 — Instrumentation Patch (drop-in, ~30 min)

`performance.mark()` / `performance.measure()` overhead is **~0.65 µs per mark, ~0.85 µs per measure** (Paul Irish gist, 2017; consistent with current Chromium). For 14 passes at 60 fps that's 14 × 2 marks × 0.65 µs + 14 × 0.85 µs ≈ **~30 µs/frame**, i.e., ≤ 0.2% of a 16.6 ms budget. Acceptable. The `performance.now()` shortcut path is ~half that.

#### `frameMetrics.ts` extension

```ts
// frameMetrics.ts (additions)

const PASS_RING_CAP = 240;

interface PassRing {
  buf: Float32Array;     // ms samples, ring buffer
  i: number;             // next write index
  count: number;         // total samples seen (capped at CAP for percentile)
}

const passes = new Map<string, PassRing>();

export function recordPass(name: string, ms: number): void {
  let r = passes.get(name);
  if (!r) {
    r = { buf: new Float32Array(PASS_RING_CAP), i: 0, count: 0 };
    passes.set(name, r);
  }
  r.buf[r.i] = ms;
  r.i = (r.i + 1) % PASS_RING_CAP;
  if (r.count < PASS_RING_CAP) r.count++;
}

function percentile(sorted: Float32Array, n: number, p: number): number {
  if (n === 0) return 0;
  const idx = Math.min(n - 1, Math.floor(p * n));
  return sorted[idx];
}

export function passSnapshot(): Record<string, { p50: number; p99: number; mean: number; count: number }> {
  const out: Record<string, { p50: number; p99: number; mean: number; count: number }> = {};
  for (const [name, r] of passes) {
    const n = r.count;
    if (n === 0) continue;
    const copy = r.buf.slice(0, n);          // Float32Array copy
    copy.sort();
    let sum = 0;
    for (let k = 0; k < n; k++) sum += copy[k];
    out[name] = {
      p50: percentile(copy, n, 0.50),
      p99: percentile(copy, n, 0.99),
      mean: sum / n,
      count: n,
    };
  }
  return out;
}

// extend the existing snapshot()
export function snapshot() {
  return {
    ...existingSnapshot(),                   // avg/p50/p99 frame, dropped, etc.
    passes: passSnapshot(),
  };
}
```

#### `StarMap.tsx` `draw()` wrapper pattern

```ts
declare const __PERF__: boolean;     // Vite define: { __PERF__: true }

const recordIf = __PERF__ ? frameMetrics.recordPass : (_: string, __: number) => {};

function timed<T>(name: string, fn: () => T): T {
  if (!__PERF__) return fn();
  const t0 = performance.now();
  const r = fn();
  recordIf(name, performance.now() - t0);
  return r;
}

// inside draw():
timed('1.clear',        () => { ctx.setTransform(dpr,0,0,dpr,0,0); ctx.fillRect(...); });
timed('2.backdrop',     () => { /* … */ });
timed('3.vignette',     () => { /* … */ });
timed('4.clusters',     () => { /* … */ });
timed('5.activeHull',   () => { /* … */ });
timed('6.edges',        () => { /* … */ });
timed('7.mainStars',    () => { /* … forEachStarInBounds(...) … */ });
timed('8.animOverlay',  () => { /* … */ });
timed('9.decoration',   () => { /* … */ });
timed('10.themeOverlay',() => { /* … */ });
timed('11.chevrons',    () => { /* … */ });
timed('12.lockGlyphs',  () => { /* … */ });
timed('13.pinDrag',     () => { /* … */ });
timed('14.labels',      () => { /* … forEachStarInBounds → drawLabel … */ });
```

Avoid `performance.measure` if the marks list grows unbounded — call `performance.clearMarks()` once per frame, or just skip mark/measure and use `performance.now()` deltas as above (cheaper, simpler, no `PerformanceObserver` plumbing).

#### PerfOverlay snippet

```tsx
// PerfOverlay.tsx
const snap = frameMetrics.snapshot();
const rows = Object.entries(snap.passes ?? {})
  .sort(([, a], [, b]) => b.p99 - a.p99);

return (
  <div className="perf-overlay">
    <div>frame avg {snap.avg.toFixed(2)}  p50 {snap.p50.toFixed(2)}  p99 {snap.p99.toFixed(2)} ms</div>
    <table>
      <thead><tr><th>pass</th><th>p50</th><th>p99</th><th>mean</th><th>n</th></tr></thead>
      <tbody>
        {rows.map(([name, m]) => (
          <tr key={name}>
            <td>{name}</td>
            <td>{m.p50.toFixed(2)}</td>
            <td style={{ color: m.p99 > 4 ? '#f55' : undefined }}>{m.p99.toFixed(2)}</td>
            <td>{m.mean.toFixed(2)}</td>
            <td>{m.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
```

Toggle via existing Shift+P; gate the wrapping itself behind `__PERF__` so production bundles compile away the `timed()` indirection (V8 + Vite tree-shake).

#### Falsifiable prediction table (restated for verification)

| Scenario | Predicted top-3 (rank order) | What disconfirms |
|---|---|---|
| A 5k zoomed-out | `14.labels` > `4.clusters` > `7.mainStars` | If `7.mainStars` > `14.labels` despite small sprite size, label cost is over-estimated; investigate `forEachStarInBounds` dispatch overhead. |
| B 5k zoomed-in (drawScale=4) | `7.mainStars` > `4.clusters` > `10.themeOverlay` | If `4.clusters` dominates, GCO flip is the killer regardless of star count → prebuild offscreen layer is the right fix. |
| C 50k zoomed-out | `14.labels` > `7.mainStars` > `4.clusters` | If `7.mainStars` ≫ `14.labels`, fillText is cheaper on Apple-Silicon Graphite than expected; redirect effort to per-star alpha-bucket batching. |
| D wheel-zoom | `7.mainStars` > `14.labels` > input handler (separate metric) | If labels are flat and main stars spike during wheel, sprite cache miss / LOD-thresh thrash is the cause → prewarm at zoom transitions. |
| E post-theme-flip | `4.clusters` + `7.mainStars` (cold sprite gen) > `14.labels` | If the spike is single-frame and not in any of these passes, it's blocking sprite generation outside `draw()` — instrument `getTypedStarSprite`. |

---

### Deliverable 7 — Fix-This-First List

Ordered by **(estimated p99 reduction × inverse line-change cost)** for the *target* M3 + 50k case, secondary check on UHD floor.

| Rank | Fix | LOC | Speedup target scenarios | Risk | Notes |
|---|---|---|---|---|---|
| 1 | **App.tsx position-delta path** — split `starsCore` vs `positionsRef`; mutate Map in place; `markDirty()` instead of `setStars`. | S (~50) | Eliminates 2–10 ms p99 hiccup every 10 s (idle) and per SSE tick (during indexing). Decouples `percentileBuckets`, `starsById`, `rawStarsById` from layout. | Low. Hover/pick code now reads from `positionsRef`; one place. | Captures ~90% of memo-cascade win. |
| 2 | **O(visible) hover via gridRef** | S (~30) | -1 to -5 ms per `mousemove` at 50k → frees 30–300 ms/s during pan. Massive interactive p99 win. | Low. Identical semantics; tests easy to write. | Deliver int-packed key in same PR. |
| 3 | **Hoist per-frame allocations to refs** (drawnByFocusId, drawnIds, focusIds, labelDrawn, six closures, vignette gradient cache) | S (~80) | -1 to -3 ms p99 from reduced minor-GC cadence at 50k. | Low. `clear()` semantics are identical to `new Set()`. Closures need careful capture rewrite. | Almost free; do alongside #1–#2. |
| 4 | **Pre-compute cluster nebulae to offscreen world-space canvas**; invalidate on zoom-bucket change or theme flip | M (~150) | -0.7 to -2.2 ms/frame in **every** scenario. Removes one `globalCompositeOperation` flip and 150 `createRadialGradient` allocs. | Medium. Need to track invalidation deps; visual must match within tolerance after world-pan; consider 2 zoom LODs. | Highest absolute frame-time win in scenarios A, B, C, E. |
| 5 | **Skip label pass below zoom threshold; simple LOD** (no labels when `spritePx < ~12` or zoom < threshold) | S (~20) | -2 to -10 ms in scenarios A, C. Direct kill of the `fillText` hotspot when text is unreadably small anyway. | Low — visual: labels disappear at far zoom, which is a feature, not a regression. | If labels are still wanted, cache rendered text per `(label, color)` to an offscreen atlas (Sertic 2015 pattern: 10ms→1ms). |
| 6 | **Cache vignette gradient**; invalidate on resize only | XS (~10) | -0.1 to -0.25 ms/frame, every frame. | None. | Trivial; do with #3. |
| 7 | **Decoration pass: skip additive re-blit if sprite already drawn at full LOD this frame** | S (~30) | -0.05 to -0.2 ms/frame; correctness improvement (less overdraw). | Low. Need a 'drawnAtFullLod' bit per id (already have drawnIds; promote to small struct). | |
| 8 | **Animation overlay: cache `effectiveStarType` per star id**; cache linear gradients per `(id, lod, t-bucket)` | S (~40) | -0.1 to -0.5 ms/frame depending on A. | Low. | |
| 9 | **spatialGrid int-packed keys** `(cx<<16)|cy` with `Map<number, Star[]>` | S (~25) | -0.15 to -0.4 ms/frame at 50k. | Very low — tests for negative cells. | Do alongside #2. |
| 10 | **Sprite cache warmup on theme flip** — schedule `requestIdleCallback` to prebuild common `(sb, lod, type)` combos before next paint | M (~80) | Eliminates the post-flip spike in scenario E. | Low. | Prioritize types weighted by current visible bucket histogram. |
| 11 | **Quantize per-star `alphaJitter` to 8 buckets and group draws by alpha** so Skia can batch | M (~120) | -0.5 to -2 ms in scenarios A, C if main star pass is paint-bound (test post-instrumentation before doing this). | Medium — visual change in jitter texture; eyeball-test before merging. | Conditional on #6 prediction holding. |
| 12 | **`fillText` → glyph atlas**: pre-render all 0–9, A–Z, label fragments to an offscreen canvas; replace `fillText` with `drawImage` of subrects | L (~300) | If #5 doesn't suffice and labels remain wanted at zoom: -3 to -8 ms in scenario C. | Medium-high — encoding non-ASCII / variable-width / kerning is non-trivial. | Last resort; revisit after #1–#5 land. |

---

## Caveats

- **Numbers are estimates.** Apple-Silicon Graphite (Chromium 2024–2025 launch) lacks public benchmark literature for high-element Canvas2D workloads at the granularity of individual ops. The ranking among predicted top-3 is High confidence; absolute µs values are Medium. The instrumentation patch is the point — it produces ground truth in your environment in 30 minutes.
- **Floor-spec UHD on Chrome stable still uses Ganesh** as of M132 (Graphite is enabled by default only on Apple Silicon as of 2025). All state-flip costs are *worse* on the floor spec — the M3 ranking will under-state pain on UHD. Re-validate predictions against UHD before locking in #11 (alpha quantization).
- **`fillText` cost has high variance across platforms.** Sertic 2015 saw 10× wins by caching; Chrome on Linux historically had pathological cases. Today's Chromium (2024+) is much better, but `fillText` is still consistently slower than `drawImage` of pre-rasterized text per the MDN canvas-optimization advice ("Avoid text rendering whenever possible") and Tizen 2012 ranking.
- **`performance.mark` overhead** (≤1 µs/call) is benchmarked from Paul Irish's 2017 gist. No newer comparable benchmark surfaced; flagged Low confidence as the absolute number, but the relative magnitude (tens of µs/frame for 14 passes) is robust.
- **V8 GC numbers** (16 MiB nursery, 1–10 ms scavenges) come from V8 team blog posts (Orinoco, "Trash talk", 2017–2019). Newer Orinoco versions have shorter pauses; the *direction* of the claim (high allocation rate → frequent minor GCs → p99 hiccups) is uncontested.
- **The cluster prebuild fix (#4) assumes nebulae are world-space-stable** modulo zoom and theme. If they animate per-frame, the offscreen tile must be rebuilt on each animation tick and the win shrinks to "save the GCO flip" only — still worth doing but smaller.
- **Hover speedup math assumes uniform star distribution.** A clustered distribution (which is likely for a galaxy map) means cells in the cluster cores will hold 100s of stars; hover near a cluster core is still O(cluster-cell-population) and may only be 100×, not 1500×. Still well below 5 µs/move.
- **The `fillText` → atlas replacement (#12) has hidden complexity** for variable-width fonts, sub-pixel kerning, and non-ASCII labels. Don't start there; #1–#5 will likely make it unnecessary.
- **Skia Graphite reorders opaque draws** (Chromium blog 2025) — meaning some of the Ganesh-era assumptions about state-flip cost may be overstated on M3. The instrumentation will tell you. If passes 4 and 8 (the two GCO-using passes) are *not* top-3 on M3, Graphite is doing its job and you can deprioritize fix #4 and instead invest in fix #5 (labels) or #11 (alpha batching).