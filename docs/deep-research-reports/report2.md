# Star Palace: Daemon-Side & Wire-Format Optimization Review

## TL;DR
- **The framing in subquestion 1 is probably wrong as a p99 frame-cost diagnosis.** `/api/map/all` runs once at startup; it cannot dominate steady-state p99 frame cost. The real renderer-side hot path is the `setStars(prev => prev.map(...))` cascade that fires on every `layoutVersion` bump (Q2). Optimize state shape and the position-delta path first; only then revisit `/api/map/all` and PCA.
- **The single highest-leverage daemon change is splitting positions out of the Star object graph and shipping them as a `Float32Array` over a binary endpoint** (`/api/positions/since` and the position slice of `/api/map/all`), backed by a Zustand store with `useSyncExternalStore` selectors. This kills the `setStars` reference churn and lets `starsById`, `projectedStars`, and `percentileBuckets` stop firing on every layout tick.
- **Skip MessagePack/FlatBuffers/Cap'n Proto for the bulk path.** On loopback in V8, JSON.parse is roughly competitive with userland MessagePack/CBOR decoders and faster than schema-full alternatives that require generated code paths in JS. The win comes from eliminating object allocation, not from a smarter schema language — i.e., a custom typed-array layout for the numeric columns plus JSON for the small categorical sidecar.

---

## Important caveat about this review
**I do not have access to the actual `src/daemon/index.ts`, `FileIndex.ts`, `Relayouter.ts`, `Pca.ts`, `Insert.ts`, `App.tsx`, or `CLAUDE.md`.** Every claim below is either:
- **(A)** reasoning from the architectural description you provided, or
- **(L)** reasoning from documented behavior of the libraries (`hnswlib-node`, `better-sqlite3`, `ml-pca` / `ml-matrix`, V8, React 18), or
- **(B)** benchmarks from public sources.

I tag each recommendation. Anything labeled **(A)** is a hypothesis you should confirm with a profiler before acting.

---

## Ranked daemon-side changes

Ordering criterion: **(estimated renderer p99 reduction) ÷ (implementation cost)**, where "renderer p99 reduction" is the impact during the typical hot loop (typing in search + occasional layoutVersion bumps + steady polling).

### 1. Split positions from the Star object graph; ship them as a `Float32Array` and store them outside React state. **(Highest leverage; recommended.)**

**Diagnosis (A):** `setStars(prev => prev.map(...))` rebuilds the array reference. Even if individual Star objects are referentially patched in place, every downstream `useMemo` that has `stars` in its dependency array re-fires. With 50k stars, `starsById` rebuilds an O(N) Map, `projectedStars` runs an O(N) projection, and `percentileBuckets` does an O(N log N) sort. None of these depend on metadata changes — they depend on positions. So you're paying an O(N log N) cost on the React commit thread every time the daemon bumps `layoutVersion`, which happens on every relayout-threshold cross.

**Change:**
- Store positions in a `Float32Array(N*3)` indexed by a dense int32 row id. Keep a `Map<starId, rowId>` once.
- Put this typed array in a Zustand store (or a plain external store with `useSyncExternalStore`). The Star metadata (id, cluster_id, name, etc.) lives in a separate store keyed by `metadataVersion`, which changes very rarely.
- `/api/positions/since` returns `{rowIds: Int32Array, xyz: Float32Array}` as `application/octet-stream` (see binary protocol sketch below). The renderer mutates the `Float32Array` in place and bumps a `positionsVersion` integer in the store.

**What stops firing under this change (A):**
- `starsById`: stops firing on layoutVersion bumps. It only depends on the metadata store (which is essentially append-only).
- `projectedStars`: still has to recompute, but it now reads from a typed array (no per-star property lookup, no hidden-class deopt) and can be selector-scoped to *only* the components that visualize positions — not the entire tree. The `useMemo` becomes a `useSyncExternalStore` selector that returns a stable reference when `positionsVersion` hasn't changed for the visible window.
- `percentileBuckets`: this is the one to scrutinize. If buckets are computed over a positional/distance metric, you can keep an incremental order-statistics sketch on the daemon (e.g., t-digest in Node, or just precomputed quantile breakpoints sent as 16 floats in the same response). Then the renderer does an O(visible) bucket lookup, not an O(N) sort.

**Confidence: High** that this fixes the p99 frame issue. The React rebuild cascade is the textbook failure mode for this exact pattern, and the Zustand/`useSyncExternalStore` selector pattern is the standard fix (`useStore` internally uses `useSyncExternalStoreWithSelector` and only re-renders when the selected slice fails `Object.is`).

**Cost: Medium.** Touches App.tsx, all consumers of `stars`, and `/api/positions/since`. ~1–2 days of refactor. The risk is wrong selectors that return new object references and cause infinite renders — this is the canonical `useSyncExternalStore` footgun. Use `useShallow` or memoize the snapshot in a ref.

---

### 2. Move `/api/stats` and `layoutVersion` notification from polling onto SSE. **(High leverage, low cost.)**

**Diagnosis (A):** Every 10s poll forces a JSON.parse + setState on the renderer even when nothing changed. If `App.tsx` does `setStats(json)` unconditionally, that triggers an `App` re-render and any consumer of `stats` re-renders too. Worse, if the response contains a new `layoutVersion`, you immediately follow with `/api/positions/since`, then the `setStars` rebuild — i.e., the 10s poll is a guaranteed rebuild jitter source even when the user is idle.

**Change:** Multiplex `layoutVersion`, `metadataVersion`, and lightweight stats counters onto the existing SSE stream that already exists at `/api/index/progress` (commit 760b6a3). One stream, named events:
```
event: stats
data: {"indexed": 1234, "queued": 5}

event: layout
data: {"version": 42, "thresholdCrossed": "10k"}

event: progress
data: {...existing progress payload...}
```
Renderer subscribes once, dispatches by event name. `EventSource` auto-reconnects. No new infrastructure.

**Why not WebSocket:** Single client, one-way push, already have SSE. WebSocket buys you nothing here and costs you a frame protocol library.

**Why not a separate stream:** HTTP/1.1 connection cap is moot on loopback and irrelevant at one client, but two streams doubles the keepalive and reconnection plumbing for zero gain.

**Confidence: High** for the protocol choice. SSE is the correct primitive for this use case (one-way, server-push, infrequent events, native reconnect with `Last-Event-ID`).

**Cost: Low.** ~50 LOC daemon-side, ~30 LOC renderer.

**Caveat (A):** if the renderer currently uses polling because the Express stream handler isn't holding the connection correctly (e.g., compression middleware buffering), you'll need to disable compression on `text/event-stream` and call `res.flushHeaders()`.

---

### 3. Stop calling `setStars(prev => prev.map(...))` even before doing change #1. **(Quick win.)**

**Diagnosis (A):** Even within React's normal model, you do not need a new array reference to deliver patched objects to memoized children. If the consumers use a Map keyed by id, you can use `setStarsById(prev => { const next = new Map(prev); next.set(id, patched); return next; })` and skip the array entirely. Better: stop using `useState` for this at all (see #1).

If you must keep the array shape, at minimum: split state. `setPositions(positionsArray)` + `setMetadata(metadataArray)` cuts the cascade by half because metadata-dependent memos no longer invalidate on position deltas.

**Confidence: High.**
**Cost: Low** (intermediate fix while #1 lands).

---

### 4. Audit and add SQLite indices; switch to `Statement.raw()` for hot rows. **(Medium leverage, low cost; mostly affects search latency under typing.)**

I cannot audit `FileIndex.ts` directly. The checklist below is what I would walk through.

**Index audit checklist (L):**
- `EXPLAIN QUERY PLAN` every hot query: `/api/search`, `/api/positions/since`, any galaxy/cluster-filtered scan. Anything that says `SCAN` rather than `SEARCH USING INDEX` on a table > a few thousand rows is a candidate.
- `/api/positions/since` almost certainly wants a covering index on `(layout_version, row_id)` or `(updated_at, row_id)` — whichever timestamp drives the delta — including the `x, y, z` columns in the index payload so the query reads from the index alone. SQLite supports covering indices via `CREATE INDEX … (a, b) WHERE …` plus included columns implicitly through the index column list.
- Cluster-filtered scans want `(cluster_id, row_id)` or `(galaxy_id, cluster_id)`; pick the leftmost based on actual filter cardinality.
- Search: if you're joining FTS5 + vector candidates + metadata, the FTS5 join key (`rowid`) is implicit but the vector candidate table's id column needs to be `INTEGER PRIMARY KEY` or have an explicit index. A frequent trap is filtering the FTS5 result by metadata in a separate JOIN where the join column on the metadata side has no index — easy to miss because FTS5 looks fast in isolation.
- Run `ANALYZE` after large ingests; the planner uses `sqlite_stat1` to choose between indices.

**PRAGMAs (L):** with WAL already on, the remaining knobs are:
- `PRAGMA synchronous = NORMAL` (corruption-safe in WAL; removes fsync from commit critical path).
- `PRAGMA mmap_size = 268435456` (256MB) or higher if your DB is in that range. This trades read syscalls for page-cache-managed mmap reads. Big wins for large covering-index scans.
- `PRAGMA cache_size = -65536` (64MB).
- `PRAGMA temp_store = MEMORY`.
- `PRAGMA wal_autocheckpoint = 10000` (default 1000 pages = 4MB; lift for write-heavy phases). Run `PRAGMA wal_checkpoint(TRUNCATE)` periodically when idle to keep `-wal` from ballooning.

**Page size for vector blobs (L):** if you store vector embeddings as BLOB in the same table as metadata, large blobs get split across overflow pages. Either (a) put vectors in a dedicated table so metadata pages stay dense, or (b) raise `page_size` to 8192 at DB-creation time. Page size cannot be changed without a `VACUUM`. **Best practice (A): keep vectors out of SQLite entirely** — they're already in HNSW; persist them with the index.

**better-sqlite3 specifics (L):**
- All `db.prepare(...)` calls should be hoisted to module scope. If `FileIndex.ts` re-prepares statements on each call, you're paying SQL parse overhead per query.
- For high-row-count reads (e.g., `/api/map/all`), call `Statement.raw(true)` to return rows as arrays instead of objects. Eliminates per-row property allocation in V8. This is one of the documented better-sqlite3 perf knobs and it materially helps when you're about to re-encode anyway.
- Wrap the bulk read in a single transaction (`db.transaction(() => …)()`) — even reads benefit from reduced lock churn in WAL.

**Confidence: Medium-High** on the directional advice; **Low** on which specific indices are missing without seeing the SQL.
**Cost: Low.**

---

### 5. Replace per-file HNSW `addPoint` + DB transaction with batched `addPoint` calls and a deferred `writeIndex`. **(Medium leverage during ingest, no effect on steady-state frame cost.)**

**Library facts (L):**
- `hnswlib-node` exposes `addPoint(point, id)` per call. Under the hood it's the same as the C++ `addPoint`. There is no first-class `add_items` batch in the Node bindings (the Python binding's `add_items` is a thin loop with optional internal threading). So "batched insert" in Node really means "many `addPoint` calls without intermediate `writeIndex`".
- `writeIndex` / `writeIndexSync` is the expensive serialization step. **If your current code calls `writeIndexSync` per file, that is your dominant cost during bulk ingest, not the graph insertion itself.**
- HNSW insertion cost is ~O(M · log N · efConstruction · dim). For N = 5k, dim = 768, M = 16, efConstruction = 200, this is sub-millisecond per point on a modern laptop. 5000 inserts ≈ a few seconds of pure graph work. The transaction commit and the index serialization dominate.

**Recommendations (L):**
- **Don't write the index per file.** Write at most every N inserts (N ≈ 500–2000) or on idle. Store the highest committed `rowid` alongside the index file so you can replay missed inserts from SQLite on crash recovery.
- **Don't try multi-threaded `addPoint` from Node.** Even in Python, `add_items` with multiple threads has documented races/inconsistency reports (issue #28 on `nmslib/hnswlib`). The Node binding wraps one C++ call; you have no parallelism to exploit anyway.
- **HNSW parameters** for ~5k–50k corpus, ip space, dim 384–1024: `M = 16`, `efConstruction = 200`, `efSearch = 50–100`. These are the canonical defaults. Going to `M = 32` doubles memory and modestly improves recall; not worth it at this scale. Going to `M = 8` saves memory at a real recall cost — also not worth it.
- **Two-index merge** (immutable bulk + small mutable, periodically merged): only worth it if (a) your delete rate is high and (b) you're seeing graph quality degradation from in-place updates. At 5k–50k items this is over-engineering. `hnswlib`'s `replaced_update` (replaceDeleted in the Node binding via `initIndex({ allowReplaceDeleted: true })`) handles tombstone reuse adequately.

**Confidence: Medium** — depends on whether `writeIndexSync` per file is actually happening, which I can't verify.
**Cost: Low-Medium.**

---

### 6. Stop retraining PCA on every threshold cross. **(Medium leverage on relayout latency, no direct effect on per-frame cost.)**

**Library facts (L):**
- `ml-pca` (mljs/pca) defaults to `method: 'SVD'`, which calls `ml-matrix`'s `SVD`. `ml-matrix`'s SVD is a Golub-Reinsch full SVD implemented in pure JavaScript, no BLAS. There is no randomized-SVD path in `ml-pca` or `ml-matrix` as of current versions.
- For a centered `n × d` matrix with `n >> d`, `ml-matrix` SVD is O(n·d²). At n = 50k, d = 768, that's ~3×10¹⁰ ops in pure JS — easily 10–60 seconds on a laptop, not 100ms. At d = 128 it drops to ~10⁹ ops, plausibly 1–3 s. **The 100ms threshold in your question is almost certainly already exceeded for any non-trivial dimensionality.**

**Options in JS/TS (L):**
- **Randomized SVD (Halko–Martinsson–Tropp).** No first-class npm package I'm aware of. The algorithm is ~30 lines on top of `ml-matrix`'s `QR` and full SVD on a small `k × d` matrix:
  1. `Ω = randn(d, k+p)` (p = 5–10 oversampling)
  2. `Y = A · Ω`, then `Q = qr(Y).Q` (optionally with 1–2 power iterations: `Y = A · (Aᵀ · Y)`)
  3. `B = Qᵀ · A` (small: `(k+p) × d`)
  4. `Ũ Σ Vᵀ = svd(B)` (full SVD on the small matrix is cheap)
  5. `U = Q · Ũ`
  
  Cost: O(n · d · k) for the matmuls plus a tiny SVD. At n = 50k, d = 768, k = 3 (you only need 3 components for layout), this is ~10⁸ ops — ~100–500ms in pure JS, **two orders of magnitude faster than full SVD** for your target k. Implement this directly against `ml-matrix`. Don't shop for an npm randomized-SVD package; the ones that exist are R/Python.
- **Don't use NIPALS** (`method: 'NIPALS'` in `ml-pca`). NIPALS converges component-by-component and is stable for sparse data, but for dense embedding data with k = 3 it's not meaningfully faster than randomized SVD and has worse numerical behavior than the QR-stabilized variant.
- **Incremental PCA** (e.g., Brand's update or matrix-sketch approaches) is the right choice if you want to *avoid retraining* on every threshold cross. Sketch-based methods (Liberty's frequent-directions) maintain a rank-k approximation under streaming inserts in O(d · k) per insert. There's no mature JS package; you'd write ~150 lines.

**The right policy question (A):** does the layout *need* to be retrained on threshold cross, or only when the corpus distribution shifts meaningfully? Most users don't perceive the difference between PCA fit on 8000 vectors vs. 9000 vectors of the same distribution. **Retrain on a much coarser schedule** (corpus doubled, or t-test on principal angles between successive bases above threshold). The cheapest optimization here is "do it less often", not "do it faster". A randomized-SVD path is still worth implementing as a fallback when retraining is needed.

**Confidence: High** on "full SVD is too slow for what you're doing"; **Medium** on the exact wall-clock numbers (depends on your dimensionality which I don't know); **High** on "retrain less often is the cheap fix".
**Cost: Low** for the retrain-less-often policy change; **Medium** for hand-rolled randomized SVD.

---

### 7. Switch `/api/map/all` initial load to a binary protocol. **(Low marginal leverage on p99 *frame* cost, but a real wall-clock win on cold start.)**

This is subquestion 1, ranked low because it runs once per session.

**Numbers (B/L):**
- 50k stars × {id (~20B string), x/y/z (3 floats), cluster_id (int), score (float), maybe a few more fields} ≈ 60–100 bytes per star JSON-encoded ≈ 3–5 MB JSON payload. After V8 7.6 the JSON parser is iterative and fairly fast — back-of-envelope ~50–150 ms for 5 MB on a modern Node/Chromium, but the dominant cost is **object allocation and hidden-class transitions**, not parsing characters.
- A `Float32Array` of 50k × 3 = 600 KB of position data, plus `Int32Array(50000)` of cluster ids = 200 KB, plus an `Int32Array` of dense rowids and a JSON sidecar of ~50k id strings (~1 MB) — total ~2 MB. The numeric portion is essentially free to "parse" (it's a memcpy from `arrayBuffer()` into the `Float32Array` view).
- **MessagePack (msgpack-lite, @msgpack/msgpack):** in Node, decode rates for object-heavy payloads are typically *slower* than V8's native `JSON.parse` because the userland decoder allocates the same JS objects without V8's parser fast paths. The benchmark community (including the GoogleChromeLabs json-parse-benchmark and Adam Faulkner's "Binary Formats are Better Than JSON" piece) repeatedly finds that for browser/V8 contexts, schemaless binary formats lose to JSON.parse on decode time.
- **FlatBuffers / Cap'n Proto:** these win when you don't decode — you read fields lazily off the buffer. That's not the access pattern here; you want to iterate every star to project them. So you'd still pay a per-row read cost.
- **structured-clone via `postMessage`:** only relevant if the daemon were a Worker or shared-array context. It isn't (it's a separate Express process on loopback). Not applicable.

**Recommended protocol sketch (custom, no schema language):**

`GET /api/map/all → Content-Type: application/octet-stream`

```
[uint32  magic = 0x53544152]                      // "STAR"
[uint32  version = 1]
[uint32  count N]
[uint32  metadataJsonOffset]                       // byte offset
[uint32  metadataJsonLength]                       // byte length

// Numeric columns (8-byte aligned):
[float32 x[N]]
[float32 y[N]]
[float32 z[N]]
[int32   cluster_id[N]]
[float32 score[N]]
[int32   id_index[N]]                              // dense row id; index into id table

// Metadata sidecar (UTF-8 JSON, parsed once with JSON.parse):
{ "ids": ["abc...", ...],                          // length N
  "clusters": [...],                               // cluster metadata, small
  "schema_version": 1 }
```

Renderer code:
```ts
const buf = await (await fetch('/api/map/all')).arrayBuffer();
const dv  = new DataView(buf);
const N   = dv.getUint32(8, true);
const off = 20;
const x   = new Float32Array(buf, off,                 N);
const y   = new Float32Array(buf, off + 4*N,           N);
const z   = new Float32Array(buf, off + 8*N,           N);
const cid = new Int32Array  (buf, off + 12*N,          N);
// ... metadata JSON parsed from the sidecar
```

**Why this beats MessagePack/Protobuf here (L):**
- Zero per-element decoding cost for the numeric columns.
- Zero object allocation pressure → no GC pause during cold load.
- One JSON.parse call on a small (~1MB) sidecar that contains only the strings and per-cluster metadata, where JSON's cost is irrelevant.
- Trivial to implement (~80 LOC daemon-side, ~50 LOC renderer). No schema compiler, no codegen.

**What this doesn't fix:** if `App.tsx` then calls `setStars(starObjectArray)` to materialize the typed arrays into one Star object per row, you've thrown away the win. **This change only pays off in conjunction with #1** (positions stay in typed arrays in an external store; metadata stays as a parallel JS array; `Star` objects are constructed only on demand for a row).

**Confidence: High** that this is the right format choice; **Medium** that it materially affects p99 frame cost (it mostly affects cold start).
**Cost: Medium.**

---

### 8. Search latency under typing. **(Likely a separate problem from frame cost; mentioning for completeness.)**

**Hypotheses (A) without code access:**
- If `/api/search` runs HNSW knnQuery + SQL metadata join on every keystroke, the renderer is probably already debouncing — but the daemon should also short-circuit. Add an `AbortController` chain so that an in-flight search whose query is no longer current doesn't finish the SQL join. `req.on('close', () => abort())` in Express; pass the signal down.
- HNSW `setEf(efSearch)` — make sure `efSearch` isn't accidentally set very high. For typing, `efSearch = 32–64` is fine; you don't need full recall on partial queries.
- If the search joins FTS5 + ANN + metadata, do the cheap filter first. `EXPLAIN QUERY PLAN` will tell you which one the planner chose.

**Confidence: Low** without code.

---

## Concrete protocol recommendation summary

For `/api/map/all`: **custom column-major binary, native JSON sidecar.** Detailed sketch above. Do not adopt MessagePack, Protobuf, FlatBuffers, or Cap'n Proto for this endpoint — none of them are net wins in V8 for this access pattern, and they all add a schema/codegen burden.

For `/api/positions/since`: same column-major binary, but only the columns that change (`row_ids: Int32Array, x,y,z: Float32Array`). No metadata sidecar.

For `/api/stats` and `layoutVersion`: SSE on the existing `/api/index/progress` stream, multiplexed by event name.

---

## Renderer-side knock-on summary

| Change | `starsById` | `projectedStars` | `percentileBuckets` |
|---|---|---|---|
| #1 split positions to external store | Stops firing on layoutVersion bumps. Only re-fires on metadata changes (rare). | Re-fires only when positions actually change AND component is selector-subscribed. With typed arrays, the work itself is ~10× faster per element. | Stops firing if percentile breakpoints are precomputed daemon-side and pushed; otherwise re-fires only on positions change. |
| #2 SSE for layoutVersion | Indirect: removes the spurious 10s-poll-driven re-renders. | Same. | Same. |
| #3 setStars → Map-of-id or split state | Stops firing if metadata stays in a separate state slice. | Still fires on every position update unless combined with #1. | Same as projectedStars. |
| #7 binary `/api/map/all` alone | No change unless combined with #1. | No change. | No change. |

The point of the table: **#7 alone changes none of the useMemo behaviors.** It only helps if you stop materializing Star objects, which requires #1.

---

## Confidence and source-quality notes

| Recommendation | Confidence | Basis |
|---|---|---|
| Split state + external store kills the cascade | High | React 18 + `useSyncExternalStore` semantics are well-documented; the "new array reference invalidates downstream memos" pattern is textbook. |
| SSE multiplexing for `layoutVersion` | High | Standard pattern; SSE is already in use per your description. |
| Custom binary > MessagePack/Protobuf in V8 for this shape | High on the relative ranking; Medium on exact ms numbers | V8 JSON parser benchmarks (V8 v7.6 release notes; GoogleChromeLabs/json-parse-benchmark); independent comparisons (Adam Faulkner). Numbers depend on payload shape. |
| Full SVD in ml-pca is too slow at scale | High on direction; Low-Medium on threshold | `ml-pca` source confirms full SVD via `ml-matrix`. Wall-clock depends on dimensionality I don't know. |
| Randomized SVD ~10–100× speedup for k≪d | High in general; Medium for pure-JS without BLAS | Halko–Martinsson–Tropp (SIREV 2011) and standard randomized-NLA literature. Pure-JS constant factors are worse than BLAS but the asymptotic win still holds. |
| HNSW per-file `writeIndexSync` is the bulk-ingest bottleneck | Medium | Hypothesis from your description; would need to confirm against `Insert.ts`. |
| `M=16, efConstruction=200, efSearch=50–100` | High | `hnswlib` defaults; widely benchmarked (ann-benchmarks, Pinecone, Marqo). |
| SQLite covering indices + mmap_size + raw() | High | Standard better-sqlite3 / SQLite tuning; well-documented. |

---

## What I would do first (concrete order)

1. **Profile.** Open Chrome DevTools Performance panel during a `layoutVersion` bump. Confirm that the time is in `setStars`, `useMemo` rebuilds, and React commit work — not in fetch/parse. This costs an hour and tells you whether #1 or #7 is the bigger lever.
2. **Implement #3** (split metadata and positions in `useState`) as a 1-hour intermediate. Should drop p99 visibly.
3. **Implement #1** (Zustand + typed-array positions store). 1–2 days.
4. **Implement #2** (SSE multiplexing). Half a day.
5. **Audit SQL** with `EXPLAIN QUERY PLAN` (#4). Fix the obvious misses. Half a day.
6. **Defer or batch HNSW writeIndex** (#5). Half a day.
7. **Move PCA retrain to a coarser schedule** (#6 policy half). Trivial. Implement randomized SVD only if profiling shows it's still on the hot path.
8. **Binary `/api/map/all`** (#7). Only after #1 lands, otherwise wasted.

---

## Where the question framing may be off

- **Subquestion 1** ("quantify JSON.parse + GC cost on the renderer at 50k stars") asks about an event that happens once per session. Even if it's 500ms, it does not contribute to *steady-state p99 frame cost*. It contributes to cold-start latency, which is a different metric. If you have `/api/map/all` re-firing during normal use, that itself is the bug, not the parse cost.
- **Subquestion 4** ("at what corpus size does PCA train() exceed 100ms") is a sharper question than "how do we make PCA faster" because the right answer is probably "stop calling it so often", which the subquestion doesn't ask about. The framing biases you toward picking a faster SVD when you may not need to run the SVD at all on most threshold crosses.
- **Subquestion 3** assumes per-file HNSW insert is a problem; it likely isn't. Per-file `writeIndexSync` is. They are different fixes.
- **Subquestion 6** ("polling vs SSE for layoutVersion") is correctly framed but should be folded into #2 — the win isn't SSE per se, it's that *changes are pushed only when they happen*, eliminating spurious re-renders from "nothing changed" polls.

The strongest single intervention is #1. If you implement nothing else, implement that.

## Caveats
- All claims tagged **(A)** are architectural inference and need profiler confirmation.
- Wall-clock numbers for PCA, JSON.parse, and HNSW depend on machine, embedding dimension, and Node version, none of which I know exactly. Order-of-magnitude reasoning is reliable; specific ms numbers are not.
- The recommended typed-array layout assumes positions and cluster_ids are the only numeric columns of interest. If `Star` has more numeric fields used per-frame, extend the column list — the protocol is trivially extensible by appending columns and bumping `version`.
- If you're on Electron and ever consider moving the daemon into the main process and using `MessagePort` / `postMessage` with transferable `ArrayBuffer`s, that's a strictly better wire than HTTP-on-loopback (zero copy via transfer). But it's an architectural change, not an optimization, and out of scope here.