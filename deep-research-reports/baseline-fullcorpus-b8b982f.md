# Baseline profile — full corpus, b8b982f (after Phase 0)

Captured via `window.__driver.runScenario(...)` from claude-in-chrome MCP.

- **Corpus**: user's `~/.starpalace/index.db`, 7822 stars / 6955 with embeddings.
- **Tab focus**: not foregrounded (Chrome rAF-throttled to ≤30 fps for unfocused tabs). Treat absolute timings as relative comparison only.
- **Build**: dev (`npm run dev:web`), DEV-only per-pass instrumentation active.
- **Quality**: `high` (default); `medium`-LOD threshold for cheap sprite at < 6 px.
- **Caveat**: cam fitted by `didFitOnce` between scenarios (selection / pan / search animation), so the visible-star count drifts (3601 idle → 1357 mid-pan → 6738 first wide view). Use this baseline to compare against post-fix runs at the *same* cam state, not as ground-truth absolute numbers.

---

## Scenario: idle (zoomed-out, ~6738 visible) — first capture before fitAll settled

| Metric | Value |
|---|---|
| fps | 1.2 |
| avg ms | 830.5 |
| p50 ms | 900.1 |
| p99 ms | 983.4 |
| worst ms | 983.4 |
| dropped (>33ms) | 6 / 6 |
| skipped (rAF gate) | 0 |
| visibleStars | 6738 |

Top 3 passes by p99:

| Pass | p99 ms | mean ms | n |
|---|---|---|---|
| `07.mainStars` | 975.3 | 833.5 | 6 |
| `14.labels` | 14.8 | 9.4 | 6 |
| `02.backdrop` | 0.1 | 0.02 | 6 |

**Diagnosis**: at zoom=1 with stars distributed over [-500, 500] world units, the entire corpus is in the viewport. Spatial grid visits all cells; `drawMainStar` runs 6,738 times. mainStars dominates p99 by ~70× over labels. Paint-bound on sprite blits.

---

## Scenario: idle (~3601 visible, settled cam)

| Metric | Value |
|---|---|
| fps | 58.5 |
| avg ms | 17.1 |
| p99 ms | 17.1 |
| skipped (rAF gate) | 47 |
| frameCount | 1 |
| visibleStars | 3601 |

Top 3 passes by p99:

| Pass | p99 ms | mean ms | n |
|---|---|---|---|
| `07.mainStars` | 83.5 | 83.5 | 1 |
| `14.labels` | 2.0 | 2.0 | 1 |
| `08.animOverlay` | 0.1 | 0.1 | 1 |

**rAF gate working** — 47 skipped vs 1 drawn at idle (Phase 0.5 fix from this commit).

Counters (cumulative since reset):

| Counter | Value |
|---|---|
| `spriteCache.default.size` | 0 |
| `spriteCache.default.misses` | 0 |
| `spriteCache.default.hits` | 0 |
| `spriteCache.typed.size` | 500 (== cap) |
| **`spriteCache.typed.misses`** | **758,939** |
| `spriteCache.typed.hits` | (truncated, but ≪ misses) |

**Cache thrash confirmed.** Cap=500, misses=758,939. Validates Report 4 prediction. Phase 1.5 (cap → 4000 + theme-aware eviction) is the highest-leverage fix from here.

---

## Scenario: mousePan (1 s drag, dx=600, ~1357 visible)

| Metric | Value |
|---|---|
| fps | 5.4 |
| avg ms | 184.8 |
| p50 ms | 183.4 |
| p99 ms | 550 |
| worst ms | 550 |
| dropped (>33ms) | 8 |
| skipped (rAF gate) | 5 |
| frameCount | 13 |
| visibleStars | 1357 |

Top 3 passes by p99:

| Pass | p99 ms | mean ms | n |
|---|---|---|---|
| `07.mainStars` | 359.7 | 159.8 | 13 |
| `14.labels` | 6.6 | 2.8 | 13 |
| `04.clusters` | 0.1 | 0.04 | 13 |

**Pan is paint-bound on mainStars.** 1357 visible stars × ~120 µs/star = 160 ms mean. Sprite cache thrashing during pan (visible region changes → new (themeId, type, sb, hashBucket) tuples not in cache → sprite rebuild on hot path).

---

## Falsification check vs Report 3 prediction

Report 3 predicted top-3 at 50k zoomed-out:
1. labels (`fillText`)
2. mainStars
3. clusters

Observed at 6.7k zoomed-out:
1. **mainStars** (975 ms p99) — dominant
2. labels (14.8 ms)
3. backdrop (0.1 ms)

Order **different** from prediction at this corpus size. mainStars dominates by ~70×. Likely because:
- corpus only 6.7k, not 50k → labels haven't yet scaled to dominate.
- sprite cache thrash multiplies main-pass cost beyond Skia paint time alone.

Implication: **fix the sprite cache before assuming Report 3's ranking** holds. Re-profile after Phase 1.5.

---

## Action items in priority order

1. **Phase 1.5** — sprite cache cap → 4000 + theme-aware eviction. Predicted to drop main-pass p99 by 2–6 ms via reduced thrash, plus near-zero second theme-flip.
2. **Phase 1.1** — state-cascade decouple. Per-pass shows mainStars is paint cost, not memo overhead, but the 10 s `pollStats` re-render still forces a full draw of the same 6.7k stars.
3. **Phase 1.2** — O(visible) hover via grid. Linear scan over 6.7k on every mousemove is 30–300 ms/s of main-thread time during pan; not measured here yet but predicted.
4. **Re-profile** after each. Stop if interacting p99 < 25 ms.

If 1.5 + 1.1 + 1.2 don't crack the main-pass p99 budget at zoom=1 / 6.7k visible, Phase 4 (WebGL2 instanced) is the only remaining lever — at this corpus size, paint-time alone (no thrash) is on the order of `6.7k × ~10 µs = 67 ms` per frame, still >16.6 ms.
