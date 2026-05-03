# Star Palace — repo-state.md

A snapshot of the repository as it actually is, intended for an agent that has no prior context. Verified against the source as of the date below — if a `path:line` reference looks wrong, trust the code.

The repo has four docs total. Routing:

- **`CLAUDE.md`** — agent entry: reading map, commit gates, hard invariants. Read first if you arrived via the agent harness.
- **`README.md`** — human entry: quickstart, keybindings, env vars.
- **`repo-state.md`** (this file) — comprehensive technical state: every endpoint, every column, every perf gate, all branches.
- **`REQUIREMENTS.md`** — feature spec (F1–F19) with design rationale.

---

## 1. Snapshot

- **Date of audit:** 2026-05-03
- **Branch:** `main`
- **Last commit on main:** `aa9cf0e docs: surface every shipped feature in README + CLAUDE.md`
- **Working tree:** clean (only untracked items — see §9).
- **Remote:** none configured. `git remote -v` is empty; `gh` is not in PATH.
- **Tags:** none.
- **Stashes:** 4 (see §8.4).
- **Active non-main branches with unique commits:** 2 (see §8.2). 11 other local branches are stale orphans whose content is fully merged (see §8.3).

---

## 2. Architecture

Two long-running processes, connected over HTTP:

| Process | Path | Tech | Port | Owns |
|---|---|---|---|---|
| Daemon | `src/daemon/index.ts` | Node + Express + better-sqlite3 + hnswlib-node + ml-pca | `127.0.0.1:7373` | SQLite DB, HNSW index, PCA model, Ollama client |
| Renderer | `src/renderer/` | Vite + React + Canvas2D | `5173` | UI, draw loop, all visual state |

The renderer never imports Node APIs. All persistence + computation lives in the daemon. Communication is `fetch` only.

External prerequisite: a local **Ollama** server at `http://localhost:11434` with the `nomic-embed-text` model pulled. The daemon polls Ollama health and falls back to a flag in `/api/health` if it is unreachable.

Data directory (overridable via `STARPALACE_DIR` and `STARPALACE_DB`):

```
~/.starpalace/
  index.db          # SQLite (WAL) — files, edges, clusters, layout_meta, galaxies, collections, collection_members
  hnsw.bin          # hnswlib-node persisted index
  hnsw.bin.map.json # fileId <-> hnswlib label mapping
```

---

## 3. Daemon

### 3.1 HTTP API

`src/daemon/index.ts` registers **28 routes** under `/api`. CORS-enabled; `express.json({ limit: '5mb' })`. Grouped here for orientation:

| Method | Path | Line | Purpose |
|---|---|---|---|
| GET | `/api/health` | 91 | `{ ok, indexed, indexedWithEmbedding, layoutVersion, ollamaAvailable }`. Caches Ollama probe for 5s. |
| POST | `/api/index` | 114 | F9/F17. Body `{ path, galaxyName? }`. Returns `{ jobId, galaxyId, galaxyName }` immediately; walk runs detached. |
| GET | `/api/index/progress` | 168 | F17 SSE stream for a `jobId`. 60s idle timeout. 404 if unknown. |
| DELETE | `/api/index/progress/:jobId` | 228 | F17 cancel in-flight job. |
| GET | `/api/galaxies` | 235 | F9. List galaxies with member counts. |
| GET | `/api/collections` | 260 | F5. List with member counts. |
| POST | `/api/collections` | 264 | F5. Create static or dynamic. 409 on UNIQUE name. |
| GET | `/api/collections/:id` | 312 | F5. Detail with `memberIds`. |
| POST | `/api/collections/:id/members` | 321 | F5. Add to static collection. |
| DELETE | `/api/collections/:id/members/:fileId` | 335 | F5. Remove member. |
| POST | `/api/collections/:id/refresh` | 351 | F5. Re-evaluate dynamic query (503 if Ollama down, 400 if static). |
| DELETE | `/api/collections/:id` | 388 | F5. Drop with cascade. |
| GET | `/api/map/viewport` | 398 | Stars + clusters in `x1,y1,x2,y2` bounds. |
| GET | `/api/map/all` | 411 | Full sky load. |
| GET | `/api/map/positions` | 425 | Position-delta refetch. Query `since=N`; returns rows with `layout_version > N` plus clusters. |
| GET | `/api/map/projection` | 433 | F3 PC dial payload: `{ componentCount, files: ProjectionFile[] }`. |
| GET | `/api/map/stats` | 445 | `{ total, indexedWithEmbedding, layoutVersion, lastRefitAt, clusterCount }`. |
| POST | `/api/file/:id/star-type` | 458 | F2/F4 manual override. Body `{ starType: StarType | null }`. Survives re-index. |
| POST | `/api/file/:id/pin` | 486 | F4. Body `{ x, y, axisA, axisB }`. Solves α=x−naturalA, β=y−naturalB. 409 if no PCA trained. |
| POST | `/api/file/:id/unpin` | 529 | F4. Clears pin_alpha/beta/axis_a/axis_b/pinned_at/is_pinned. |
| POST | `/api/file/:id/open` | 537 | F14. Spawns `open` / `xdg-open` / `start`. |
| POST | `/api/file/:id/reveal` | 552 | F14. macOS `open -R`, Windows `explorer /select,`, Linux `xdg-open` parent dir. |
| POST | `/api/relayout` | 567 | Synchronous PCA retrain. Returns `{ ok, layoutVersion, nodeCount }`. |
| POST | `/api/search` | 578 | Body `{ query, limit?, collectionId? }`. Embeds query, HNSW search (over-fetch ×5 if collection-filtered), returns hits with `score = 1 − distance`. |
| GET | `/api/file/:id` | 623 | Metadata sans embedding. Increments `view_count`. |
| GET | `/api/file/:id/content` | 632 | Text content capped at `VIEW_BYTES = 120 KB`. Media returns `content: null`. |
| GET | `/api/file/:id/raw` | 663 | Raw bytes. Image-only allowlist: `png \| jpeg \| gif \| webp \| svg+xml`. 415 on others. |
| GET | `/api/file/:id/neighborhood` | 673 | Selected file + top-K neighbors (sans embedding) + cluster colour. |

**B1/B2/B3 — tags + embedding experiments** (added under same `app`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/file/:id/tags` | Read user-set tags. Returns `{ tags: string[] }`. |
| POST | `/api/file/:id/tags` | Set / replace tags. Body `{ tags: string[] }`. Trims + drops empties. Persists via `setTags` (COALESCE-preserving on re-index). |
| POST | `/api/file/:id/reindex` | Re-embed a single file under the current default strategy (used after tag edits). |
| GET | `/api/embedding/strategies` | Lists 5 strategies + active default. |
| POST | `/api/embedding/default` | Body `{ strategy }`. Updates `app_settings.default_strategy`. No re-embed. |
| POST | `/api/embedding/experiment` | Body `{ scopePath, strategy, note? }`. 400 if scope < 10 files. Captures snapshot, re-embeds in scope under `strategy`, fits subset PCA, returns `{ snapshotId, affectedIds }`. |
| GET | `/api/embedding/experiment/:id/positions` | Returns `[{ id, x, y }]` for files in the snapshot — the subset-PCA positions. |
| POST | `/api/embedding/experiment/:id/promote` | Adopts the snapshot's strategy as default + drops the snapshot + kicks a background `progressStore` job to re-embed the rest of the corpus. Returns `{ ok, jobId }`. |
| POST | `/api/embedding/experiment/:id/revert` | Restores per-file `embedding`, `embedding_strategy` (from `prior_strategy`), `x`, `y`, `layout_version` from snapshot. Re-adds restored vectors to HNSW. Drops snapshot. |
| GET | `/api/embedding/snapshots` | History list, ordered by created_at DESC. Auto-pruned to 10 most recent on every snapshot create. |

Startup migration runs in `src/daemon/index.ts:39–55`: if a persisted PCA model has fewer than `PC_COUNT = 8` components, or is missing `scale` params, retrain once.

### 3.2 SQLite schema

`src/daemon/db/FileIndex.ts` opens the DB in WAL mode (`journal_mode = WAL`, `synchronous = NORMAL`) and applies migrations on every startup. Initial DDL begins at line 52; additive migrations run unconditionally and use `if (!hasColumn(...))` guards.

#### Table `files` (line 52)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `id` | TEXT PK | no | sha1(galaxyScope `\0` path).slice(0,16) (see `walker.ts fileIdFromPath`). |
| `path` | TEXT | no | Absolute file path. |
| `platform` | TEXT | no | One of `Platform` (`local | google-drive | confluence | dropbox | onedrive`). |
| `name` | TEXT | no | Basename. |
| `mime_type` | TEXT | no | MIME from extension. |
| `category` | TEXT | no | `document | data | code | media | unknown`. |
| `size` | INTEGER | no | Bytes on disk. |
| `created_at` | INTEGER | no | birthtime ms. |
| `modified_at` | INTEGER | no | mtime ms. |
| `stale` | INTEGER (default 0) | no | Reserved (currently unused). |
| `embedding` | BLOB | yes | 768-float32 (3072 bytes), L2-normalised. NULL until embedded. |
| `content_hash` | TEXT | yes | sha1 hex. Used by `Insert.insertOne` to skip re-embed on unchanged content. |
| `x` | REAL | yes | World X. NULL until `layout_meta.version >= 1`. |
| `y` | REAL | yes | World Y. NULL until `layout_meta.version >= 1`. |
| `z` | REAL | yes | Reserved (unused). |
| `cluster_id` | INTEGER | yes | FK `clusters.id`. NULL on singleton components. |
| `layout_version` | INTEGER (default 0) | no | Bumped each PCA retrain; renderer uses it for delta refetch. |
| `first_seen` | INTEGER (default 0) | no | Insertion ms. |
| `view_count` | INTEGER (default 0) | no | Incremented on `GET /api/file/:id`. |
| `is_pinned` | INTEGER (default 0) | no | Boolean. Survives re-index. |
| `star_type` | TEXT | yes | One of `STAR_TYPES`. Manual override; survives re-index. |
| `galaxy_id` | INTEGER | yes | F9. FK `galaxies.id`. NULL only on legacy rows pre-migration. |
| `pin_alpha` | REAL | yes | F4 embedding-delta on axis A. |
| `pin_beta` | REAL | yes | F4 embedding-delta on axis B. |
| `pin_axis_a` | INTEGER | yes | F4 PC index 0..7 for X at pin time. |
| `pin_axis_b` | INTEGER | yes | F4 PC index 0..7 for Y at pin time. |
| `pinned_at` | INTEGER | yes | F4 timestamp ms. |
| `os_use_count` | INTEGER | yes | F10 Spotlight `kMDItemUseCount` (macOS only). |
| `os_last_used` | INTEGER | yes | F10 Spotlight `kMDItemUseDate` ms, or `atimeMs` fallback. |
| `importance_score` | REAL | yes | F10 composite: `viewCount + log2(osUseCount + 1) * 4 + recencyBoost`. |
| `tags` | TEXT | yes | B1. JSON-encoded `string[]` of user-set tags. NULL = no tags. Survives re-index via COALESCE in upsert. |
| `embedding_strategy` | TEXT | yes | B1. Strategy id that produced the current embedding (`content-only`, `metadata-only`, `metadata+content`, `tags+metadata+content`, `sampled-stats+metadata`). NULL = legacy pre-B1 row. Survives re-index via COALESCE. |

Indices: `idx_files_category`, `idx_files_stale`, `idx_files_cluster`, `idx_files_layout`, `idx_files_star_type`, `idx_files_galaxy`, `idx_files_is_pinned`.

#### Table `edges` (line 79)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `src_id` | TEXT | no | FK `files.id`. |
| `dst_id` | TEXT | no | FK `files.id`. |
| `weight` | REAL | no | Cosine similarity in `[0, 1]`. |
| `engine` | TEXT (default `'embedding'`) | no | Reserved for non-embedding edges. |
| `computed_at` | INTEGER | no | ms. |

PK `(src_id, dst_id)`. Indices: `idx_edges_src`, `idx_edges_dst`. At most `K_NEAREST = 20` outgoing rows per `src_id`; pruned in `Insert.insertOne`.

#### Table `clusters` (line 90)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | no |  |
| `color_index` | INTEGER | no | Modulo `CONSTELLATION_PALETTE.length = 6`. |
| `centroid_x` | REAL | yes | Mean of member X. |
| `centroid_y` | REAL | yes | Mean of member Y. |
| `member_count` | INTEGER (default 0) | no |  |
| `label` | TEXT | yes | Optional user annotation. |

#### Table `layout_meta` (line 99)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `version` | INTEGER PK | no | Bumps on each retrain. |
| `algorithm` | TEXT | no | `'pca'`. |
| `projection_model` | BLOB | no | `StarPca.serialize()` JSON. |
| `computed_at` | INTEGER | no | ms. |
| `node_count` | INTEGER | no |  |
| `drift_score` | REAL | yes | Reserved. |

#### Table `galaxies` (line 118, F9)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | no |  |
| `name` | TEXT | no |  |
| `root_path` | TEXT UNIQUE | no |  |
| `origin_x` | REAL | no | Spiral offset (world units). |
| `origin_y` | REAL | no |  |
| `created_at` | INTEGER | no |  |

A default galaxy with sentinel root `__default__:default` is created on first migration to host pre-F9 rows.

#### Table `collections` (line 169, F5)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | no |  |
| `name` | TEXT UNIQUE | no |  |
| `kind` | TEXT | no | CHECK constraint: `'static' | 'dynamic'`. |
| `query` | TEXT | yes | Required for dynamic. |
| `similarity_floor` | REAL | yes | Required for dynamic; default `0.6`. |
| `color_index` | INTEGER | no | Modulo `CONSTELLATION_PALETTE`. |
| `created_at` | INTEGER | no | ms. |
| `updated_at` | INTEGER | no | ms. |
| `evaluated_at` | INTEGER | yes | Last dynamic refresh. |

#### Table `collection_members` (line 180)

PK `(collection_id, file_id)`. Index `idx_cm_file`.

#### Table `app_settings` (B1)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `key` | TEXT PK | no | Currently only `'default_strategy'`. |
| `value` | TEXT | yes | Stringified value. Default row: `('default_strategy', 'content-only')`. Flip via `POST /api/embedding/default` or the EmbeddingLab promote flow. |

#### Table `embedding_snapshots` (B2)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `snapshot_id` | TEXT PK | no | `crypto.randomUUID()`. |
| `created_at` | INTEGER | no | ms. |
| `strategy` | TEXT | no | Strategy id used by the experiment. |
| `scope_path` | TEXT | yes | The subdir prefix the experiment ran on. |
| `note` | TEXT | yes | Optional user note. |

Auto-pruned to 10 most recent on every snapshot create (`pruneOldSnapshots`).

#### Table `embedding_snapshot_files` (B2)

| Column | Type | NULL | Notes |
|---|---|---|---|
| `snapshot_id` | TEXT | no | FK `embedding_snapshots`. |
| `file_id` | TEXT | no | FK `files`. |
| `embedding` | BLOB | no | Captured (pre-experiment) embedding. |
| `content_hash` | TEXT | yes | Captured content hash. |
| `x` | REAL | yes | Captured world X. |
| `y` | REAL | yes | Captured world Y. |
| `layout_version` | INTEGER | yes | Captured layout version. |
| `prior_strategy` | TEXT | yes | Captured `embedding_strategy` so revert restores exactly. |

PK `(snapshot_id, file_id)`. Used only by `revertExperiment` for restore; `promoteExperiment` drops the snapshot rather than restoring.

### 3.3 Pipelines

#### Insert (`src/daemon/pipeline/Insert.ts`)

`indexPath(rootPath, opts)` — async generator wrapper. Walks via `walker.ts`, throttles progress emits to ~100ms, calls `insertOne` per file, calls `relayouter.maybeTrainFirst()` after the walk.

`insertOne(node, content, opts)` is the workhorse. Order is intentional and load-bearing:

1. Resolve default strategy from `app_settings.default_strategy` (B1). Resolve existing tags from the row.
2. Build the prompt via `STRATEGIES[strategy].build({ node, content, tags })`. Hash the prompt (not raw content). If `existing.contentHash === promptHash AND existing.embeddingStrategy === strategy`, exit fast — strategy-aware short-circuit (a strategy flip alone forces re-embed).
3. Embed via `embedEngine.embed(prompt)` (rejects empty prompts to protect L2-norm invariant).
4. **Search HNSW first** — top `K_NEAREST + 1`, self-filtered, sorted ascending by distance. Searching before mutation means a transaction rollback cannot leave an HNSW orphan.
5. **Single SQL transaction**:
   - Upsert `files`. ON CONFLICT preserves `is_pinned`, `star_type`, pin coefficients, **`tags`** (B1), **`embedding_strategy`** (B1) — all via COALESCE so a re-index without those fields never wipes them.
   - Delete + reinsert outgoing edges (cap at K_NEAREST=20, only edges with weight ≥ `ISOLATION_THRESHOLD = 0.3`).
   - Reciprocal-edge upgrade: if neighbor has fewer than K outgoing edges, or this edge would beat its weakest, displace.
   - Plurality-vote `cluster_id` from neighbors.
   - Project position via `relayouter.projectOne` (if embedded and PCA trained).
6. Post-commit: `hnsw.addPoint(embedding, fileId)`.

#### Layout (`src/daemon/layout/`)

- `Pca.ts` — wraps `ml-pca`. Keeps top `PC_COUNT = 8` eigenvectors. Methods: `train(embeddings)`, `project(embedding, axisX=0, axisY=1)`, `projectAll(embedding)`, `serialize()`/`deserialize()`. World scaling via `scalePositions(positions, outputRange = 1000)` maps to `[-500, 500]`. Legacy models without `scale` trigger retrain at startup.
- `Relayouter.ts` — DB-aware wrapper. `loadExisting()` deserializes from `layout_meta`. `train()` runs SVD on every embedded file, scales positions, **detects axis sign flips** via `detectSignFlips`, applies sign-corrections to pinned files, bumps `layout_meta.version`, writes `x/y/layout_version` to all rows, persists model. `projectOne(embedding, id?)` uses trained model + scale + jitter. `getAllProjections()` produces F3 PC-dial payload. `maybeTrainFirst()` auto-trains once `LAYOUT_THRESHOLD = 200` embeddings exist. **`trainSubset(fileIds)` (B2)** — fits one-shot PCA on a supplied subset, scales to `[-500, 500]`, returns `Map<id, [x, y]>`. **Does not** persist into `layout_meta` or touch the global model. Hard floor `SUBSET_PCA_MIN = 10` (returns null below). Used only by the experiment flow.
- `clustering.ts` — `recomputeClusters` runs union-find on edges with weight ≥ `ISOLATION_THRESHOLD`. Components ≥ 2 get a cluster id; singletons get NULL. `updateClusterCentroids` averages member positions. `pluralityVoteCluster(neighborClusterIds)` is the per-insert hot path.
- `jitter.ts` — `jitterFor(id)` is FNV-1a hash → angle + sqrt-uniform radius within `JITTER_RADIUS = 6` world units. Same id always produces same offset.

#### Embedding (`src/daemon/embedding/`)

- `OllamaClient.ts` — `POST http://localhost:11434/api/embeddings`. Default model `nomic-embed-text`. Truncates text to `MAX_TEXT_BYTES = 8 KB` on a UTF-8 codepoint boundary (cap dropped from 30 KB after a Documents reindex showed ~29% Ollama context-length 500s on dense / binary content; 8 KB ≈ 2k tokens, safely under `num_ctx=8192`). `embedBatch` runs 8 concurrent. `isAvailable()` 3s probe of `/api/tags`.
- `EmbeddingEngine.ts` — `embed(text)` calls `OllamaClient`, validates `length === EMBED_DIM (768)`, **L2-normalises in place**, returns `{ embedding, contentHash }`. **Rejects empty/whitespace prompts** (a zero vector would normalise to NaN/zero and break HNSW IP search). `embedFile(node, content, strategy, tags?)` (B1) builds the prompt via `STRATEGIES[strategy].build({ node, content, tags })`, returns `null` if the strategy returns null (e.g. media with `content-only`), otherwise returns `{ embedding, contentHash, strategy }`. All callers assume the returned vector is unit-length; HNSW `ip` distance therefore equals `1 − cosine_similarity`.
- `strategies.ts` (B1) — pure module exporting `STRATEGIES: Record<StrategyId, Strategy>` for the 5 strategies (`content-only`, `metadata-only`, `metadata+content`, `tags+metadata+content`, `sampled-stats+metadata`) plus `DEFAULT_STRATEGY = 'content-only'`. Each `Strategy.build(ctx)` returns the prompt string Ollama embeds (or null to skip). Metadata is emitted FIRST in every composite strategy so the 8 KB tail-truncation never strips it.
- `snapshots.ts` (B2) — pure functions over `FileIndex`: `createSnapshot`, `listSnapshots`, `getSnapshot`, `getSnapshotFiles`, `deleteSnapshot`, `pruneOldSnapshots`. Capture-time snapshot includes `(embedding, content_hash, x, y, layout_version, prior_strategy)` per file. Snapshot id = `crypto.randomUUID()`. Auto-prune to 10 most recent.
- `experiments.ts` (B2) — `runExperiment(deps, opts)` orchestrates the full flow: capture snapshot → re-embed scope files under new strategy (preserving the HNSW order: KNN search before SQL tx, `addPoint` after commit) → fit subset PCA via `Relayouter.trainSubset` → write experimental positions with a synthetic negative `layout_version` (FNV-1a hash of snapshotId, mapped to `[-2^31+1, -1]`) so the renderer's `since=N` delta query always picks them up. `promoteExperiment` adopts the snapshot's strategy as the new default + drops the snapshot + kicks a background re-embed via `progressStore`. `revertExperiment` restores per-file fields from the snapshot, re-adds restored vectors to HNSW, drops the snapshot, runs a global `relayouter.train()` to re-coherence the corpus.

#### Indexing & usage (`src/daemon/index/`)

- `walker.ts` — async generator yielding `{ node, content, usage }`. Default ignore set: `node_modules`, `.git`, `.DS_Store`, `dist`, `.cache`, `.next`, `build`, `.venv`, `__pycache__`, `coverage`. Skips files > `MAX_FILE_BYTES = 5 MB` and `category === 'unknown'`. Media files yield empty buffer (no read). `fileIdFromPath(path, galaxyScope?)` is sha1 (16 hex chars).
- `progressStore.ts` — F17 SSE state machine. `start()` → `jobId`. `update`/`finish`/`cancel` mutate state and broadcast to subscribers. Cancelled jobs raise `isCancelled()` so the walker bails between files. Finished jobs auto-clean after 60s.
- `usageMetadata.ts` — F10. macOS: `mdls -raw -name kMDItemUseCount -name kMDItemUseDate <path>`, parsed back-to-back. Other platforms: `fs.stat().atimeMs` for `osLastUsed`, `osUseCount = null`. Always resolves; errors → all-null metadata.
- `extractors/category.ts` — `EXT_TO_CATEGORY` and `EXT_TO_MIME` maps (~30 entries each).

### 3.4 ANN — `src/daemon/ann/HnswIndex.ts`

Wraps `hnswlib-node`. Space `ip` (inner product). Params: `dim = EMBED_DIM (768)`, `maxElements = 200_000`, `M = 16`, `efConstruction = 200`, `efSearch = 100`.

Contract: every vector passed to `addPoint` must be unit-normalised. `EmbeddingEngine.embed` already enforces this.

`searchKNN(embedding, k)` returns `{ id, distance }[]` sorted ascending — best matches first, where `distance = 1 − cos_sim`.

Persistence: `save()` writes `<persistPath>` (binary) and `<persistPath>.map.json` (`{ entries: [fileId, label][], nextLabel }`). `load()` restores both. Called after `POST /api/index` finishes.

### 3.5 Constants — `src/shared/types.ts`

| Constant | Value | Where used |
|---|---|---|
| `EMBED_DIM` | 768 | HNSW dim, EmbeddingEngine validation. |
| `OLLAMA_PORT` | 11434 |  |
| `DAEMON_PORT` | 7373 |  |
| `K_NEAREST` | 20 | Edge cap; ANN top-K; pin coef. |
| `ISOLATION_THRESHOLD` | 0.3 | Edge keep threshold; clustering union-find. |
| `LAYOUT_THRESHOLD` | 200 | Min embeddings before first PCA train. |
| `MAX_TEXT_BYTES` | 8192 | Embedding input truncation. 8 KB cap keeps prompts under nomic-embed-text `num_ctx=8192` even on dense (CSV, code) or binary (PDF/DOCX read raw) content. |
| `MAX_FILE_BYTES` | 5_242_880 | Walker skip threshold. |
| `VIEW_BYTES` | 122_880 | `/api/file/:id/content` cap. |
| `GALAXY_SPIRAL_STEP` | 1000 | F9 inter-galaxy spacing. |
| `COLLECTION_DEFAULT_SIMILARITY_FLOOR` | 0.6 | Dynamic collection floor. |
| `PC_COUNT` | 8 | Top eigenvectors retained — defined in `src/daemon/layout/Pca.ts:3`. |
| `STAR_TYPES` | 10-tuple | `red-giant, blue-supergiant, white-dwarf, main-sequence, neutron-star, pulsar, binary, quasar, black-hole, nebula`. |
| `CONSTELLATION_PALETTE` | 6-tuple | `#b388ff, #80cbc4, #f48fb1, #a5d6a7, #ffcc80, #ef9a9a`. |
| `DEFAULT_GALAXY_NAME` | `'default'` | Sentinel for legacy rows. |
| `COLLECTION_ACTIVE_LS_KEY` | `'starpalace.activeCollection.v1'` | Renderer localStorage. |

---

## 4. Renderer

### 4.1 App.tsx — top-level state

`src/renderer/src/App.tsx` (542 lines). Drives polling, owns the camera, and routes keybindings.

- `STATS_POLL_MS = 10_000` — 10 s polling cadence.
- `pollStats()` — calls `/api/map/stats`; if `layoutVersion` advanced, fetches `/api/map/positions?since=N` and patches `rawStarsById` in place. On failure, falls back to a full `/api/map/all` reload.
- `hoveredIdRef` — mutable ref so 60 Hz mouse motion does not trigger React re-renders. Consumed in `useVimMode` via a `getHoveredId()` getter.
- `rawStarsById: Map<id, Star>` — O(1) lookup feeding `galaxyOffsetForStarId`, `projectedHighlights`, neighbor lookups.
- `projectedStars` / `projectedHighlights` — derived once per stars/PC-dial change.
- `selectedId`, `searchHits`, `activeCollection` — React state (changes infrequently).
- `layoutVersionRef` — tracks daemon `layout_version` for delta-refetch gate.
- F16 galaxy-visibility filter wraps `visibleStars` and `projectedHighlights` via `useGalaxyVisibility` (defaults true for `galaxyId === null`).
- Modeless keybinding registered at App level: `Shift+P` toggles the perf overlay (capture-phase listener; suppressed when an input has focus). All other keys flow through `useVimMode`.

### 4.2 StarMap draw loop

`src/renderer/src/components/StarMap/StarMap.tsx` (1619 lines). Owns the canvas, the `requestAnimationFrame` loop, and every per-frame ref.

Anatomy of a frame:

1. **Resize** — `resize()` sizes the backing store to `clientWidth × effectiveDpr`, where `effectiveDpr = min(window.devicePixelRatio, qualityCap)` (DPR cap, see §4.8).
2. **Dirty gate** — if `dirtyRef === false` and `lastCamSnapRef` matches current camera and there is no continuous animation in scene (selection pulse, sub-200 ms search pulse, any pulsar/quasar, vim pan velocity, pin drag), skip the entire `draw()` call. `frameMetrics.recordSkipped()` increments a counter so the overlay shows how often the gate fires.
3. **Spatial grid** — `gridRef.current` is rebuilt on every `stars` mutation. Cells are `CELL_SIZE = 100` world units (`spatialGrid.ts:12`). Frame computes viewport bounds via `screenToWorld` with a `cull` margin (`cullMarginFor(drawScale)` ≈ 150 × drawScale, min 48), then `forEachStarInBounds(grid, minX, minY, maxX, maxY, visit)` iterates only overlapping cells.
4. **Backdrop** — `getBackdrop(w, h, theme)` returns a prerendered gradient image. Parallax: `bgScale = zoom ^ 0.4`, pan offset multiplier 0.3.
5. **Constellation nebulae** — per-cluster radial gradient with screen blend.
6. **Collection hull (F5)** — when `activeCollection` is set, convex hull (`convexHull.ts`) of member positions, inflated by `COLLECTION_HULL_INFLATE_PX = 12`, fill + stroke. Single-member fallback draws a circle.
7. **Edges** — only the selected star's neighborhood renders. `neighborStarMap` (Map<id, Star>) gives O(1) neighbor lookup. Additive blend; opacity = `weight × 0.55 × exposure`.
8. **Main star pass** — per visible star: pick size bucket (`sizeBucketForViewCount` for type mode, `sizeBucketForImportance` for usage mode), compute `effectiveStarType`, fetch sprite, scale by hover/highlight/neighbor/selected multipliers, blit. Forced-draw set ensures selected/hovered/neighbors render even off-screen.
9. **Animation overlay (pulsar/quasar)** — iterates `animatedStarsRef` only (precomputed). Fixed skip threshold `animSkipPx = 4` (matches the prior `quality === 'high'` default after the quality dropdown was retired). Pulsar = rotating beam; quasar = two opposing precessing jets with flicker.
10. **Decoration pass** — additive sprite re-draw for selected/highlighted/neighbors, plus rings (selection warm-white, neighbor cyan, search gold/accent) and the 1.5 s sine-wave selection pulse (±6 % scale, alpha 0.30..0.60).

Vim actions hit refs via `panVelocityRef`, `zoomTo`, `fitAll`, `fitCluster`, `panTo`. `panVelocityRef` integrates per-frame, which is why pan is "continuous" for the dirty gate.

### 4.3 Renderer perf gates index

Each gate is wired into the rAF loop unless noted. CLAUDE.md §"Renderer perf gates" lists the same set; this is the cross-reference with file paths.

| Gate | File | Why it matters |
|---|---|---|
| Spatial grid | `src/renderer/src/components/StarMap/spatialGrid.ts` | O(visible_cells) instead of O(N) per draw. |
| Dirty-flag rAF gate | `StarMap.tsx` (`dirtyRef`, `lastCamSnapRef`) | Skips `draw()` when nothing changed. |
| Sprite LOD cache | `src/renderer/src/components/StarMap/sprites.ts` | `cheap` and `full` coexist; cache key includes `lod`. |
| Quality-driven LOD swap | `lodFor(spritePx, focused)` in `StarMap.tsx` | Focused stars pinned to `full`. |
| Far-out tiny-dot fallback | Main pass in `StarMap.tsx` | At quality `low` and `r < 3 px`, replaces sprite blit with a 1.4-px arc. |
| Backing-store DPR cap | `resize()` in `StarMap.tsx` | `effectiveDpr = min(window.devicePixelRatio, theme.dprCap ?? Infinity)`. The Low/Med/High/Ultra global dropdown was retired; themes own their cap (Atari sets `1.0` for the 8-bit aesthetic; JWST/Vapor/Lost/Bio leave it uncapped). Re-fires on theme flip. |
| Position-delta refetch | `App.tsx pollStats` + `/api/map/positions?since=N` | Patches moved rows in place; identity-stable for unchanged rows. |
| Idle sprite prebuild | `requestIdleCallback` chain in the `stars` useEffect of `StarMap.tsx` | 40 stars per tick. |
| Hover ref | `App.tsx hoveredIdRef`, `useVimMode getHoveredId()` | Avoids 60 Hz App re-renders. |
| JWST nebula FBM cap | `src/renderer/src/themes/jwst/drawers.ts` | ImageData buffer capped at 56² px, bilinear up-scale via `drawImage`. ~60 % first-build cost reduction. |
| Per-id memoised lookups | `tempBucketCacheRef`, `jitterCacheRef` in `StarMap.tsx` | No re-hashing every frame. |
| O(1) raw-stars lookup | `App.tsx rawStarsById` | Replaces `stars.find` in `galaxyOffsetForStarId` and `projectedHighlights`. |

### 4.4 Sprite system

`src/renderer/src/components/StarMap/sprites.ts`.

- `SIZE_RADII = [2.79, 4.19, 5.59, 7.45, 10.24, 14.9, 20.48]` (7 buckets, 1.33× scale from F15). `SIZE_BUCKET_COUNT = 7`.
- `TEMP_BUCKET_COUNT = 4` (warm/warm/cool/cool). `tempBucketFor(id) = hashStr(id) % 4`.
- Cache key for cluster-hue sprites: `${colorIndex}|${tempBucket}|${sizeBucket}|${spikeVariant}|${lod}`. Including `lod` lets `cheap` and `full` coexist.
- `full` tier = halo + core + diffraction spikes (multi-stop gradient; spikes only when `sizeBucket >= 2`).
- `cheap` tier = halo + core only (2-stop gradient). Typed cheap = per-type tinted halo + core, no procedural drawer.
- Per-id rotation + alpha jitter (F8b) are NOT baked into the cache. They are applied at draw time: `defaultJitterFor(id)` returns a stable triple `{ spikeVariant, rotation, alphaJitter }`. Reordering the `rng()` calls in `proc.ts` would reseed all downstream features — treat that order as load-bearing.

### 4.5 Themes

Registry: `src/renderer/src/themes/registry.ts`. Default `jwst`. Available: `jwst`, `vapor`, `atari`, `lost`, `bio` (5 themes).

Theme contract additions (`src/renderer/src/themes/types.ts`): each theme MAY set
- `dprCap?: number` — backing-store DPR cap (Atari = 1.0; others undefined).
- `smoothing: 'high' | 'off'` — main canvas `imageSmoothingQuality`. JWST/Lost/Bio = `'high'`; Vapor/Atari = `'off'`.
- `flatLighting?: boolean` — disables the zoom-driven exposure dim AND the radial vignette. Bio + Lost set true (organic / scenic worlds where stars should always read at full opacity).
- `postPass?: (ctx, w, h, dpr) => void` — full-frame post-pass after sprites + HUD + labels. Vapor uses it for CRT scanlines.
- `background.paint?: (ctx, w, h, dpr, seedKey) => void` — per-theme background renderer (Stage C). JWST paints the Carina deep-field wash; Vapor paints the synthwave gradient + Tron grid. Cached offscreen via `backgroundNebula.ts` keyed on `(seedKey, w, h, dpr)`.
- `background.replacesBackdrop?: boolean` — when true, StarMap skips the prerendered backdrop layer (vapor + JWST set this).

A `Theme` exposes: `id`, `name`, `description`, `drawers` (`Partial<Record<StarType, ThemedDrawer>>`), `defaultDrawer`, `background`, `ui`. `background.canvasFill` is a CSS colour or gradient; optional `overlay()` runs over the backdrop. `ui.accentColor`, `fontStack`, optional `titleTransform` and `titleLetterSpacing`.

| Theme | Accent | Font | Title transform |
|---|---|---|---|
| `jwst` (default) | `#ffe066` (gold) | system-ui sans | none |
| `vapor` | `#ff007a` (hot pink) | VT323 monospace | uppercase, letter-spacing 0.15em |

JWST drawers (`themes/jwst/drawers.ts`) include red-giant convection mottling via FBM (capped at 56² px ImageData; see perf gate). Vapor drawers (`themes/vapor/drawers.ts`) are synthwave with a Tron grid overlay in `background.ts`.

### 4.6 Hooks + localStorage

`src/renderer/src/hooks/`.

| Hook | Purpose | localStorage key | Default |
|---|---|---|---|
| `useVimMode` | Pan/zoom/select keybindings; full table in `Cheatsheet.tsx`. | — | — |
| `useTheme` | Theme picker. | `starpalace.theme.v1` | `jwst` |
| `useGraphicsQuality` | Quality tier. | `starpalace.gfx.v1` | `high` |
| `useClassificationMode` | Type vs usage classifier. | `starpalace.classMode.v1` | `type` |
| `usePcDial` | Active PC axes (X/Y), pin file callback. | `starpalace.pcDial.v1` | axes 0,1 |
| `useCollections` | Collections CRUD via daemon. | persisted server-side | — |
| `useGalaxyVisibility` | F16 per-galaxy show/hide. | `starpalace.galaxyVis.v1` | all visible |
| `useIndexProgress` | F17 SSE subscription per `jobId`. | — | — |

All localStorage hooks follow the `useTheme` pattern: corrupt values → default + clear key.

### 4.7 Vim keymap

Source of truth: `src/renderer/src/components/Cheatsheet/Cheatsheet.tsx`.

| Key | Action |
|---|---|
| `h / j / k / l` | Pan (hold for smooth) |
| `H / J / K / L` | Pan fast (4×) |
| `+ or =` | Zoom in ×1.2 |
| `- or _` | Zoom out ÷1.2 |
| `gg` | Fit all stars in view |
| `gh` | Fit selected cluster |
| `n / N` | Next / prev search result (selects + pans) |
| `Enter` | Select hovered star (or hide search bar when typing) |
| `o` | Open selected in default app |
| `O` | Reveal selected file in file explorer |
| `t` | Open star-type dropdown |
| `T` | Cycle star type forward |
| `c` | Toggle collections sidebar |
| `⌘F / Ctrl+F` | Toggle search bar (keeps query + highlights) |
| `Esc` | Exit search / clear selection |
| `?` | Toggle cheatsheet |
| `i` | Focus the indexer (Galaxy panel path input) |
| `Shift+P` | Toggle perf overlay (registered at App level, not in `useVimMode`) |

Vim-mode caveat: navigation keys pan the canvas rather than move a cursor; `gg` fits the entire sky rather than jumping to line 1.

### 4.8 Quality tiers

**Retired.** The user-facing Low/Med/High/Ultra dropdown was removed; themes own resolution + smoothing + lighting via the Theme contract (see §4.5 Themes). LOD policy is now:

- **Same sprite at every zoom.** The cheap-LOD swap was retired so per-theme aesthetics stay recognisable when zoomed out (the prior fallback hid procedural detail). `lodFor()` in `StarMap.tsx` returns `'full'` unconditionally.
- **DPR cap from theme.** `effectiveDpr = min(window.devicePixelRatio, theme.dprCap ?? Infinity)`. Atari sets `1.0`; others uncapped.
- **Animation overlay** (pulsar/quasar) uses a fixed `animSkipPx = 4` threshold (matches the prior `quality === 'high'` default).
- **Focused stars** (selected, hovered, neighbor, search highlight) get an additional decoration-pass ring; the sprite tier is the same as everything else.

### 4.9 Classification modes

Source: `src/renderer/src/lib/usageStarType.ts` and `src/renderer/src/lib/autoStarType.ts`.

- `type` (default, F2) — `defaultStarType(name, mimeType)` maps extensions to types: `.pptx/.ppt/.key → pulsar`, `.pdf → quasar`, `.csv/.tsv → white-dwarf`, `.json/.yaml/.yml → neutron-star`, `.zip/.tar/.gz/.tgz/.bz2 → black-hole`, `image/* → nebula`, default `main-sequence`. A manual `Star.starType` override always wins.
- `usage` (F10) — `usageStarType(score, buckets)` maps `importance_score` to type via percentile buckets `p50 / p80 / p95`. Buckets are computed at App level via `computePercentileBuckets(scores)` from all loaded stars. Boundary comparator uses `<=` so tied scores fall into the lower bucket. Percentile method is floor-index on a sorted array (no linear interpolation).

Size buckets in usage mode (`StarMap.tsx`):

```
score < 1   → 0
score < 5   → 1
score < 12  → 2
score < 25  → 3
else        → 4
```

### 4.10 Perf overlay

`src/renderer/src/lib/frameMetrics.ts` is a module-level singleton with a 240-entry ring buffer of frame deltas plus a separate skipped-frame counter.

`record(deltaMs, interacting, visibleStars)` is called once per drawn frame; `recordSkipped()` is called by the dirty gate. `interacting` is true while a mouse drag, vim pan, pin drag, or wheel event happened within the last 200 ms — distinct from autonomous animation.

`snapshot()` computes FPS, p50 / p99 / worst ms, dropped (> 33 ms) count, interacting-only avg + p99.

`src/renderer/src/components/PerfOverlay/PerfOverlay.tsx` polls `snapshot()` every 250 ms. Hidden by default — zero cost when off. Toggle `Shift+P`. Buttons: `reset` (clears buffer), `copy` (writes a plaintext summary to clipboard + console).

---

## 5. Features (F-index)

Source of truth for status: `REQUIREMENTS.md:17–37`. Every feature except F18/F19 is on `main`; F18/F19 are spec-only on the `docs/embedding-quality` branch.

| ID | Feature | Status | Where |
|---|---|---|---|
| F1 | Search pop + extended zoom + zoom-exposure | DONE | `StarMap.tsx`, `App.tsx` search pulse |
| F2 | Auto-schema (extension → star type) | DONE | `lib/autoStarType.ts` |
| F3 | PC dial (pick X/Y from top-8 components) | DONE | `components/PCDial/`, `usePcDial.ts`, `/api/map/projection` |
| F4 | Manual reposition + pin (embedding-delta) | DONE | `pinMath.ts`, `/api/file/:id/pin`, sign-flip detection in `Relayouter.train` |
| F5 | Virtual collections (static + dynamic) | DONE | `collections` + `collection_members` tables, 7 endpoints, `CollectionsPanel`, hull rendering |
| F6 | Vim mode | DONE | `useVimMode.ts`, `Cheatsheet.tsx` |
| F7 | Hierarchical k-means / LOD tree | NOT STARTED | (re-architecture; biggest blast radius) |
| F8a | Procedural foundation (PRNG, jitter, noise) | DONE | `components/StarMap/proc.ts` |
| F8b | Per-id sprite jitter (rotation + alpha) | DONE | applied at draw time, see §4.4 |
| F8c | Procedural cluster nebulae | PARTIAL | scaffolded on `worktree-agent-a17bad25b08d83f97`; not on main |
| F8d | Deep-zoom planet view | NOT STARTED |  |
| F9 | Galaxies (multi-root indexing) | DONE | `galaxies` table, `galaxy_id` column, `GalaxyPanel`, `GALAXY_SPIRAL_STEP` |
| F10 | Usage-driven star classification | DONE | `os_use_count`, `os_last_used`, `importance_score`, `usageMetadata.ts`, `usageStarType.ts`, `useClassificationMode.ts` |
| F11 | Theme selector (5 themes: jwst, vapor, atari, lost, bio) | DONE | `themes/registry.ts`, `useTheme.ts` |
| F-NEXT-A..D | Crisp graphics rework (DPR-aware sprites, halo grading, per-theme bg paint, vapor CRT) | DONE | `sprites.ts`, `backgroundNebula.ts`, `vaporCrt.ts` |
| B1 | Tags + embedding strategies + schema | DONE | `embedding/strategies.ts`, `db/FileIndex.ts` (tags + embedding_strategy + app_settings + snapshot tables), `EmbeddingEngine.embedFile(node, content, strategy, tags)` |
| B2 | Experiment endpoints + subset PCA + snapshot promote/revert | DONE | `embedding/experiments.ts`, `embedding/snapshots.ts`, `Relayouter.trainSubset()` |
| B3 | Embedding Lab UI (`Shift+E`) + DetailPanel tag input | DONE | `components/EmbeddingLab/`, `DetailPanel.tsx` chip list, `api.ts` wrappers |
| F12 | Selection pulse animation | DONE | sine wave in `StarMap.tsx` decoration pass |
| F13 | Search-match explainability (literal + AI) | NOT STARTED |  |
| F14 | Reveal in OS file explorer | DONE | `O` keybinding, `/api/file/:id/reveal` |
| F15 | Reduce glow / expose procedural detail | DONE | sprite halo alpha + 1.33× icon scale |
| F16 | Galaxy visibility toggle | DONE | `useGalaxyVisibility.ts`, GalaxyPanel checkboxes |
| F17 | Indexing progress bar | DONE | SSE in `progressStore.ts`, `useIndexProgress.ts`, `GalaxyPanel` fill |
| F18 | Oversize embedding fallback | SPEC ONLY | on `docs/embedding-quality` (commit `8943a53`); not implemented |
| F19 | Metadata-aware embedding | SPEC ONLY | on `docs/embedding-quality` (commit `8943a53`); not implemented |

---

## 6. Tests

23 test files under `tests/`. Run with `npm run test` (vitest). Contract tests are excluded by default; opt in via `VITEST_INCLUDE_CONTRACT=1 npm run test:contract`.

**Daemon-side**: `tests/ann/HnswIndex.test.ts`, `tests/api/contract.test.ts` (⚠️ see caveat), `tests/api/FileIndex.test.ts`, `tests/api/galaxySpiral.test.ts`, `tests/api/progressStore.test.ts`, `tests/api/security.test.ts`, `tests/api/usageMetadata.test.ts`, `tests/embedding/OllamaClient.test.ts`, `tests/layout/Pca.test.ts`, `tests/layout/jitter.test.ts`, `tests/layout/pinMath.test.ts`, `tests/pipeline/importanceScore.test.ts`, `tests/pipeline/Insert.test.ts`.

**Renderer-side**: `tests/renderer/{convexHull,coords,frameMetrics,proc,spatialGrid,usageStarType,useClassificationMode,useGalaxyVisibility,useGraphicsQuality,useTheme}.test.ts`.

**SIGSEGV caveat (CLAUDE.md L130–132)**: Any test that imports `src/daemon/index.ts` directly triggers a SIGSEGV on the vitest worker exit due to `hnswlib-node`'s async loader settling concurrently with `node:worker_threads` cleanup. Tests pass before the crash; the crash is on tear-down only. Mitigations:

- Run affected tests in isolation: `npx vitest run path/to/file.test.ts`.
- Route new daemon-side tests through extracted helpers (see `src/daemon/util/openInDefaultApp.ts` for the pattern) instead of importing `src/daemon/index.ts` directly.

---

## 7. Tooling

### 7.1 npm scripts (`package.json`)

| Script | Command | Purpose |
|---|---|---|
| `dev:daemon` | `tsx src/daemon/index.ts` | Daemon on `:7373`. |
| `dev:web` | `vite --config vite.web.config.ts` | Renderer on `:5173`. |
| `lint` | ESLint, `--max-warnings 0`. | |
| `typecheck` | `tsc -p tsconfig.node.json && tsc -p tsconfig.json`. | |
| `test` | `vitest run` (excludes contract tests). | |
| `test:watch` | `vitest`. | |
| `test:contract` | Sets `VITEST_INCLUDE_CONTRACT=1`. | |
| `build:web` | `vite build`. | |
| `index` | `tsx scripts/index-cli.ts` — index a folder from CLI. | |
| `seed:demo` | Fetch corpus + seed daemon. | |
| `prepare` | Wires git hooks. Runs on `npm install`. | |

### 7.2 Key dependencies

`better-sqlite3@^12.9.0`, `cors@^2.8.5`, `express@^4.19.2`, `hnswlib-node@^3.0.0`, `ml-pca@^4.1.1`, `react`, `react-markdown@^10.1.0`, `remark-gfm@^4.0.1`, `undici@^7.25.0`. Dev: `vite`, `vitest`, `typescript`, `eslint`, `tsx`, `supertest`, `@types/*`.

### 7.3 Pre-commit gate

`scripts/git-hooks/pre-commit` runs in series:

```
npm run typecheck
npm run lint
npm run test
```

All three must pass. No `// @ts-ignore`. No `eslint-disable` (except in `vitest.config.ts` and the Vite config files which are excluded from lint). `scripts/install-git-hooks.sh` copies the hook into `.git/hooks/` and is invoked by the `prepare` script in `package.json`, so a fresh `npm install` arms the hook. After cloning into a worktree where `.git/hooks/` is empty, re-run the install script manually.

Conventional commit prefixes: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

### 7.4 Config files at repo root

| File | Purpose |
|---|---|
| `vite.web.config.ts` | Renderer build; root `src/renderer`; `@shared` alias. |
| `vitest.config.ts` | Excludes contract tests by default; opt in via env var. |
| `tsconfig.json` | Renderer + shared TS config (ESNext, bundler resolution). |
| `tsconfig.node.json` | Daemon + scripts TS config. |
| `.eslintrc.cjs` | TS + react-hooks rules; `eslint-disable` directives forbidden. |
| `.gitignore` | Minimal: `node_modules`, `dist`, `.env`. |
| `package-lock.json` | npm v9+ lockfile. |

---

## 8. Git state

### 8.1 Recent main history

```
aa9cf0e docs: surface every shipped feature in README + CLAUDE.md
833652c feat(renderer): perf overlay (Shift+P) for real-user frame metrics
fc7136b perf(renderer): idle prebuild full-tier sprites after stars settle
7107ad5 feat(renderer): quality-driven LOD swap + DPR cap + anim skip
ba40dbc feat(renderer): cheap-tier sprites for LOD swap
468d4b7 feat(renderer): graphics-quality setting (low/medium/high/ultra)
f505496 perf(daemon,renderer): position-delta refresh on layoutVersion bump
5a0c76b perf(renderer): drop App-state hover plumbing
499068b perf(themes): cap JWST nebula FBM ImageData to 56² pixels
b3a99e7 perf(renderer): O(1) raw-stars id lookup in App.tsx
f44b638 perf(renderer): spatial grid + dirty-flag rAF for StarMap draw loop
c49dc36 feat(renderer): F8b per-id sprite jitter + F5 panel onOpen
6dc353e Merge F17: live indexing progress bar via SSE
17b4541 Merge F16: per-galaxy visibility toggle
b4d831a Merge F15 docs: mark feature DONE in REQUIREMENTS
```

The trend is clear: heavy renderer perf work + a quality/LOD system landed across the past dozen commits, capped by docs alignment in `aa9cf0e`. The previous burst was feature merges (F15, F16, F17).

### 8.2 Unmerged branches with unique commits

| Branch | Last commit | Ahead | Behind | Status |
|---|---|---|---|---|
| `docs/embedding-quality` | 2026-05-03 | 1 (`8943a53 docs(REQUIREMENTS): F18 oversize embedding fallback + F19 metadata-aware embedding`) | 12 | Active. Spec-only — adds F18 + F19 to REQUIREMENTS. Should be rebased onto main and merged once the user has reviewed the spec, or cherry-picked. |
| `feat/3d-renderer` | 2026-05-02 | 1 (`6ae79dc feat(3d): scaffold three.js renderer branch (do not merge)`) | 147 | Reference branch. Commit message itself is "do not merge". Treat as a snapshot of an exploratory three.js scaffold; do not delete without user confirmation. |

### 8.3 Stale orphan branches

These local branches have **0 unique commits**: `git log main..<branch>` is empty, meaning all their content has already landed on `main` (typically squashed). Safe to delete with the user's confirmation.

```
feat/backdrop-parallax     feat/star-types
feat/detail-panel          fix/neighbor-ring-pop
feat/f1-quick-wins         fix/neighbor-visibility
feat/jwst-visuals          fix/neighbors-stay-bright
fix/selected-pop           fix/selection-dims-others
fix/zoom-thresholds-smooth
```

In addition, `.claude/worktrees/` contains 9 active agent worktrees (`worktree-agent-*`). These are session-scoped and should not be touched by hand.

### 8.4 Stashes

```
stash@{0}: On main: third-agent wip 5: REQUIREMENTS edits
stash@{1}: On main: third-agent wip 4: F10 (post-spawn parallel)
stash@{2}: On main: third-agent wip 2: F10 + collections + tiny-corpus-2 (dropped to fix App.tsx orphan)
stash@{3}: On main: third-agent wip: galaxy + StarMap + global.css + tests
```

All four are on `main`, all four are agent-WIP labelled "third-agent". Treat as in-flight scratch — verify before popping; some may already be superseded by the F10/F16/F17 merges.

### 8.5 Tags & remotes

- `git tag -l` → empty.
- `git remote -v` → empty. There is no GitHub origin. `gh` CLI is not installed.

---

## 9. Untracked working state

These appear under `git status` as untracked but should not be committed in the current form:

- `.claude/` — Claude Code harness state. Contains `settings.local.json`, `scheduled_tasks.lock`, and `worktrees/` (9 active agent worktrees). Already implicitly project-local; consider adding to `.gitignore` rather than committing.
- `deep-research-reports/` — 4 markdown research artifacts (`report1.md` through `report4.md`, ~28–40 KB each). Independent renderer-perf investigations from different angles. Reference material; not part of the build.
- `optimization-plan.md` — 400-line synthesis of the four deep-research reports into a 4-phase action plan (Phase 0 instrumentation gate → cheap wins → targeted hot-pass fixes → optional WebGL2 migration). Working doc tied to that investigation; not part of the permanent doc set. Consider moving into `deep-research-reports/` once the plan is checked in or executed.
- `scripts/build-tiny-corpus-2.mjs` — 19 KB Node ESM script. Self-contained generator for a maritime-themed test corpus (~30 files, intended for multi-galaxy testing). Companion to the older `scripts/build-tiny-corpus.mjs`. Run with `node scripts/build-tiny-corpus-2.mjs`; outputs to `tiny-corpus-2/`. Not yet wired into npm scripts.

---

## 10. External prerequisites

To run the full stack locally:

```
ollama serve
ollama pull nomic-embed-text
```

Daemon polls Ollama health on each `/api/health`. If Ollama is unreachable, indexing and search fail; the renderer's daemon-status indicator flips, but it does not crash. Embeddings call `POST http://localhost:11434/api/embeddings` with `{ model: 'nomic-embed-text', prompt, options: { num_ctx: 8192 } }`.

---

## 11. Known caveats

- **SIGSEGV on test teardown** — see §6. Crash is post-test; CI must accept it or run affected tests in isolation.
- **No remote configured** — pushes will fail until `git remote add origin <url>`.
- **11 stale local branches** — see §8.3. Cleaner repo if pruned.
- **4 WIP stashes on main** — see §8.4. Consider triaging.
- **F8b jitter is applied at draw time** — sprite cache key intentionally excludes per-id rotation/alpha. Reordering `rng()` calls in `proc.ts:89–95` reseeds all downstream features; treat the call order as a stable contract.
- **Sprite radii are 1.33× the original F1 values** — see `sprites.ts:11`. Any code that compares radii to a magic number must be re-checked.
- **F9 default galaxy** — pre-F9 rows are backfilled to a sentinel galaxy with `root_path = '__default__:default'`. Walkers that target this path are a smell; new walks should provide a real `galaxyName`.
- **Percentile classifier (F10) is corpus-wide, not per-galaxy** — a galaxy of frequently-used files reads as mostly red giants; a galaxy of unused files reads as mostly white dwarfs. Documented limitation in REQUIREMENTS.md L589.

---

## 12. How to run

```
# 1. Prerequisites
ollama serve
ollama pull nomic-embed-text

# 2. Install + arm git hooks
npm install

# 3. Start daemon and renderer in separate terminals
npm run dev:daemon    # :7373
npm run dev:web       # :5173

# 4. Index a folder via UI
#    - Open http://localhost:5173
#    - Press `i` (or click the Galaxy panel top-right)
#    - Type an absolute folder path; optionally name the galaxy
#    - Click "Index"

# Or index from CLI
npm run index -- /absolute/path

# Or seed the demo corpus (downloads ~84 MB)
npm run seed:demo

# Verification before any commit
npm run typecheck && npm run lint && npm run test
```
