# REQUIREMENTS — Starmap "Star Palace" (alternate)

## Vision

A persistent star map of the user's files. Each file is a star with a stable 2D position. Semantically related files are spatially near each other. Adding a new file places a new star without disturbing the rest of the sky. Searching pans the camera to find a star or a region. The map is the product; queries are a way to navigate it.

The user returns to the same view session after session. Spatial memory accrues.

---

## Core use cases

1. **Browse the sky** — open the app, see the full map of all indexed files. Pan, zoom, hover for metadata.
2. **Search to navigate** — type a query; camera animates to the matching region; matching stars highlight.
3. **Recenter on a file** — click a star; camera zooms to it; its top-K neighbors highlight.
4. **Watch the sky grow** — newly indexed files appear with a subtle visual marker for N days; user perceives the map evolving.
5. **Local neighborhood inspection** — hover a star → see its top-K neighbors with weights and metadata.

Note: "Generate a 50-node subgraph for query X" is not a primary use case here. It is a side effect of search → highlight.

---

## Conceptual model

| Concept | Meaning |
|---|---|
| **Star** | An indexed file with a persistent 2D coordinate. |
| **Constellation** | A cluster of mutually similar stars, computed via community detection on the persistent edge graph. Has its own color and a centroid label. |
| **Sky** | The full set of stars + constellations + edges, persisted in SQLite. |
| **Camera** | Renderer-side viewport: pan, zoom, animated transitions. |
| **Anchor** | A star whose position is locked across re-layouts (user-pinned or frequently-viewed). |
| **Drift** | Divergence between current 2D positions and what a fresh projection of the current embedding distribution would produce. Triggers background re-fit when above threshold. |

---

## Engine

### Embedding-first

The default similarity engine is `EmbeddingEngine`, not `MetadataEngine`. The semantic graph is the *substrate* for the spatial layout — lexical/structural signals are too coarse to produce a meaningful map.

- **Local model default:** Ollama `nomic-embed-text` (768d). Pluggable via config.
- **Cloud model opt-in:** OpenAI `text-embedding-3-small`, Voyage AI, etc., behind a config flag. Off by default for privacy.
- **ANN index:** `hnswlib-node`, persisted at `~/.starmap/hnsw.bin`. Reloaded on daemon start.
- **Embedding cache:** stored in `files.embedding BLOB`. Re-embed only when `stale=1`.

### MetadataEngine retained as cold-start + bootstrap

- Used for the first ~50–200 files before embedding model has produced enough vectors to bootstrap a projection.
- Used as a candidate pre-filter for very large indexes (>50k files): MinHash LSH gives O(1)-ish bucket retrieval, embedding cosine re-ranks within the bucket. Hybrid path is mandatory at scale.

---

## Layout — the central design problem

The map must satisfy:

1. **Stable** — existing positions move minimally when new files are added.
2. **Semantically faithful** — distance in 2D approximates semantic distance in embedding space.
3. **Incremental** — inserting a file is O(local neighborhood), not O(n).
4. **Recoverable** — if drift accumulates, a background process can re-fit without catastrophic visual disruption.

### Approach: parametric 2D projection of embeddings

The 2D position is a deterministic function of the embedding:

```
pos(file) = project(embedding(file))
```

where `project: ℝ^768 → ℝ^2` is a learned parametric model.

**Initial training of `project`:**
- Triggered when index reaches a minimum size (default: 200 files with embeddings).
- Algorithm: parametric UMAP (preferred) or PCA fallback. PCA is closed-form, fast, and incremental-friendly; UMAP gives qualitatively better cluster separation.
- Runs in a worker thread (`worker_threads`) so the daemon stays responsive.
- Output: model parameters serialised to `~/.starmap/projection.bin`.

**Inserting a new file:**
1. Compute embedding (Ollama call, ~10–100ms).
2. Apply current `project` model: `(x, y) = project(embedding)`. Pure forward pass, no optimisation.
3. ANN-query top-K (default K=20) nearest neighbors in embedding space.
4. Insert top-K edges into `edges` table.
5. For each of the K neighbors, check whether the new file displaces their current K-th edge; update if so.
6. Assign cluster: plurality vote among top-K neighbors' `cluster_id`. If no plurality or all isolated, new cluster.
7. Write `files.x`, `files.y`, `files.cluster_id`, `files.first_seen = now`.

Total cost per insert: O(K log n) for ANN + O(K) for edge updates. No global recomputation.

**Drift detection (background):**
- Sampled diagnostic: pick M random files (default M=200), measure correlation between their pairwise 2D distances and pairwise embedding cosine distances. Score = Spearman ρ.
- Runs hourly (or after every 1000 inserts, whichever comes first) in a low-priority worker.
- If ρ drops below threshold (default 0.6), trigger a background re-fit.

**Background re-fit:**
- Re-trains `project` on full embedding set in a worker.
- Uses **anchor nodes** to constrain the new projection: orthogonal Procrustes alignment of new positions to old positions, weighted by anchor mass. User-visited / user-pinned files have higher anchor mass.
- New positions written to `files.x`, `files.y` with a `layout_version` bump.
- Renderer animates transitions over 1–2 seconds when it detects a `layout_version` change.

**Cold start (< 200 embeddings):**
- Use `cose` layout on whatever exists. Positions are transient, marked `layout_version=0`.
- When threshold reached, first projection trains and overwrites positions with `layout_version=1`. Animated transition.

### Why not force-directed incremental?

Force-directed (cose, ForceAtlas2) updated incrementally tends to oscillate: each insert nudges neighbors, which nudge their neighbors, with no convergence guarantee. Stability suffers. Parametric projection gives a deterministic position from a fixed model — by design, the only way positions move is when the model itself is re-fit.

### Why not raw UMAP per insert?

UMAP is global. Inserting a single point requires re-optimising the whole embedding for theoretical correctness. Parametric UMAP (a learned function approximating the UMAP transform) lets new points land deterministically without re-optimisation, at the cost of some accuracy that drift detection corrects.

---

## Edges (persisted)

Schema:

```
edges (
  src_id    TEXT NOT NULL,
  dst_id    TEXT NOT NULL,
  weight    REAL NOT NULL,        -- cosine similarity in [0, 1]
  engine    TEXT NOT NULL,         -- 'embedding' | 'metadata'
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (src_id, dst_id)
)
```

Invariant: each `src_id` has at most K outgoing edges (top-K nearest neighbors). K configurable (default 20).

Edges are **only** updated on file insert, file re-index, or full re-layout. Never on query.

A query path that needs edges (e.g., "show neighborhood of file F") does a single indexed read: `SELECT * FROM edges WHERE src_id = ?`.

---

## Constellation grouping

Computed on the full persistent edge graph, not per-query. Stored in `clusters` table.

```
clusters (
  id           INTEGER PRIMARY KEY,
  color_index  INTEGER NOT NULL,
  centroid_x   REAL,
  centroid_y   REAL,
  member_count INTEGER,
  label        TEXT          -- optional user-assigned name
)
```

- **Algorithm:** Louvain community detection on the edge graph weighted by cosine similarity.
- **Recomputation:** debounced background job. Runs after every N inserts (default 100) or on full re-layout.
- **New file assignment:** plurality vote among its top-K neighbors' clusters. Cheap, no full Louvain run.
- **Color:** assigned by `color_index % palette.length`. Palette unchanged from current REQUIREMENTS.md.
- **User labels:** users can name a constellation ("research", "tax docs"). Label persists across re-layouts and recomputes — bound to `cluster_id`, not to position.

Isolated stars (no edge above similarity threshold 0.3) have `cluster_id = NULL`, dim grey color, no glow.

---

## Schema additions to `files`

| Column | Type | Purpose |
|---|---|---|
| `embedding` | `BLOB` | Float32Array of dim 768. |
| `x` | `REAL` | Persistent 2D x coordinate. |
| `y` | `REAL` | Persistent 2D y coordinate. |
| `cluster_id` | `INTEGER` | FK to `clusters.id`. NULL for isolated. |
| `layout_version` | `INTEGER` | Increments on each global re-layout. |
| `first_seen` | `INTEGER` | Unix ms. Used for "new since" visual marker. |
| `view_count` | `INTEGER` | Anchor-mass input for re-layouts. |
| `is_pinned` | `INTEGER` | 1 = user-locked position; immune to re-layout repositioning. |

`pos`-related columns may be NULL for files in cold-start phase. Renderer skips NULL-position files.

Additional table:

```
layout_meta (
  version          INTEGER PRIMARY KEY,
  algorithm        TEXT,      -- 'cose' | 'pca' | 'umap'
  projection_model BLOB,      -- serialised parametric model
  computed_at      INTEGER,
  node_count       INTEGER,
  drift_score      REAL       -- last-measured correlation
)
```

---

## Daemon API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness. |
| `/api/map/viewport` | GET | Query: `?x1=&y1=&x2=&y2=&zoom=`. Returns stars within bounds, decimated by zoom level. Optionally edges among them. |
| `/api/map/stats` | GET | Total stars, clusters, layout version, drift score, last re-fit timestamp. |
| `/api/search` | POST | Body: `{ query: string, limit?: number }`. Returns matching star IDs + coordinates + scores. Renderer animates camera to the bounding box. |
| `/api/file/:id` | GET | Full metadata for one file. |
| `/api/file/:id/neighborhood` | GET | Top-K edges + neighbor metadata. |
| `/api/file/:id/pin` | POST | Body: `{ pinned: boolean }`. Toggles `is_pinned`. |
| `/api/cluster/:id` | GET | Cluster metadata, member IDs, centroid. |
| `/api/cluster/:id/label` | POST | Body: `{ label: string }`. Set/update user label. |
| `/api/relayout` | POST | Admin: force a re-fit. |

CORS enabled for all origins. Renderer never invokes Node APIs directly. Port `7373` (`DAEMON_PORT`).

---

## Graph display

### The persistent map

- **Always-on full-sky view** — the renderer's default and primary state.
- **Camera controls:** pan (drag), zoom (scroll/pinch), keyboard shortcuts.
- **Level-of-detail:**
  - Zoom < 0.3: render only stars with `view_count` in top decile **or** degree in top decile. Constellations rendered as filled translucent shapes.
  - Zoom 0.3–1.0: render stars in viewport with opacity scaled by importance.
  - Zoom > 1.0: render all stars in viewport, plus labels, plus visible edges among result/highlight set.
- **Edges:** rendered only on hover, on search, or on click. Never as a default background — at scale, edges become visual noise.
- **Constellations:** rendered as faint filled convex hulls (or alpha-shape) in the constellation color, opacity ~0.15. Like nebulae behind the stars. Always visible.
- **Constellation labels:** drawn at centroid in the constellation color, font size scaled by member count. Visible at all zoom levels above 0.5.

### Visual encoding

- Star size: mapped from `log(view_count + 1)` on a `[12, 36]` px range. (Replaces the old `mapData(score, 0, 1, 16, 40)` — there is no per-query "score" anymore.)
- Star color: constellation color.
- Star glow: `0 0 8px <color>` default; `0 0 14px <color>` for highlighted/origin.
- Search highlight: matching stars get a yellow `#ffe066` ring (2px, glowing). Non-matching stars dim to opacity 0.4.
- "New since last session" marker: subtle pulsing ring for files where `first_seen > last_session_open`. Clears after one full session view.
- Pinned marker: small lock icon in HoverCard; subtle ring at high zoom.

### Search → camera animation

1. User types query.
2. Daemon returns ranked IDs + their `(x, y)`.
3. Renderer computes bounding box of top-N results.
4. Camera animates pan + zoom to bounding box over ~600ms with easing.
5. Highlight applied; non-matching dimmed.
6. Pressing Escape clears highlights and returns to free browse.

### Other display rules unchanged

- Color palette, constellation palette, star field background, nebula blobs, typography, transitions, hover behavior — keep as in the original REQUIREMENTS.md.

---

## Indexing

Mostly unchanged from the original plan:

- SQLite at `~/.starmap/index.db`, WAL mode, `STARMAP_DB` override.
- Walker ignores `node_modules`, `.git`, `.DS_Store`, `dist`, `__pycache__`, `.next`, `build`, `coverage`.
- 5 MB max file size.
- Chokidar marks files `stale=1` on change/delete.
- Daemon start does mtime diff scan.
- Stale files re-indexed lazily when they appear in queries or background work.

Added:

- On re-index, embedding is recomputed if content fingerprint changed; otherwise skipped.
- On re-index that produces a sufficiently different embedding (cosine to old < 0.95), `(x, y)` is recomputed via current `project` model and animated to the new position.

---

## Caching

- **Query result cache:** still useful for repeated identical search strings — keyed on normalised query string, small LRU.
- **Platform API cache:** 10-minute TTL for cloud platform metadata calls.
- **Hot file cache:** **removed.** Edge persistence makes it unnecessary; neighborhood queries are O(K) reads from `edges`.
- **Viewport cache:** the renderer caches the most recent N viewport responses keyed on `(zoom-bucket, bounds-bucket)` — coarse spatial key — to make panning feel instant.

---

## Platforms

- **v1:** Local filesystem + Google Drive.
- **v2:** Confluence, Dropbox, OneDrive/SharePoint.

Cloud surface deferred to focus engineering on the layout/persistence pipeline. Adding a new platform is mostly an indexer — once a file enters the SQLite index with content for embedding, it joins the sky like any other.

---

## File types

Same taxonomy as the original REQUIREMENTS.md (document, data, code, media). Embedding works on text content; for non-textual files:

- **Document, code, data:** embed file content (truncated to 8k tokens).
- **Media:** embed filename + path + extracted EXIF/ID3 metadata as a synthetic text representation. Acknowledged as a weak signal — these stars cluster by filename patterns more than content.

---

## Scale targets

- Local index: up to 100k files.
- Insert latency: < 200 ms (embedding call dominates).
- Search latency: < 100 ms.
- Map viewport fetch: < 50 ms for any viewport at any zoom.
- Background re-fit: < 30 s for 100k files on a modern laptop.

LSH banding for MetadataEngine candidate filtering is required at scale (`b=32, r=4`), stored as `minhash_bands` inverted-index table.

---

## Non-goals (v1)

- No real-time collaboration.
- No file editing or preview.
- No mobile.
- No "ego graph" / per-query subgraph layout — search returns highlights on the persistent map only.
- No manual edge editing — the user does not draw or break edges.

---

## Future work

Out of scope for v1 but tracked here so the architecture leaves room.

### 3D projection mode

- Optional `project: ℝ^768 → ℝ^3` parametric model (UMAP `n_components=3` or PCA top-3).
- Camera becomes an orbit camera (yaw/pitch/zoom + dolly) rather than pan/zoom.
- Schema: add `files.z REAL`, nullable; v1 ignores it. `layout_meta.algorithm` extended to `'pca-3d' | 'umap-3d'`.
- Occlusion: depth-sorted draw, additive blending so foreground stars don't fully hide background ones.
- Decision deferred: 2D first, prove the layout pipeline, then add 3D as a renderer toggle.

### Shader-grade rendering

Push the visual from "stylised CSS" to "JWST-grade." Mandates a WebGL renderer (Three.js or regl) — CSS/SVG hits a ceiling well before the 100k-star target.

- **Bloom / HDR glow:** post-process pass instead of `drop-shadow`. Per-star intensity from `view_count` + highlight state. UnrealBloomPass or custom dual-Kawase.
- **Twinkle:** per-star phase-offset opacity oscillation (`sin(t * f + phase)`), `f` ~0.3–1.5 Hz, amplitude scaled by star size. Cheap; runs in vertex/fragment shader from a `(phase, freq)` attribute.
- **Parallax star field:** 3–4 background layers of decorative stars at fractional pan rates. Multiplies the sense of depth on drag.
- **Edges as gradient filaments:** drawn only on hover/search as soft additive lines with alpha falloff at endpoints — not flat solid strokes.
- **Constellation nebulae:** soft alpha-blended noise textures (Perlin/Worley) tinted by cluster color, replacing the flat convex hulls. Density modulated by member count.
- **Milky-Way-like backdrop:** density gradient tied to global cluster centroid distribution — denser starfield where the sky is "busier."
- **Tone mapping:** ACES filmic on the final framebuffer so bloom doesn't blow out to white.

### Other

- WebGPU path once Three.js / regl support stabilises across Electron and browsers.
- VR/AR view of the 3D sky (WebXR). Speculative.
- Audio: subtle ambient drone keyed to cluster the camera is centered over.

---

## Open questions

1. **Projection algorithm:** parametric UMAP (better separation, heavier dependency, slower training) vs incremental PCA (closed-form, fast, simpler — but less visually pleasing clusters)?
2. **Cold-start UX:** show transient `cose` layout immediately, or hold off rendering until first projection is trained (avoids the "jolt" but makes the app feel empty for the first ~30 seconds on first run)?
3. **"New since" marker scope:** files added in the last session, last 7 days, or until the user dismisses?
4. **User pinning:** include in v1 (locks position) or defer to v2?
5. **Constellation labeling:** automatic name suggestions (e.g., from top tf-idf terms across cluster) or user-only?
6. **Drift correction visibility:** does the user see a notification when a re-fit is about to happen, or is it silent with animation?
