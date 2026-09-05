# Star Palace Renderer Architecture: Migration Recommendation

## TL;DR

- **Recommendation: (b) WebGL2 instanced quads with a sprite atlas, with the existing Canvas2D drawer contract preserved as an offline atlas baker (option ii).** Confidence: **medium-high**, conditional on a per-pass profile showing the star/edge/decoration passes (5, 4, 7) dominate p99 frame time. Confidence becomes **low** for this recommendation if the profile shows the nebula+vignette+theme-overlay fill (passes 1, 2, 8) dominate — in which case WebGL2 buys you almost nothing until you also rewrite those passes as fragment shaders or shrink overdraw, and a cheaper Canvas2D-only triage may be the right first move.
- **Reject (a) Canvas2D + aggressive batching:** Chromium's Skia backend already auto-batches consecutive `drawImage` calls at the platform layer; further JS-side batching has a low ceiling, and the alternative (per-frame `putImageData` software composite) almost always **loses** to `drawImage` on Chromium because it forces GPU↔CPU readback and breaks the accelerated canvas path. There is no plausible 50k-stars-at-60fps endpoint here.
- **Defer (c) WebGPU + render bundles** until a WebGL2 implementation exists and CPU-side draw submission (not GPU fill-rate) is the proven bottleneck. As of 2026 WebGPU is Baseline (Chrome 113+, Safari 26+, Firefox 141 Windows / 145 macOS ARM64), but published 2D-sprite benchmarks (Babylon.js, PixiJS v8) show WebGPU is **frequently slower than WebGL2** for sprite workloads unless render bundles are explicitly used to amortize JS→GPU command overhead — and at one instanced draw call for all stars, that overhead is already minimal.

---

## Key Findings

### 1. The bottleneck is currently undetermined; this is the single most important fact

`frameMetrics.ts` reports avg/p99/dropped/visible-count but no per-pass attribution. Three plausible bottlenecks are observationally indistinguishable in the current data:

- **Fill-rate bound (passes 1, 2, 8):** ~150 radial gradients on a 2880×1800 (DPR 2 on a 1440×900 13" MBP) canvas, plus full-screen vignette, plus full-screen scanline overlay. Iris Plus 655 has 6.3 GPixel/s pixel fillrate (TechPowerUp / cpu-monkey). At 60 Hz, the fill budget is ~105 MPx/frame; the screen alone is 5.18 MPx, so the GPU tolerates ~20× overdraw before falling below 60 fps. 150 nebulae averaging even 200×200 effective coverage = 6 MPx; vignette adds 5.18 MPx; scanlines add 5.18 MPx; star sprites at 50k × ~24² overlap ≈ 28 MPx. That's a realistic ~50 MPx/frame, which is feasible **only if Skia's GPU canvas path is actually being used and not falling back to software** on macOS.
- **CPU draw-call bound (pass 5, 7):** `drawImage` for 50k visible stars + save/translate/rotate/restore is ~5 JS calls × 50k = 250k function calls per frame. Even at 200ns/call, that's 50ms — way over budget.
- **Sprite-build bound (theme switch / first-load):** the JWST drawer's FBM ImageData loops (up to 56² = 3,136 pixels per sprite, with N typed sprites × ~6 size buckets × hash variants = potentially thousands of sprites built once) are O(p × n) on the main thread.

**No recommendation should be finalized without ~30 lines of `performance.now()` bracketing in the existing rAF loop, attributing wall time to each of the 11 numbered passes.** This is the single highest-ROI engineering change available right now.

### 2. Fill-rate budget on the target hardware

The 2018 13" MacBook Pro Touch Bar uses Iris Plus Graphics 655 (Coffee Lake GT3e, 48 EUs @ up to 1.2 GHz, 128 MB eDRAM). Published numbers:

| Metric | Iris Plus 655 |
|---|---|
| Pixel fillrate | 6.3 GPixel/s |
| Texture fillrate | 50.4 GTexel/s |
| Max WebGL2 texture (Chrome on macOS) | 16384 (confirmed in Mozilla bug 1310222) |
| Max WebGL2 texture (Firefox older macOS) | 4096 (driver bug, fixed in 10.12+) |
| Max attributes / vertex | 16 |

At 1440×900 logical / DPR 2 → 2880×1800 = 5.18 MPx. 60 fps fill budget = 6.3 GPx/s ÷ 60 = **105 MPx/frame ≈ 20× full-screen overdraw**. This is tight but *not* the constraint that makes Canvas2D fail — the constraint is more likely the per-`drawImage`-call CPU overhead × 50k. Texture fillrate is 50.4 GTexel/s = 840 MTx/frame budget, so a textured atlas quad pass for 50k sprites at 24²–32² is ~30–50 MTx/frame, comfortably under budget by **~20×**.

### 3. WebGPU 2026 status

| Browser | WebGPU stable | Notes |
|---|---|---|
| Chrome / Edge | 113+ (Apr 2023), Linux unflagged 2024 | Dawn backend |
| Safari | 26.0 (Sep 2025), macOS Tahoe 26 / iOS 26 | WebKit native |
| Firefox | 141 (Jul 2025) Windows; 145 (late 2025) macOS ARM64 | wgpu (Rust) |
| Firefox | **Linux + Intel Mac: in progress through 2026** | Mozilla expects Linux ship in 2026 |

WebGPU became "Baseline" in January 2026 per Web Platform Status. **For a Chromium-current target user, WebGPU is fully available.** However: a 2018 Intel-Mac on Firefox is exactly the case where WebGPU is *not yet* available, so any code that targets the user's stated baseline (Chromium-current) is fine, but a WebGPU-only implementation cannot serve a meaningful tail of users without a WebGL2 fallback.

### 4. WebGPU vs WebGL2 for 2D sprites: published evidence is mixed-to-negative

- **Babylon.js team (gpuweb issue #1596):** for 3000 cubes, WebGPU was ~17% *slower* than WebGL2 on CPU scripting time without render bundles. With render bundles caching all setRenderPipeline / setVertexBuffer / setBindGroup calls, WebGPU surpassed WebGL. Required nontrivial bundle cache invalidation logic.
- **PixiJS v8 docs:** "WebGPU does not automatically guarantee improved performance over WebGL... PixiJS often encounters more limitations on the CPU side than the GPU. However, for scenes with numerous batch breaks (filters, masks, blend modes), WebGPU may offer better performance." Star Palace has very few batch breaks in the proposed design (one atlas, one blend mode for stars, one for edges).
- **Babylon.js community thread:** "webGL is better so far... noticeably less performant" (subjective, but consistent with the Babylon issue tracker's measured numbers).
- **Render bundles save CPU only when JS draw-call count is high:** the canonical win is the WebGPU Animometer / 40k objects case where each object is its own draw call. Star Palace's design at one instanced draw for all stars makes render bundles approximately worthless for the star pass — there are only ~5–10 draws per frame total.
- **Where WebGPU actually wins** for this kind of workload is *compute-driven* particle/transform updates — moving the spatial-grid query and per-instance attribute computation onto the GPU. That is a v3 optimization, not a migration target.

**Bottom line:** WebGPU's structural wins (compute, lower CPU overhead via bundles) don't apply at this scale and shape. WebGL2 is the right floor.

### 5. Drawer compatibility with atlas-baking (option ii)

All Canvas2D features used by `themes/jwst/drawers.ts` (871 LOC) and `themes/vapor/drawers.ts` (775 LOC) bake cleanly to an offscreen `HTMLCanvasElement` → `texImage2D`/`copyExternalImageToTexture` upload:

| Drawer feature | Bakes cleanly? | Caveat |
|---|---|---|
| `createRadialGradient` + `arc` fill | Yes | None |
| `createLinearGradient` | Yes | None |
| `ImageData` FBM pixel loops | Yes | One-time CPU cost; bake on idle, not per-frame |
| `save`/`translate`/`rotate`/`restore` | Yes | Bakes the *output*, not the transform — pre-rotated variants if needed go in separate atlas tiles |
| `globalCompositeOperation = 'destination-in'` (mask) | Yes | Bakes to an opaque RGBA tile; mask is "burned in" |
| `globalCompositeOperation = 'lighter'` (additive) **at sprite-build time** | Yes — and this is fine | The composite happens between layers *inside the sprite tile* |
| `globalCompositeOperation = 'lighter'` **at scene render time** (current edge/star additive blending) | Handled at GPU blend-state level, **not** in the atlas | Use `gl.blendFunc(gl.ONE, gl.ONE)` for additive; `gl.ONE, gl.ONE_MINUS_SRC_ALPHA` for premultiplied source-over |

**The single real gotcha is premultiplied alpha.** Canvas2D output is always premultiplied. When uploading via `gl.texImage2D(... canvas)`, set `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)` (the default; the canvas is already premultiplied) and use `blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`. The classic mistake is `blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)` with a premultiplied source, which produces dark fringes around antialiased edges (Tom Forsyth, "Premultiplied Alpha"). This is a 2-line fix but it must be tested with the vapor theme's `destination-in` masks, which generate premultiplied output that has historically tripped up Spine / PixiJS atlas pipelines.

**No drawer feature forces a rewrite.** The `ThemedDrawer = (ctx, cx, cy, r, rng, sizeBucket) => void` contract survives unmodified; it just renders into an offscreen canvas owned by the atlas builder instead of the live scene canvas.

### 6. Atlas size and Intel Iris Plus

`MAX_TEXTURE_SIZE` on Iris Plus 655 in Chromium is 16384. **Don't go past 8192 in either dimension** — Firefox on older macOS reported 4096 (driver-capped, fixed in 10.12+, but field telemetry shows the cap still appears in the wild), and Intel Skylake/HD-510 historically had a corruption bug at >5461px wide for RGB textures (Intel Community, 2017). 8192×8192 RGBA = 256 MB VRAM, which is too large; a more realistic target is **2048×2048 or 4096×4096 per atlas**, with multiple atlas pages bound to texture units 0..N (WebGL2 minimum 16 texture units). For Star Palace's typed-sprites × 6 size buckets × hash variants × theme = 500-tile LRU, a single 4096×4096 page holding 64×64 tiles is 4096 tiles — comfortable headroom.

### 7. DPR cap and LOD swap under each target

| | (a) Canvas2D batching | (b) WebGL2 instanced | (c) WebGPU |
|---|---|---|---|
| DPR cap still needed? | **Yes, aggressively** — fill rate is dominated by per-tile rasterization on CPU/Skia | **Yes for the nebula/vignette/scanline passes, no for the star pass** | Same as (b) |
| LOD swap still needed? | Yes — both for fill and for `drawImage` count | **Yes, but only for fill-rate-bound passes** — the star pass becomes ~free | Same as (b) |
| Quality setting (low/med/high/ultra) | Keep all knobs | **Repurpose:** quality now controls overdraw (nebula count, scanline density, DPR), not star count | Same as (b) |

GPU instanced rendering does **not** make DPR cap unnecessary at 50k stars, because the nebula radial gradients (pass 2) and full-screen overlays (passes 1, 8) are *not* the star pass. They are full-screen-ish fills that scale linearly with pixel count. On Iris Plus 655 at DPR 2, ~10× overdraw of full-screen gradients alone could consume 8–10 ms — half the frame budget. **DPR cap stays. LOD swap can be relaxed for stars only.**

### 8. Migration cost — concrete file-level estimates

| Target | Files churned | LOC added/changed | Net risk |
|---|---|---|---|
| **(a) Canvas2D + batching** | `StarMap.tsx` (~600 LOC reorder), new `atlas.ts` (~200 LOC), `frameMetrics.ts` (+50 LOC instrumentation), `sprites.ts` (~100 LOC consolidation). Drawers untouched. | ~950 LOC | Low risk, low ceiling. **Will not reach 60fps at 50k.** |
| **(b) WebGL2 instanced** | `StarMap.tsx` render loop (~400 LOC of pass dispatch rewritten as GL state setup + draw calls), new `gl/atlas.ts` (~250 LOC), new `gl/programs.ts` with star/edge/nebula/decoration shaders (~400 LOC GLSL+JS), new `gl/buffers.ts` (instance attribute streaming, ~200 LOC), `frameMetrics.ts` (+80 LOC for `EXT_disjoint_timer_query_webgl2` if available, perf.now fallback otherwise), `sprites.ts` rewritten as atlas-page allocator (~300 LOC). **Drawer files (1646 LOC combined) untouched.** Theme contract preserved. | ~1,650 LOC added; ~400 in `StarMap.tsx` deleted/replaced. | Medium risk, high ceiling. |
| **(c) WebGPU + render bundles** | All of (b)'s file footprint, plus: WGSL translations of every shader (or auto-translation via Naga/Tint), bind-group layout objects, render-bundle cache invalidation logic (~150 LOC of cache management — see Babylon team's experience in gpuweb #1596), WebGL2 fallback path (because Linux Firefox / Intel Mac users still don't have it). | ~2,400 LOC including fallback. | High risk, marginal ceiling improvement over (b) at this scale. |

### 9. Per-target risks (sharp form)

**(a) Canvas2D + batching**
- Chromium already batches `drawImage` internally (WHATWG wiki on batch drawImage; Chromium uses Skia's `drawBitmap` to detect batchable runs). Manual JS-level batching saves the JS function-call overhead but not the underlying GPU work.
- Per-frame `putImageData` composite: on a 2880×1800 buffer that's 20.7 MB/frame copied CPU→GPU. `putImageData`/`getImageData` is documented to **disable Chromium GPU acceleration after as few as 2 reads** unless `willReadFrequently: true` is set (Chromium issue 349853784, schiener.io 2024). Software-composite path is dramatically slower than `drawImage` on accelerated 2D canvas.
- Hard ceiling: real-world reports place Canvas2D sprite ceiling at ~1k–10k objects at 60fps on integrated GPU (js-game-rendering-benchmark; PixiJS v4 perf docs). 50k is out of reach.

**(b) WebGL2 instanced**
- Premultiplied-alpha trap (above). 1-day debug if missed.
- Atlas size cap: stay ≤4096×4096 per page; multi-page if needed.
- Instance attribute layout must fit in 16 vertex attributes. Star instance: position(2) + atlas-uv-rect(4) + color/tint(4) + size(1) + rotation(1) + flags(1) = 13 floats per instance, well under cap. Stream as a single interleaved `ArrayBuffer` updated each frame via `bufferSubData`.
- Per-frame attribute upload of 50k instances × 13 × 4 bytes = 2.6 MB. PCIe / unified-memory bandwidth on Iris Plus is not the bottleneck (≥10 GB/s); allocation churn in JS is — use a persistent Float32Array, not a fresh one per frame.
- Edge pass with line gradients: do not try to bake gradients per-instance; precompute a 1D gradient texture and sample by edge fraction in the fragment shader. Easy.
- Nebula radial gradients (150 of them): the win comes from **moving them off Canvas2D entirely** into a fragment shader that procedurally generates the radial falloff. ~30 LOC of GLSL. Otherwise you've left half the fill-rate problem on the CPU side.
- Pulsar/quasar animation overlay (pass 6): currently `createLinearGradient` *per frame per pulsar* — this is a known Canvas2D anti-pattern (gradients are not cheap to create). Replace with a uniform-driven shader; near-free on GPU.
- Label pass: keep on a separate Canvas2D layer (a stacked `<canvas>`) — text is the one thing where a layered Canvas2D beats reimplementing in WebGL2. Do not try to put text in the atlas; SDF text is a separate, large project.

**(c) WebGPU + render bundles**
- Render-bundle wins materialize at hundreds-to-thousands of *distinct* draw calls per frame. Star Palace's design has ~5–10. The per-frame `executeBundles` overhead reduction is single-digit microseconds.
- WGSL ≠ GLSL; either dual-author or use Naga/Tint translation. Naga has known SPIRV→WGSL translation bugs (Evergine 2025 release notes flag this).
- Async pipeline compilation: first-frame compile cost can exceed 200ms (utsubo.com 2026 report). Must warm pipelines on idle, not on theme switch.
- WebGL2 fallback still needed for Linux Firefox users (~2–5% tail). Doubles maintenance.
- The one scenario where WebGPU is the right answer: if you later want to move spatial-grid culling and per-instance attribute computation onto the GPU as a compute pass. That's an optimization to consider in v3, not in v1.

### 10. Expected p99 frame ms at 50k stars on the 2018 MBP

These are first-principles estimates, **not** measurements. They assume Chrome-current with hardware-accelerated 2D canvas working (i.e., the user is not in a fallback-to-software state).

| Target | p99 frame ms estimate | Confidence |
|---|---|---|
| Current Canvas2D | 35–90 ms (matching user's "not acceptable") | high |
| (a) Canvas2D + perfect batching | 25–60 ms | medium — Chromium already auto-batches, gains modest |
| **(b) WebGL2 instanced + nebula in shader** | **8–14 ms** | medium-high |
| (b) WebGL2 instanced, nebula still on Canvas2D | 18–30 ms (nebula fill rate dominates) | medium |
| (c) WebGPU instanced + render bundles | 7–13 ms | low — WebGPU 2D-sprite benchmarks are noisy and frequently regress vs WebGL2 |

The **8–14 ms** number for (b) is anchored to: (i) deck.gl ScatterplotLayer reports "fluid 60 fps up to 1M items" on a 2015 MBP with dedicated graphics — call it 100k items at 60fps on integrated, plenty of headroom for 50k; (ii) PixiJS ParticleContainer demonstrably hits 30k+ animated sprites at 60fps on integrated GPUs; (iii) the user has ~5 GL draw calls per frame at this design, dominated by fragment work for the nebulae.

### 11. Past perf work and why it didn't suffice

The DPR cap, LOD swap, anim skip, and idle prebuild (commits 7107ad5, fc7136b, 833652c, ba40dbc, 468d4b7) all attack the *symptoms* of bottlenecks without per-pass attribution. They will not be wasted under (b): DPR cap and idle prebuild become more important, not less, because nebula fill cost remains roughly the same and atlas building moves to idle. The "ultra" preset can finally start delivering on its name.

---

## Step-Sequenced Migration Plan for Target (b)

Each phase is reversible behind a feature flag (`renderer: 'canvas2d' | 'webgl2'`). Each phase has a measurement gate.

### Phase 0 — Per-pass instrumentation (precondition; ~1 day)

1. In `frameMetrics.ts`, add an array `passTimings: Record<PassName, RingBuffer<number>>`. Wrap each of the 11 passes in `StarMap.tsx` with `const t0 = performance.now(); /* pass */; metrics.record(name, performance.now() - t0)`.
2. Extend `PerfOverlay` to render a stacked-bar of pass costs at p50 and p99.
3. **Gate:** capture a 60-second profile at 50k stars on the target hardware, in steady-state pan/zoom and immediately after a theme switch.

This phase **may falsify the recommendation** — see "The Falsifying Experiment" below.

### Phase 1 — Atlas builder using the existing drawer contract (~2 days)

1. New file `src/renderer/src/render/atlas/AtlasBuilder.ts`: maintains an `OffscreenCanvas` (or `HTMLCanvasElement` if OffscreenCanvas is unavailable in worker) of 4096×4096, allocates rectangular tiles (shelf-pack or guillotine), invokes existing `ThemedDrawer`s into each tile.
2. New file `src/renderer/src/render/atlas/AtlasCache.ts`: replaces the LRU-500 sprite cache. Key = `${theme}:${type}:${sizeBucket}:${hashBucket}:${lod}`. Value = `{ pageIndex, u0, v0, u1, v1 }`.
3. **Atlas builds run on idle (`requestIdleCallback`) or in a Worker via OffscreenCanvas**, never blocking the rAF loop. First-load and theme-switch warm-up.
4. **Gate:** atlas covers 100% of typed sprites used in a 60-second pan; theme switch p99 (idle-time cost OK) does not freeze the rAF loop for >16 ms in any single frame.

### Phase 2 — WebGL2 context + star pass only (~3–4 days)

1. New file `src/renderer/src/render/gl/Context.ts`: `getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true })`.
2. New file `src/renderer/src/render/gl/StarProgram.ts`: vertex shader takes mat3 view transform + per-instance position/uv-rect/tint/size; fragment samples atlas, applies tint, multiplies alpha.
3. Replace pass 5 (star pass) only; keep all other passes on the existing Canvas2D context, layered as a separate `<canvas>` element behind the GL canvas (pass 1–4 on Canvas2D below; pass 5 on GL above; passes 6–11 back on a third Canvas2D above).
4. Wire instance buffer streaming: persistent `Float32Array(50000 * 13)`, `bufferSubData(0, view)` per frame, `drawArraysInstanced(TRIANGLE_STRIP, 0, 4, instanceCount)`.
5. **Gate:** at 50k stars in steady pan, pass-5 p99 drops from current value to ≤2 ms. Frame p99 improves by at least the delta. If pass-5 was not the dominant cost (per Phase 0), abort and reconsider.

### Phase 3 — Edge pass to GL (~2 days)

1. Edges currently use `lineGradient` strokes with additive blend. In GL: line geometry as 6-vertex thick-line quads, gradient sampled from a 1D LUT texture, `blendFunc(ONE, ONE)`.
2. **Gate:** edge p99 drops; visual diff against Canvas2D reference within tolerance.

### Phase 4 — Nebula radial gradients to GL fragment shader (~2 days)

1. Replace 150 `createRadialGradient`+`arc` calls with a single instanced quad draw using a procedural radial-falloff fragment shader (smoothstep over distance from instance center). Color stops as uniform array.
2. **Gate:** nebula p99 drops by at least 3×. This is where the largest absolute time win usually appears for fill-rate-bound scenes.

### Phase 5 — Decoration, animation overlay, lock-glyph (~2 days)

1. Pulsar/quasar animation overlay (pass 6): per-frame `createLinearGradient` becomes a uniform-driven shader pulse.
2. Decoration rings (pass 7): another instanced atlas draw, separate program if blend mode differs.
3. Lock-glyph (pass 10): same atlas pipeline.
4. **Gate:** all numbered passes either on GL or measurably negligible (<0.5 ms p99).

### Phase 6 — Keep on Canvas2D (intentional)

- **Pass 11 (labels):** keep as a stacked Canvas2D layer. Text is not worth porting.
- **Pass 8 (theme overlay / scanlines):** if simple, fold into the final GL composite as a fullscreen quad with a procedural pattern. If complex, keep as Canvas2D overlay.
- **Pass 9 (off-screen chevrons):** few enough to keep on Canvas2D label layer.

### Phase 7 — Cleanup and remove the Canvas2D path (~1 day)

After 2 weeks of soak-time on the GL path with the feature flag default-on, delete the Canvas2D star/edge/nebula code paths. The `ThemedDrawer` contract (now atlas-bound) and the label/overlay Canvas2D layers stay forever.

**Total estimate: 12–15 engineering days** for one engineer who has written GLSL before. Add 50% if not. This is consistent with the file-level LOC estimate above.

---

## The Falsifying Experiment

**One experiment, ~30 LOC, ~1 hour to implement, ~5 minutes to run. It either confirms (b) is correct or it flips the recommendation.**

**Build:** Add to `frameMetrics.ts` a per-pass timer that wraps each of the 11 numbered passes with `performance.now()` brackets (no GL timer queries needed; wall-clock is sufficient for this signal). Render a stacked-bar overlay with p50 / p99 / max for each pass over a sliding 600-frame window.

**Measure:** On the target hardware (2018 MBP 13", Iris Plus 655, Chrome current), at exactly 50,000 visible stars, for 60 seconds of continuous pan + zoom, capture per-pass p99.

**Decision matrix:**

| Observation | Diagnosis | Action |
|---|---|---|
| Pass 5 (star drawImage) p99 ≥ 40% of frame p99 | CPU draw-call bound. WebGL2 instancing is the right answer. | **Proceed with (b) as written.** |
| Passes 4 + 5 + 7 (star + edge + decoration) collectively ≥ 50% of frame p99, but pass 5 alone < 40% | Mixed CPU draw-call + edge stroke cost. WebGL2 still wins, but plan Phase 3 (edges) immediately after Phase 2. | **Proceed with (b), reorder phases.** |
| Pass 2 (nebula radial gradients) p99 ≥ 40% of frame p99 | Fill-rate bound on nebulae. WebGL2 wins **only if** Phase 4 ships. Do not stop after Phase 2. | **Proceed with (b), but Phase 4 becomes mandatory; do not declare success at Phase 2.** |
| Pass 1 + Pass 8 (clear/backdrop + theme overlay) collectively ≥ 30% of frame p99 | Full-screen fill-rate bound. DPR cap is the cheapest win available. WebGL2 alone won't help these passes. | **Reduce DPR before/in addition to migration.** Consider whether the user's perception problem is actually solvable at DPR 1.5 on Canvas2D. |
| Theme-switch frame > 200 ms but steady-state frame OK | Sprite-build bound, not render bound. The renderer rewrite is the wrong project. | **Falsify (b). Move sprite generation to Worker + OffscreenCanvas; skip the renderer migration entirely.** |

**The single number that flips the recommendation:** if `p99(pass_5) + p99(pass_4) + p99(pass_7) < 0.30 × p99(frame)`, then migrating just the star/edge/decoration passes to WebGL2 cannot lift frame p99 below 16.7 ms. The recommendation flips toward either (i) staying on Canvas2D and aggressively cutting overdraw + DPR (cheap, low ceiling), or (ii) committing to a *full* GL pipeline including nebulae and overlays (Phases 4 and 5 become mandatory, not optional).

---

## What Cannot Be Answered Without the Profile

This document is honest about its conditional structure. The following claims are **conditional** on the per-pass profile coming out as expected (star/edge/decoration-dominated):

1. The 8–14 ms p99 estimate for (b). If fill-rate dominates, that number is more like 14–22 ms unless Phase 4 also ships.
2. The "Phase 2 alone is a meaningful win" claim. If pass 5 is <30% of frame time, Phase 2 will look like a wash on the perf overlay and the team will lose confidence. Plan Phase 4 in lockstep.
3. The "drawer files untouched" property. True for option-(ii) atlas baking *as long as* every drawer's output is deterministic per `(theme, type, sizeBucket, hashBucket, lod)` tuple. If any drawer reads from a closure-captured time/random source that varies across calls, the cache key needs to extend to that source, or the drawer needs a pure-output refactor. A 30-minute audit of both drawer files for non-deterministic inputs is part of Phase 1.
4. The premise that the user's machine is using accelerated Canvas2D in the first place. If telemetry or `chrome://gpu` shows the canvas falling back to software rendering (a known macOS path under specific driver/feature-flag combinations), the *current* Canvas2D numbers are pessimistic and (a) might be unexpectedly viable. The Phase 0 profile should also note `chrome://gpu` state.

## Opposing View Worth Surfacing

A defensible counter-recommendation is **"do not migrate; reduce ambition."** The current quality settings and DPR cap have not been tuned with per-pass attribution. It is plausible — though not provable without the profile — that capping DPR at 1.25, halving nebula count at "high", and moving the FBM ImageData drawer to a Worker with OffscreenCanvas would move p99 under 16.7 ms without any renderer rewrite. This path is ~3 engineering days vs ~15. If the user's actual quality bar is "60 fps at 20k stars, graceful degradation above," it is the right answer. If the bar is "60 fps at 50k+, headroom for richer effects," the WebGL2 migration is the right answer. The Phase 0 profile distinguishes these two worlds.

## Caveats

- All p99 frame-time estimates are first-principles, not measured. The user has explicitly noted no real Performance-tab profile exists; the recommendation rests on a profile that has not yet been captured.
- Iris Plus 655 fillrate (6.3 GPx/s, 50.4 GTx/s) is a hardware spec from TechPowerUp/cpu-monkey, not a WebGL2 measurement. Real WebGL2 throughput on macOS through ANGLE/Metal is typically 60–80% of theoretical due to driver/translation overhead.
- WebGPU vs WebGL2 sprite-benchmark data in 2024–2026 is genuinely contested. The Babylon.js team's published numbers (gpuweb #1596) show WebGPU losing on CPU time without bundles; PixiJS v8 docs explicitly warn that WebGPU is not automatically faster. Marketing material claiming "1000% improvement" (markaicode.com, 4dpipeline.com) is for compute-bound 3D workloads, not 2D sprite rendering, and should be discounted.
- The 2018 13" MBP with Iris Plus 655 is the *upper* spec of 2018-era integrated graphics on macOS. Older Intel HD 5xx/6xx machines (2015–2017 MBPs) have roughly half the fillrate. If the actual user audience extends there, halve the fill-rate budget in all calculations.
- "Chromium-current" was assumed per the brief. If the audience includes Safari, note that Safari's WebGL2 implementation goes through Metal and has historically had slower instance-attribute upload performance than Chrome on the same hardware.
- The "13–14 ms" pass-budget arithmetic assumes Skia's accelerated canvas path is engaged. If `chrome://gpu` shows software 2D canvas (which can happen under driver blocklisting), the entire baseline is shifted and all relative comparisons need to be redone.
- Atlas size limits assume Chrome on macOS reports 16384. Field-deployed Firefox on older macOS versions has reported 4096 (Mozilla bug 1310222). Pin atlas-page dimensions at 4096 to be safe across the long tail; do not architect around 8192+.