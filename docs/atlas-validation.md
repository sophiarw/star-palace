# Atlas validation — September 4, 2026

Reference machine: Apple M4, 16 GiB RAM, macOS/Darwin 25.5.0, Node 22.17.0, Chrome 151.0.7922.174, 1440 × 960 CSS pixels at DPR 2. Browser measurements used a **production build in a visible foreground window**. Development-browser regression tests are separate from these timings.

## What shipped

A persistent hierarchy covers every indexed file, including media and files without embeddings. The default workspace has scoped names/text/related search, readable results, map/list/grid navigation, an expandable reader, saved places and cameras, world-coordinate pins, region names, snapshots, sources, collections, file tags, and manual celestial classifications. The original application remains accessible at `?view=classic`.

File types are intermixed. A shared object atlas supplies ordinary-scale artwork. Zooming into files generates deterministic per-file artwork in a cache limited to 16 sprites; at most two new close-up sprites are generated per frame. GPU and Canvas use the same artwork. Rendering stops when the scene is idle, and WebGL context loss switches to Canvas.

## Data integrity and interaction checks

The current organic-layout correction and its measurements are described below. The initial migration and earlier performance figures are retained as historical checkpoints.

The fresh isolated backup contained **1,748 files**, including **613 without embeddings**. All 1,748 received atlas positions in 368ms total, in batches whose longest measured slice was 10.6ms. The result has 45 regions and 207 neighborhoods, each at most 96 files, with no duplicate coordinates. Hash comparisons of the complete original file rows, collections, and collection memberships remained identical. This was a copy; the primary database was never migrated. See [migration results](validation/migration.json).

Tests cover insertion/reindex/pin/delete/restart stability; mixed file types; repeated upserts before the dirty queue drains; stale extraction; scoped lexical/vector retrieval; late passages; literal punctuation; tags; snapshot restoration; metadata appearing before a delayed embedding; off-thread PCA and rejection of stale training results; bounded extraction; and graceful model failure.

The browser suite covers find → preview → read → return, ordinary typing, stale request cancellation, late-document highlighting, image zoom, virtualized CSV rows, themes, saved places, small windows, keyboard-accessible dialogs, object classifications, zoomed per-file identity, bounded detail caching, and GPU failure recovery.

Latest checkpoint: typecheck and lint pass; **412 unit/integration tests pass, 3 fixture-dependent graphics checks skip** because the historical audit corpus is absent from the worktree. **15 browser tests pass**. The pre-existing legacy HTTP contract suite remains opt-in due to its native teardown crash; the new HTTP tests use the extracted router and run in the default suite.

## Earlier foreground rendering baseline

These figures describe the earlier region-summary renderer, before the real-library continuity and organic-layout corrections. They are retained for comparison, not presented as measurements of the final camera/label behavior. That renderer used 2,904 overview sprites for the synthetic 100k corpus.

| Corpus | GPU frame p95 / p99 | Canvas frame p95 / p99 | GPU draw p95 |
|---|---:|---:|---:|
| 10k | 17.3 / 17.6ms | 17.5 / 17.6ms | 0.7ms |
| 50k | 17.2 / 17.6ms | 16.8 / 17.3ms | 0.9ms |
| 100k | 17.2 / 17.5ms | 16.8 / 17.0ms | 1.1ms |

A final check after improving dense-label layout measured GPU p95/p99 of **17.2/17.5ms at 100k** and **17.6/17.7ms on the real-library summary**. No >50ms long tasks were recorded during those pan traces. The input-to-two-animation-frames proxy was about 33ms; that is a scheduling proxy, not a hardware input-to-photon measurement.

A separate stress comparison draws every celestial object, bypassing the hierarchy:

| Objects drawn | GPU frame p95 | Canvas frame p95 |
|---|---:|---:|
| 10k | 17.2ms | 16.8ms |
| 50k | 17.5ms | 83.4ms |
| 100k | 17.6ms | 135.2ms |

This supports the GPU default. Canvas remains smooth for the bounded production overview. These are comparisons with the new simplified Canvas renderer, not claims about measured speedups against the historical classic application.

Source data: [foreground trace summaries](validation/foreground.json) and [final label/memory check](validation/foreground-final-labels.json). The harness intercepts API responses with recorded corpus summaries, so the reported 44–118ms warm navigation times isolate renderer startup and fixture delivery; they are **not end-to-end cold daemon startup measurements**.

## Search and indexing

The fixture uses 768-dimensional normalized vectors and about 1 KiB of text per file. Search timing includes SQLite retrieval and result construction, but excludes the browser's 25ms lexical debounce, transport, and DOM rendering. Each lexical query has 25 samples. Filename/path lookup uses the [SQLite FTS5 trigram index](https://www.sqlite.org/fts5.html#the_trigram_tokenizer); text uses overlapping FTS5 passages. Scope applies before the result limit.

| Corpus | Exact filename p95 | Late phrase p95 | Common text p95 | No-match p95 |
|---|---:|---:|---:|---:|
| 10k | 1.7ms | 3.5ms | 7.4ms | 0.1ms |
| 50k | 5.8ms | 5.3ms | 28.1ms | 0.1ms |
| 100k | 12.5ms | 8.9ms | 59.5ms | 0.4ms |

Before the trigram optimization, common-text search at 100k measured 170.6ms p95. Initial fixture construction, including metadata/positions/passages/vectors, took about 38 seconds cumulatively to reach 100k, yielding between batches. This is a background build, not the time to open an established atlas. See [backend measurements](validation/backend.json).

A separate 100k exact-vector scan measured **229ms warm p95** across 11 warm samples; the first cold scan took 1,695ms. Query embeddings were supplied by a deterministic fixture, so **model inference time is excluded**. Production caches query embeddings, yields between vector batches, and shows lexical results before semantic enrichment. See [semantic scoring samples](validation/semantic-warm.json).

## Practical limits

- The provisional whole-renderer memory target is not demonstrated. Browser JS heap was about 6–20 MiB in these traces, but that omits native/GPU allocations. Summed RSS across the benchmark browser's three renderer processes was approximately 500–550 MiB; it is not a reliable measurement of the active page alone. Explicit sprite storage is bounded at approximately 13 MiB across CPU/GPU. The density glow adds one 4 MiB CPU raster, plus its viewport canvas; point buffers and other viewport buffers are additional.
- Whole-application cold startup, model latency, OS caches, large image decoding, and indexing concurrently with browsing have not been established as percentile gates. The foreground pan tests and backend measurements above should not be presented as those measurements.
- Text extraction covers up to 2 MiB; PDF/DOCX containers above 32 MiB stay metadata-only. Scanned PDFs require external OCR. Extraction happens in a bounded worker; explicit failed previews can retry when a drive becomes available.
- The current layout retains the original PCA structure where available and uses graph/folder relationships for unprojected files. Regions annotate these positions. New insertions preserve existing coordinates. Legacy PCA pins remain preserved in the classic workspace and are archived on atlas migration; new atlas pins use their own world coordinates.
- Path-derived IDs retain the existing rename/move limitation. Moving an original file is not a guaranteed identity-preserving operation.

## Current organic layout and continuous navigation

The copied library contains 1,748 real markers. All 1,135 projected files use the original semantic layout at a fixed scale: 1,113 retain their exact scaled coordinates, and 22 receive small local adjustments to separate near-coincident positions (maximum 31.2 units across a roughly 20,000-unit span). The 613 unprojected files use graph neighbors or the nearest folder with projected files; a deterministic irregular cloud is the fallback when a source has no projection. No geometric grid or spiral pattern is imposed. The density glow follows these actual points. File rows, including metadata, were identical before/after reshaping; the primary library remains unchanged. See [organic layout audit](validation/organic-audit.json).

Scrolling now changes one camera. It never changes navigation scope or restores another camera. Metadata loads by bounded spatial viewport (up to 12 requested tiles, 500 files each, 24 cached tiles), and the overview carries at most 4,096 actual file samples for larger libraries. Files stay at the same world coordinates as their labels and detailed art become available. Headings retain their slots, fade, and do not reorder on hover. Returning home explicitly fits the full galaxy; offscreen selections cannot redirect the zoom buttons.

A real-library sequence of 24 zoom-in and 24 zoom-out gestures reached approximately 19× world scale from 0.029, preserved the pointer anchor to less than 0.000001 CSS pixels, and returned to its starting camera. This is a numerical continuity check, not an FPS measurement. See [zoom continuity](validation/continuity.json). Browser tests also cover delayed viewport responses, pixel-identical headings during hover, idle rendering, home, and offscreen selections.

The updated foreground overview check used the production renderer and recorded API fixtures: GPU frame p95/p99 was **18.2/18.6ms at 100k** (3,132 real sample markers) and **18.6/18.7ms for the 1,748-file organic map**. No >50ms long tasks were observed. These are frame intervals on the test display, not evidence of a strict 16.7ms p95 gate. See [updated overview measurements](validation/organic-foreground.json).

A refreshed synthetic backend run reached 100k in 47.3 seconds cumulatively, with filename/common-text search p95 of 12.4/59.2ms. The first recorded 100k summary took 57.6ms with real marker retrieval; a subsequent optimization removed the unnecessary full-file join for unfiltered samples. That summary optimization is not included in the recorded timing. See [updated backend run](validation/organic-backend.json). Those results and the initial navigation measurement overlapped in time on this machine; the final live navigation measurement below was run separately.

The latest production navigation trace uses the live copied library, with no API interception, in foreground Chrome at 1500×1000 and DPR 2. It covers the complete zoom-in/zoom-out path, real metadata loading, label transitions, and procedural detail. GPU frame p95/p99 was **18.2/18.6ms**, Canvas **18.6/18.7ms**, with no >50ms long tasks in either trace. See [live navigation measurements](validation/navigation-performance.json). Whole-application memory and cold startup limits still apply; these checks do not establish those gates.

## Reproduce

```sh
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run benchmark:atlas
VITE_DAEMON_PORT=7374 npm run build:web
npx vite preview --config vite.web.config.ts --host 127.0.0.1 --port 5175
# Separate terminal; opens a visible Chrome window.
npm run benchmark:atlas:browser
# For the live copied-library navigation check, build with VITE_DAEMON_PORT=7376:
node scripts/benchmark-atlas-navigation.mjs
```

The full browser benchmark also reads `.atlas-real/scene.json`, created by `scripts/audit-atlas.ts` from an isolated `.atlas-real/index.db` backup. Never point the audit at the primary database. Reports and screenshots containing library labels remain in ignored local directories; the committed JSON above contains aggregate timings only.

The organic review scene is `.atlas-real/zoom-feedback/scene.json`. To use it in the overview benchmark, set `ATLAS_BENCH_REAL_SCENE` to that path. Older fixtures without real markers must be regenerated; the harness rejects them.
