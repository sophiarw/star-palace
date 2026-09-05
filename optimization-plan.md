# Star Palace — Tailored Optimization Plan

## Context

User reports renderer perf "not acceptable" despite recent commits (DPR cap 7107ad5, idle prebuild fc7136b, perf overlay 833652c, cheap LOD ba40dbc, quality setting 468d4b7, position-delta refresh f505496, spatial grid f44b638). Past work attacked symptoms; root causes never identified because per-pass attribution does not exist in `frameMetrics.ts`.

Four deep-research reports (`deep-research-reports/report{1..4}.md`) converge on the same diagnosis from independent angles:

- **Report 1** (renderer arch): WebGL2 instanced is the right ceiling, but premature without per-pass profile. Phase 0 = profile gate. Some hot passes may not benefit from GPU migration.
- **Report 2** (daemon/wire): The 10-second `pollStats` → `setStars(prev => prev.map(...))` cascade rebuilds `starsById`/`projectedStars`/`percentileBuckets`/`rawStarsById` on every tick. O(N log N) on the React commit thread every 10 s. **Highest-leverage single fix.**
- **Report 3** (profile + hotspots): Predicts top-3 at 50k zoomed-out is **labels (`fillText`)**, **cluster nebulae gradients**, **main star pass + memo cascade**. Hover is O(N) linear scan, ~30–300 ms/s of main-thread time during pan. ~5.7 MB/frame allocations → minor GC every ~3 frames at 50k.
- **Report 4** (sprite cache): Typed LRU cap=500 thrashes (Zipf hit rate ~60%); raise to 4000 with byte ceiling. Theme flip nukes the old theme; should age out instead. Red-giant FBM runs at sprite resolution and is the actual worst drawer.

The plan executes findings by **leverage ÷ cost**, gated on instrumentation.

---

## Strategy (4 phases, sequential except Phase 3 parallel-safe)

| Phase | Goal | Cost | Risk | Gate to next |
|-------|------|------|------|--------------|
| 0 | Per-pass instrumentation | XS (~1 day) | None | Profile captured at 5k + 50k, idle + interacting + post-theme-flip |
| 1 | Cheap structural wins (no rendering rewrite) | M (~3–5 days) | Low | Re-profile; if p99 < 16.6 ms at target N, stop |
| 2 | Targeted hot-pass fixes (gated by Phase 0 ranking) | M (~4–6 days) | Medium | Re-profile; if still over budget, Phase 4 |
| 3 | Daemon-side wire/state fixes | M (~2–3 days; parallel-safe with 1+2) | Low | Independent |
| 4 | WebGL2 migration (only if Phase 1+2+3 insufficient) | L (~12–15 days) | Medium-High | Stop |

---

## Phase 0 — Per-pass instrumentation (precondition)

**Goal**: produce ground-truth ranking of pass costs at 5k & 50k stars under (A) zoomed-out idle, (B) zoomed-in idle, (C) wheel-zoom interaction, (D) post-theme-flip.

**Files**:
- `src/renderer/src/lib/frameMetrics.ts` — extend with `recordPass(name, ms)` ring buffer (Float32Array per pass, ~240 samples), `passSnapshot()` returning p50/p99/mean/n per name.
- `src/renderer/src/components/StarMap/StarMap.tsx` — wrap each of the 14 passes in `draw()` with `t0=performance.now(); …; recordPass('NN.name', performance.now()-t0)`. Gate behind a `__PERF__` Vite define (compiles away in prod).
- `src/renderer/src/components/PerfOverlay/PerfOverlay.tsx` — add a per-pass table sorted by p99 desc; color rows red where p99 > 4 ms.

**Detail**: see Report 3 §Deliverable 6 for drop-in code. Overhead ~30 µs/frame (≤0.2% budget). Marks must use `performance.now()` deltas, not `performance.mark`/`measure` (avoids unbounded mark list).

**Pass list to wrap** (14 in `draw()`, line refs from current `StarMap.tsx`):

1. `1.clear` — opaque fillRect + transform reset
2. `2.backdrop` — drawImage parallax
3. `3.vignette` — full-screen radial gradient
4. `4.clusters` — 150 cluster nebula gradients + GCO `screen` flip
5. `5.activeHull` — convex hull (when collection active)
6. `6.edges` — selected neighborhood edges
7. `7.mainStars` — `forEachStarInBounds` → `drawMainStar`
8. `8.animOverlay` — pulsar/quasar beams
9. `9.decoration` — selected/neighbor/highlight rings + boost re-blits
10. `10.themeOverlay` — theme.background.overlay
11. `11.chevrons` — off-screen neighbor markers
12. `12.lockGlyphs` — pinned star 🔒 fillText
13. `13.pinDrag` — drag preview
14. `14.labels` — `forEachStarInBounds` → `drawLabel`

Also instrument as separate metrics (outside `draw()`): `handleMouseMove` time, sprite cache miss count, sprite cache size.

**Gate**: capture 60-second profiles in scenarios A–D at both 5k and 50k stars on the user's machine. Compare observed top-3 to Report 3's prediction table:

| Scenario | Predicted top-3 | If wrong → |
|----------|-----------------|------------|
| A 5k zoomed-out | labels > clusters > mainStars | Falsifies model; widen instrumentation inside surprising pass |
| C 50k zoomed-out | labels > mainStars > clusters | Same |
| B zoomed-in | mainStars (fill-rate) > clusters > themeOverlay | If clusters dominate, GCO flip is killer regardless of N |
| D post-theme-flip | clusters + mainStars (cold sprite gen) > labels | If spike outside any draw pass, blocking sprite gen — instrument `getTypedStarSprite` |

---

## Phase 1 — Structural wins (no GPU, low risk, parallel-safe)

Each item is independent and can land in its own PR. Order is by **leverage ÷ cost**, derived from cross-report convergence.

### 1.1 Decouple positions from React state cascade — **highest leverage**

**Problem** (Report 2 #1, Report 3 Deliverable 5): `setStars(prev => prev.map(...))` on every `pollStats` tick (10 s idle) and SSE position-delta during indexing rebuilds the array reference. Every downstream `useMemo` keyed on `stars` invalidates: `rawStarsById` (O(N) Map), `visibleStars` (O(N) filter), `percentileBuckets` (O(N log N) sort), `projectedStars` (O(N) projection), `starsById` (O(N) Map). At 50k this is a 2–10 ms p99 hiccup every 10 s.

**Fix** (cheapest path — captures ~90% of win):
- Split `stars` state in `App.tsx` into:
  - `starsCore: Star[]` — id, name, mimeType, clusterId, galaxyId, importanceScore, viewCount, isPinned, starType. **Mutates only on add/remove/edit.**
  - `positionsRef = useRef<Map<string, [x, y, layoutVersion]>>()` — mutated in place by `pollStats`. **Not React state.**
- `pollStats` writes to `positionsRef.current.set(id, [x, y, layoutVersion])` then calls `markDirty()` (or sets `setPosVersion(v => v+1)` if any consumer needs subscription).
- `StarMap.draw()` reads positions from `positionsRef.current.get(star.id) ?? [star.x, star.y]`.
- Memos (`rawStarsById`, `visibleStars`, `percentileBuckets`) lose their position-tick invalidation.

**Files**: `src/renderer/src/App.tsx` (~50 LOC), `src/renderer/src/components/StarMap/StarMap.tsx` (forward ref + read site).

**Risk**: low. Hover/pick code reads from `positionsRef`; one place. Tests easy.

**Expected delta**: removes 2–10 ms p99 hiccup every 10 s; eliminates indexing-tick jank entirely. Knock-on: idle frame budget freed for further optimizations.

### 1.2 O(visible) hover via existing spatial grid

**Problem** (Report 3 Deliverable 4): `handleMouseMove` linear-scans `starsRef.current` on every pointer event (~60 Hz during pan). At 50k stars × 60 events/s = 3 M distance compares/s = **0.5–2 ms/move on Apple Silicon, 1.5–5 ms on Intel UHD**. During pan this consumes 30–300 ms/s of main-thread time, competing with `draw()`.

**Fix**:
- Replace the linear scan in `handleMouseMove` and `handleClick` (StarMap.tsx) with a grid-bounded query:
  ```ts
  const r = 25 / cam.zoom;
  const cs = gridRef.current.cellSize;
  const cx0 = Math.floor((wx - r) / cs), cx1 = Math.floor((wx + r) / cs);
  const cy0 = Math.floor((wy - r) / cs), cy1 = Math.floor((wy + r) / cs);
  // iterate cells [cx0..cx1] × [cy0..cy1] from gridRef.current.cells
  ```
- Reuses existing grid built by `forEachStarInBounds`.

**Files**: `src/renderer/src/components/StarMap/StarMap.tsx` (~30 LOC).

**Risk**: low. Identical semantics modulo radius. Visual correctness: zero change — pick radius is the same.

**Expected delta**: 180×–10,000× inner-loop reduction. Frees 30–300 ms/s of main thread during pan. Direct fix for "interacting p99 worse than idle".

### 1.3 Hoist per-frame allocations to refs

**Problem** (Report 3 Deliverable 2): `draw()` allocates ~5.7 MB/frame at 50k zoomed-out (`new Map drawnByFocusId`, `new Set drawnIds`, `new Set focusIds`, `new Set labelDrawn`, six closures, vignette gradient). V8 nursery (~16 MiB) fills every ~50 ms → minor GC every ~3 frames → 1–10 ms scavenge pauses → p99 bumps.

**Fix**:
- Hoist the four collections to refs initialized once; call `.clear()` at top of `draw()` instead of `new`.
- Hoist closures (`drawMainStar`, `getTempBucket`, `getJitter`, `drawLabel`, `renderForced`, `drawSpriteOriented`) outside the `draw` body or rebuild via `useCallback` with stable deps; pass dynamic state as args.
- Cache vignette gradient on a ref; invalidate only on canvas resize.

**Files**: `src/renderer/src/components/StarMap/StarMap.tsx` (~80 LOC).

**Risk**: low. `clear()` semantics identical to `new Set()`/`new Map()`. Closure hoisting needs careful capture rewrite — pass args explicitly.

**Expected delta**: -1 to -3 ms p99 from reduced minor-GC cadence at 50k. Roughly halves heap allocation pressure in the draw loop.

### 1.4 spatialGrid int-packed keys

**Problem** (Report 3 §spatialGrid): `${cx}|${cy}` string concat allocates 24–40 B per lookup × 5000 cells/frame at 50k zoomed-out = 200 KB/frame string churn.

**Fix**: switch grid Map to `Map<number, Star[]>` keyed by `(cx + 32768) * 65536 + (cy + 32768)` (handles negative coords up to ±32768 cells = ±3.2M world units, more than needed).

**Files**: `src/renderer/src/components/StarMap/spatialGrid.ts` (~25 LOC).

**Risk**: very low. Add unit test for negative coord cases.

**Expected delta**: -150 to -400 µs/frame at 50k. Second-order, but bundle with 1.2.

### 1.5 Sprite cache: raise typed cap + theme-aware eviction

**Problem** (Report 4 Rank 1+2):
- Cap=500 thrashes on moderate-pan sessions at 50k (Zipf hit rate ~60% per Che's approximation).
- Theme prefix on key means theme flip immediately starts evicting old-theme entries; visible stars then trigger O(visible) drawer rebuilds. 1k visible × 0.5–1.5 ms drawer cost = 500–1500 ms freeze on first flip.

**Fix** (combine both edits in same PR):
- Raise `typedCache` cap from 500 to **4000** with **96 MB byte ceiling** as safety net.
- Add `themeId` field on cache entries. On eviction, bounded-scan (max 8) from LRU tail; prefer non-active-theme victims; fall back to plain LRU if scan budget exhausts.
- Detail: Report 4 §B.2 has ready-to-paste `LRUSpriteCache` rewrite.

**Files**: `src/renderer/src/components/StarMap/proc.ts` (LRUSpriteCache, ~50 LOC), `src/renderer/src/components/StarMap/sprites.ts` (cache construction + `set` call site, ~10 LOC).

**Risk**: low. Memory: +20–60 MB resident worst case (bounded by 96 MB byte cap). Falsifiable: vitest spec for hit rate + theme survival (Report 4 §C.2).

**Expected delta**: pan-thrash p99 drops 2–6 ms; first theme flip cost unchanged but **second flip onward goes from 500–1500 ms freeze to ~0–10 ms** (old theme survives in cache).

### 1.6 Default sprite cache: add dev-only assertion only

**Problem** (Report 4 §A.4): bounded cardinality (~2.7k), bounded memory (single-digit MB). Eviction code is dead code.

**Fix**: leave Map as-is. Add `import.meta.env.DEV` warn if `cache.size > 4096` to catch future bucket-count growth.

**Files**: `src/renderer/src/components/StarMap/sprites.ts` (~5 LOC).

**Risk**: none.

### 1.7 Idle-prebuild for both themes

**Problem** (Report 4 Rank 3): existing `requestIdleCallback` chain (commit fc7136b) prebuilds active-theme full sprites only. First theme flip is still 500–1500 ms even with 1.5's eviction policy because the new theme is cold.

**Fix**: extend idle prebuild to enumerate `(themeId, type, sizeBucket, hashBucket)` tuples for **both** registered themes, weighted by visible-bucket prevalence. Stop when typedCache reaches ~80% of capCount or idle budget exceeds ~50 ms per ric tick.

**Files**: `src/renderer/src/components/StarMap/StarMap.tsx` (existing useEffect, ~40 LOC).

**Risk**: low. Depends on ric firing during idle; on contended main thread, prebuild doesn't happen, but 1.5's eviction still covers flip-back.

**Expected delta**: first-flip cost from 500–1500 ms to <50 ms when idle window has fired enough.

---

**Phase 1 gate**: re-profile A–D at 5k and 50k. If p99 ≤ 16.6 ms in all scenarios, stop. Otherwise proceed to Phase 2 driven by observed top-3 ranking.

---

## Phase 2 — Targeted hot-pass fixes (ranked by Phase 0 outcomes)

Order chosen by Report 3's predicted top-3 at 50k. **Land only the items whose pass is actually in observed top-3.**

### 2.1 Label pass: zoom-threshold skip + glyph atlas

**Predicted #1 hotspot at 50k zoomed-out** (Report 3). `fillText` is the most expensive ordinary Canvas2D op in Skia (MDN: "Avoid text rendering whenever possible"; Sertic 2015: 10× speedup by caching to offscreen sprite).

**Sub-step A — cheap (~20 LOC)**: skip the label pass entirely below a sprite-pixel threshold (e.g., `spritePx < 12` or `cam.zoom < 0.8` already half-handled). If labels unreadably small, drawing them is pure cost. Phase 1 of fix; ship first.

**Sub-step B — heavier (~300 LOC, only if A insufficient)**: pre-render glyphs to an offscreen canvas atlas (0–9, A–Z, a–z, `.-_/`, common extension chars). Replace `fillText` with `drawImage` of subrects. Pattern: Sertic 2015 "10 ms → 1 ms" win.

**Files**: A = `src/renderer/src/components/StarMap/StarMap.tsx`. B = new `src/renderer/src/components/StarMap/labelAtlas.ts` (~250 LOC) + StarMap.tsx integration.

**Risk**: A = none (visual: labels disappear when unreadable, intuitive). B = medium (variable-width fonts, kerning, non-ASCII names).

**Expected delta**: A = -2 to -10 ms p99 in 50k zoomed-out scenarios. B = additional -3 to -8 ms if labels still wanted at zoom.

### 2.2 Cluster nebulae offscreen prebuild

**Predicted #2 hotspot in scenarios A, B, C, E** (Report 3 §Deliverable 1 + §Deliverable 3). 150 `createRadialGradient` allocations/frame + a `globalCompositeOperation='screen'` flip that breaks Skia batching.

**Fix**:
- Render the cluster nebula layer once into an offscreen canvas in **world-space** (or fixed canvas-space sized to current viewport with a zoom-bucket key).
- Cache invalidates on: cluster set change, theme change, zoom-bucket transition, canvas resize.
- Per-frame: one `drawImage` of the precomputed layer with same parallax math as backdrop.

**Files**: new `src/renderer/src/components/StarMap/nebulaLayer.ts` (~150 LOC) + StarMap.tsx integration (~30 LOC).

**Risk**: medium. Need to track invalidation deps; visual must match within tolerance after world-pan; consider 2 zoom LODs (otherwise highly-zoomed nebulae go blurry).

**Expected delta**: -0.7 to -2.2 ms/frame in **every** scenario (A, B, C, E). Removes the GCO flip → restores Skia batching for star pass.

### 2.3 Animation overlay: cache linear gradients per id

**Predicted contributor** (Report 3 §Deliverable 1 row 8). Pulsar/quasar passes call `createLinearGradient` per pulsar per frame.

**Fix**: cache `(starId, lod, time-bucket)` → CanvasGradient. Time bucket = `Math.floor(t * 10)` to allow 100 ms reuse windows.

**Files**: `src/renderer/src/components/StarMap/StarMap.tsx` (~40 LOC).

**Risk**: low. Visual: gradient stops update at 10 Hz instead of frame-rate; imperceptible.

**Expected delta**: -0.1 to -0.5 ms/frame depending on animated-star count.

### 2.4 Red-giant FBM cap (sprite-build cost)

**Predicted post-theme-flip hotspot** (Report 4 Rank 4). Red-giant FBM runs at sprite resolution (unlike nebula's 56² cap). Build cost ~3–7 ms/sprite at sb=6.

**Fix**: apply same NOISE_MAX cap as nebula (commit 499068b pattern) — sample FBM on 48² or 64² grid and bilinear-upsample with `imageSmoothingQuality='high'`.

**Files**: `src/renderer/src/themes/jwst/drawers.ts` (red-giant section, ~40 LOC), same in `src/renderer/src/themes/vapor/drawers.ts` if applicable.

**Risk**: medium. Visual A/B required — bilinear upsample of high-frequency mottling can look blurry. Compare side-by-side at sb=6 before merging.

**Expected delta**: red-giant build cost from ~3–7 ms to <1 ms at sb=6. Net: 5–20 ms saved on a giant-heavy frame post-theme-flip.

### 2.5 Per-star alpha quantization for batching (conditional)

**Only if Phase 0 shows main star pass paint-bound** (Report 3 §Deliverable 3). Per-star unique `alphaJitter` produces V unique Skia paints → no batching.

**Fix**: quantize `alphaJitter` to 8 buckets (`Math.round(j*8)/8`); group draws by alpha bucket so Skia batches.

**Files**: `src/renderer/src/components/StarMap/StarMap.tsx` (~120 LOC; main pass restructure).

**Risk**: medium. Visual change in jitter texture; eyeball-test required. Skip unless pass 7 confirmed paint-bound.

**Expected delta**: -0.5 to -2 ms in 50k zoomed-out if confirmed.

### 2.6 Rotation transform: setTransform instead of save/rotate/restore

**Report 4 Rank 6**. Replace per-default-star `save/translate/rotate/drawImage/restore` with `setTransform(c, s, -s, c, x, y); drawImage(sprite, -hw, -hh)`; reset once at end of pass.

**Files**: `src/renderer/src/components/StarMap/StarMap.tsx` (~15 LOC).

**Risk**: low.

**Expected delta**: 0.3–0.7 ms saved per 1k draws.

---

## Phase 3 — Daemon-side wire/state fixes (parallel-safe)

Run alongside Phase 1/2. Independent.

### 3.1 SSE multiplex for layoutVersion / stats

**Problem** (Report 2 #2): `pollStats` every 10 s forces JSON.parse + setState even when nothing changed. Spurious re-renders + a guaranteed jitter source.

**Fix**: multiplex `layout`, `stats`, `progress` events on the existing `/api/index/progress` SSE stream (commit 760b6a3 already has the infra). Renderer subscribes once, dispatches by event name.

**Files**: `src/daemon/index.ts` (~50 LOC), `src/renderer/src/App.tsx` (~30 LOC), `src/renderer/src/api.ts`.

**Risk**: low. Caveat: disable Express compression on `text/event-stream`; call `res.flushHeaders()`.

**Expected delta**: removes 10-second-cadence forced re-render. Compounds with 1.1.

### 3.2 Binary `/api/map/all` (gated on 1.1 landing)

**Problem** (Report 2 #7): 50k stars × ~80 B JSON = 4 MB payload. Cold-start latency only — does NOT affect steady-state p99.

**Fix**: column-major binary protocol, JSON sidecar for strings/cluster metadata. Detail in Report 2 §Concrete protocol recommendation. Renderer reads `Float32Array`s as views over `arrayBuffer()` — zero per-element decode.

**Files**: `src/daemon/index.ts` (~80 LOC), `src/renderer/src/api.ts` (~50 LOC).

**Risk**: low. **Only ship after 1.1** — if `App.tsx` materializes the typed arrays back into Star objects, the win is thrown away.

**Expected delta**: cold-start parse time from ~50–150 ms to <5 ms at 50k. No steady-state effect.

### 3.3 SQLite + HNSW tuning (optional, low cost)

**Problem** (Report 2 #4, #5): unverified but standard hygiene.

**Fix checklist**:
- `EXPLAIN QUERY PLAN` every hot query; add covering indices where SQLite says SCAN on tables > few thousand rows.
- `PRAGMA synchronous=NORMAL`, `mmap_size=256MB`, `cache_size=-65536`, `temp_store=MEMORY`.
- `Statement.raw(true)` on bulk reads (`/api/map/all`).
- Hoist `db.prepare` to module scope.
- Stop `hnsw.writeIndex` per file during bulk ingest; batch every 500–2000 inserts or on idle.

**Files**: `src/daemon/db/FileIndex.ts`, `src/daemon/index.ts`, `src/daemon/pipeline/Insert.ts`.

**Risk**: low. `synchronous=NORMAL` is corruption-safe in WAL.

**Expected delta**: search-typing latency lower; bulk-ingest faster. No direct frame effect.

### 3.4 PCA retrain frequency (optional)

**Report 2 #6**: ml-pca uses full SVD; at d≈768 and N≥10k this is seconds, not 100 ms. Cheapest fix is "retrain less often" — coarser schedule (corpus doubled, or principal-angle test). Implement randomized SVD only if profile shows retrain on hot path.

**Files**: `src/daemon/layout/Relayouter.ts` (~30 LOC for policy change).

**Risk**: low.

---

## Phase 4 — WebGL2 migration (gated, only if needed)

**Decision rule**: only enter Phase 4 if after Phases 1–3 land, the user's profile shows p99 frame > 16.6 ms at the target N (e.g., 50k) **and** Phase 0 confirmed star/edge/decoration passes are >50% of frame p99 (i.e., GPU instancing is the right tool).

**Sequencing**: follow Report 1 §Step-Sequenced Migration Plan verbatim, Phases 0–7. Key gates:
- Phase 1 (atlas builder using existing `ThemedDrawer` contract): drawer files untouched.
- Phase 2 (star pass to GL): layered Canvas2D + GL canvases under feature flag `renderer: 'canvas2d' | 'webgl2'`.
- Phase 3 (edges to GL).
- Phase 4 (nebulae as fragment shader) — **mandatory if cluster nebulae are in observed top-3**, otherwise the migration leaves half the fill cost on Canvas2D.
- Phase 5 (animation overlay, decoration as instanced atlas).
- Phase 6 (intentional Canvas2D residue: labels, off-screen chevrons, theme overlay).
- Phase 7 (cleanup).

**Cost**: 12–15 engineering days for one engineer who has written GLSL.

**Risk**: medium-high. Premultiplied-alpha trap (Report 1 §5); atlas size cap 4096×4096 for Intel safety; instance attribute streaming via persistent `Float32Array`.

**Expected delta**: p99 frame 8–14 ms at 50k stars on 2018 MBP if nebulae also ported (Phase 4).

---

## Cross-cutting verification

After each phase:

1. **Re-profile** scenarios A–D at 5k and 50k via the Phase 0 instrumentation. Compare p50/p99/per-pass deltas.
2. **Visual diff**: run `npm run dev:web` + `npm run dev:daemon`; manually compare pre/post screenshots for each theme at zoom levels 0.5×, 1×, 2×, 4×.
3. **Tests**: `npm run typecheck && npm run lint && npm run test` (CLAUDE.md gate).
4. **Microbench** (sprite cache changes only): run `benches/sprite-cost.bench.ts` and `benches/sprite-cache.test.ts` per Report 4 §C.

**Falsification triggers** (stop and rethink):
- Phase 0 ranking does not match Report 3's prediction → expand instrumentation inside the surprising pass before continuing.
- Phase 1 lands but p99 is unchanged → memo cascade was not the bottleneck; Phase 2 must lead.
- Phase 2.2 (cluster prebuild) lands but cluster pass cost unchanged → Skia Graphite is already reordering; Phase 4 is the only remaining lever.

---

## Critical files (canonical reference)

Renderer hot-paths:
- `src/renderer/src/App.tsx` — state cascade fix lives here (1.1)
- `src/renderer/src/components/StarMap/StarMap.tsx` — instrumentation, hover, allocations, label LOD, cluster prebuild integration
- `src/renderer/src/components/StarMap/sprites.ts` — typed cache cap + theme-aware eviction call site
- `src/renderer/src/components/StarMap/proc.ts` — `LRUSpriteCache` rewrite
- `src/renderer/src/components/StarMap/spatialGrid.ts` — int-packed keys
- `src/renderer/src/lib/frameMetrics.ts` — per-pass instrumentation extension
- `src/renderer/src/components/PerfOverlay/PerfOverlay.tsx` — per-pass UI
- `src/renderer/src/themes/jwst/drawers.ts` + `themes/vapor/drawers.ts` — red-giant FBM cap

Daemon:
- `src/daemon/index.ts` — SSE multiplex, binary `/api/map/all`
- `src/daemon/db/FileIndex.ts` — index audit, `Statement.raw`, prepared-stmt hoist
- `src/daemon/layout/Relayouter.ts` — retrain policy
- `src/daemon/pipeline/Insert.ts` — defer `hnsw.writeIndex`

New files:
- `benches/sprite-cost.bench.ts` (Report 4 §C.1)
- `benches/sprite-cache.test.ts` (Report 4 §C.2)
- `src/renderer/src/components/StarMap/nebulaLayer.ts` (Phase 2.2)
- `src/renderer/src/components/StarMap/labelAtlas.ts` (Phase 2.1B, conditional)

---

## Sequencing recommendation

Concrete first 2 weeks:

| Day | Action |
|-----|--------|
| 1 | Phase 0 instrumentation + capture baseline profiles |
| 2–3 | Phase 1.1 (state cascade decouple) + 1.2 (hover grid) |
| 4 | Phase 1.3 (allocation hoisting) + 1.4 (int keys) |
| 5 | Phase 1.5 + 1.6 + 1.7 (sprite cache cap + theme-aware + dual-theme prebuild) |
| 6 | Re-profile. **Stop if p99 ≤ 16.6 ms.** |
| 7 | Phase 3.1 (SSE multiplex) — parallel-safe |
| 8–9 | Phase 2.1A + 2.4 (label skip + red-giant FBM cap) |
| 10–12 | Phase 2.2 (cluster nebula prebuild) |
| 13 | Re-profile. **Stop if p99 ≤ 16.6 ms.** |
| 14+ | Phase 2.3, 2.5, 2.6 as needed; Phase 4 only if still over budget |
