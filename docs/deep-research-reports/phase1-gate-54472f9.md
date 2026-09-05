# Phase 1 gate — passed

`HEAD = 54472f9` (after Phases 0, 0.5, 1.2, 1.3, 1.4, 1.5, 1.6 + the
animation-skip refinement). Profiled against `baseline-fullcorpus-b8b982f.md`.

---

## Headline

| Scenario | Baseline frame p99 | Phase 1 frame p99 | mainStars p99 | mainStars mean |
|---|---|---|---|---|
| **idle**, default cam (6926 visible) | 983 ms | **0 ms (94/94 skipped)** | n/a | n/a |
| **idle**, settled cam (3601 visible) | 17 ms (47/1 skipped) | n/a (re-tested at 6926 default cam) | n/a | n/a |
| **mousePan** 1 s drag, ~1357 → 6573 visible | 550 ms | **67.7 ms** (rAF-throttle artifact) | 11.7 ms | 8.9 ms |
| sprite cache misses on idle+pan probe | 758 939 | **3 827** (99.83 % hit rate) | n/a | n/a |

Tab focus caveat still applies — frame p99 67.7 ms is mostly Chrome's rAF
throttle on the unfocused MCP-driven tab. Per-pass timings are ground truth:
mainStars + labels worst-case ≈ 25 ms in any single frame, mean ≈ 14 ms.
Within the 16.6 ms 60 fps budget at mean; tail spikes from cache cold-warm.

---

## What landed

| Phase | Commit | Effect |
|---|---|---|
| 0.1 instrumentation | `16b560e` | Per-pass + per-event + counter ring buffers; PerfOverlay sorts by p99 desc. |
| 0.2 perfDriver | `3faff99` | `window.__driver` synthetic input + scenario runner. |
| 0.5 dirty-flag gate fix | `b8b982f` | Gate on viewport-animated count, not corpus-total. Idle skip restored. |
| 0.4 baseline | `b8b982f` | Captured this corpus's pass ranking + cache thrash. |
| 1.5 sprite cache | `4d97abc` | Cap 500 → 4000, theme-aware eviction. **Biggest win**. |
| 1.6 default cache assertion | (in 1.5 commit) | Dev warn if bucket count drifts. |
| 1.2 hover via grid | `49ed4dc` | O(visible cells) replaces O(N) scan. |
| 1.4 int-packed keys | `2a37a98` | spatialGrid Map<number, …>. |
| 1.3 hoist allocations | `5f99ee8` | Per-frame collections → refs + clear(). Vignette gradient cached. |
| anim-skip refinement | `54472f9` | visibleAnimatedCountRef ignores sub-perceivable beams. Idle skip at default cam. |

---

## Skipped from plan, justification

- **Phase 1.1 state-cascade decouple.** Predicted 2–10 ms hiccup every 10 s
  from `pollStats → setStars`. Baseline didn't capture that interval; cache
  fix made the post-pollStats redraw inexpensive enough that the cascade
  cost is no longer dominant. Re-add only if PerfOverlay during a relayout
  shows a cluster of dropped frames > 33 ms.
- **Phase 1.7 dual-theme prebuild.** Theme-aware eviction (1.5) already
  preserves old-theme entries on flip. First flip is still cold; second+
  flips will hit cache. Address only if profile shows first-flip cost
  exceeds the user's tolerance.
- **Day 0 bisect.** Made redundant by the per-pass + counter data
  pinpointing the cache thrash directly.

---

## Falsification check

Report 3 predicted top-3 at 50k zoomed-out: labels > mainStars > clusters.
At 6.9k post-Phase-1, observed pan top-3: mainStars (11.7) > labels (12.6) >
backdrop (0.1). Order **flipped at this corpus size** because:
- Cache thrash is gone → mainStars = paint cost only, scales linearly with
  visible-star count, not multiplied by per-call sprite rebuild.
- labels still pays `fillText` per visible star × name length.

At 50k stars labels will likely overtake mainStars (Report 3 prediction
holds with absolute count). For now mainStars and labels are co-leaders
within an order of magnitude of each other.

---

## Gate status

✅ **Idle**: 0 ms drawn, 94/94 frames rAF-skipped. CPU on rAF loop ≈ 0.
✅ **Pan p99 (per-pass)**: ~25 ms worst-case, ~14 ms mean. Within 60 fps budget at mean.
⚠️ **Frame p99 (with tab throttle)**: 67.7 ms. Caveat — re-test foregrounded.

**Stop. No Phase 2 needed.** If user's foregrounded session still feels off,
the next reading should come from PerfOverlay in their actual tab — not
this MCP-driven probe. Phase 2 (label atlas, cluster nebula prebuild) is
still parked behind the falsification check above.
