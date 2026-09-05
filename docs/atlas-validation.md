# Atlas validation — September 4, 2026

Reference machine: Apple M4, 16 GiB RAM, macOS/Darwin 25.5.0, Node 22.17.0, Chrome 151.0.7922.174, 1440 × 960 CSS pixels at DPR 2. Browser measurements used a **production build in a visible foreground window**. Development-browser regression tests are separate from these timings.

## What shipped

A persistent hierarchy covers every indexed file, including media and files without embeddings. The default workspace has scoped names/text/related search, readable results, map/list/grid navigation, an expandable reader, saved places and cameras, world-coordinate pins, region names, snapshots, sources, collections, file tags, and manual celestial classifications. The original application remains accessible at `?view=classic`.

File types are intermixed. A shared object atlas supplies ordinary-scale artwork. Zooming into files generates deterministic per-file artwork in a cache limited to 16 sprites; at most two new close-up sprites are generated per frame. GPU and Canvas use the same artwork. Rendering stops when the scene is idle, and WebGL context loss switches to Canvas.

## Data integrity and interaction checks

The fresh isolated backup contained **1,748 files**, including **613 without embeddings**. All 1,748 received atlas positions in 368ms total, in batches whose longest measured slice was 10.6ms. The result has 45 regions and 207 neighborhoods, each at most 96 files, with no duplicate coordinates. Hash comparisons of the complete original file rows, collections, and collection memberships remained identical. This was a copy; the primary database was never migrated. See [migration results](validation/migration.json).

Tests cover insertion/reindex/pin/delete/restart stability; mixed file types; repeated upserts before the dirty queue drains; stale extraction; scoped lexical/vector retrieval; late passages; literal punctuation; tags; snapshot restoration; metadata appearing before a delayed embedding; off-thread PCA and rejection of stale training results; bounded extraction; and graceful model failure.

The browser suite covers find → preview → read → return, ordinary typing, stale request cancellation, late-document highlighting, image zoom, virtualized CSV rows, themes, saved places, small windows, keyboard-accessible dialogs, object classifications, zoomed per-file identity, bounded detail caching, and GPU failure recovery.

Latest checkpoint: typecheck and lint pass; **404 unit/integration tests pass, 3 fixture-dependent graphics checks skip** because the historical audit corpus is absent from the worktree. **11 browser tests pass**. The pre-existing legacy HTTP contract suite remains opt-in due to its native teardown crash; the new HTTP tests use the extracted router and run in the default suite.

## Foreground rendering

The production map loads region summaries first. It does not send every file or embedding to the browser. The synthetic 100k corpus produces 2,904 overview sprites; individual neighborhoods load at most 96 files.

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

- The provisional whole-renderer memory target is not demonstrated. Browser JS heap was about 6–20 MiB in these traces, but that omits native/GPU allocations. Summed RSS across the benchmark browser's three renderer processes was approximately 500–550 MiB; it is not a reliable measurement of the active page alone. Explicit sprite storage is bounded at approximately 13 MiB across CPU/GPU, plus viewport buffers and point data.
- Whole-application cold startup, model latency, OS caches, large image decoding, and indexing concurrently with browsing have not been established as percentile gates. The foreground pan tests and backend measurements above should not be presented as those measurements.
- Text extraction covers up to 2 MiB; PDF/DOCX containers above 32 MiB stay metadata-only. Scanned PDFs require external OCR. Extraction happens in a bounded worker; explicit failed previews can retry when a drive becomes available.
- Regions use persistent source/folder context and existing semantic edges, rather than a newly fitted UMAP. New insertions preserve existing coordinates. Legacy PCA pins remain preserved in the classic workspace and are archived on atlas migration; new atlas pins use their own world coordinates.
- Path-derived IDs retain the existing rename/move limitation. Moving an original file is not a guaranteed identity-preserving operation.

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
```

The full browser benchmark also reads `.atlas-real/scene.json`, created by `scripts/audit-atlas.ts` from an isolated `.atlas-real/index.db` backup. Never point the audit at the primary database. Reports and screenshots containing library labels remain in ignored local directories; the committed JSON above contains aggregate timings only.
