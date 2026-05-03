# REQUIREMENTS — Starmap "Star Palace"

## Vision

A persistent star map of the user's files. Each file is a star with a stable 2D position. Semantically related files are spatially near each other. Adding a new file places a new star without disturbing the rest of the sky. Searching pans the camera to find a star or a region. The map is the product; queries are a way to navigate it.

The user returns to the same view session after session. Spatial memory accrues.

## Design philosophy — memory palace, not query graph

Position is the artifact, not a presentational byproduct. Layout is precomputed, persisted, and updated incrementally — never recomputed at query time. Search returns coordinates and IDs; the renderer pans the camera, it does not lay out a new graph. The ANN index over embeddings drives positioning. Edges are persisted (top-K neighbors) and updated on insert. The system's job: assign each file a coordinate that respects semantic structure, then never move it without good reason.

---

## v2 feature roadmap

Locked decisions:
- Pin policy: **pin in embedding-delta** (offset stored in embedding space, reprojected onto whichever PC pair is active). Survives PC switch.
- Hover bug + DetailPanel + JWST visuals + 9 manual star types are already shipped on `main` (commits `4b03f06`, `ae50d6a`, `cf3999d`).

| ID | Feature | Effort | Notes | Status |
|---|---|---|---|---|
| F1 | Search pop + extended zoom + zoom-exposure | XS | Visual only; same-day. | **DONE** |
| — | **BUG**: neighbor stars still vanish at high zoom despite bypass-cull fix | — | Resolved by `bfd8d6a` + `6b8d5bc` (cull-bypass + edge chevrons). | **DONE** |
| F2 | Auto-schema (extension → star type) | S | Renderer fallback only; no DB migration. | **DONE** |
| F3 | PC dial (pick X/Y from top-8 components) | M | Layout meta change; no schema for files. | **DONE** |
| F4 | Manual reposition + pin | M | New columns; embedding-delta math. | **DONE** |
| F5 | Virtual collections | M-L | New tables + endpoints + render hull. | **DONE** |
| F6 | Vim mode | M | Pure UI; no backend. | **DONE** |
| F7 | Hierarchical k-means / LOD tree | L | Re-architecture; biggest blast radius. | |
| F8 | Procedural per-file graphics | L | Bigger graphics push: every file's visual is hash-derived. F8a foundation (`proc.ts`) and per-id variation shipped via F11 across both themes. F8b/F8c/F8d remain. | F8a **DONE** |
| F9 | Galaxies (multi-root indexing) | M | New table + galaxy_id column; spiral origin offsets; renderer panel. | **DONE** |
| F10 | Usage-driven star classification (mode toggle) | M | New columns (os_use_count, os_last_used, importance_score); new `main-sequence` STAR_TYPE; renderer toggle "Color by: [Type] [Usage]". | **DONE** |
| F11 | Theme selector (visual aesthetic switch) | M | Pluggable theme registry; ships with `jwst` (deep-space realism) + `vapor` (synthwave/chromatic-aberration). Same functionality across themes, different drawers + chrome. Renderer-only; localStorage. Two F8a prototype decks archived under `prototypes/f8a` + `prototypes/f8a-vapor`. | **DONE** |
| F12 | Selection animation (pulse / breathe) | XS | Renderer-only; replaces SPRITE_SELECTED_BOOST_ALPHA static treatment with a time-varying pulse. | **DONE** |
| F13 | Search-match explainability (literal hits + AI insight) | M | Two complementary surfaces in DetailPanel for understanding *why* a file ranked for a query. (a) **Literal**: highlight every occurrence of the query string inside the file content viewer (case-insensitive, scrolls to first hit). (b) **AI insight**: new daemon endpoint calls an LLM with the query + the embedded text + neighborhood snippet → returns a 1-2 sentence explanation of the semantic association. Renderer-only for (a); new daemon endpoint + LLM dependency for (b). | |
| F14 | Reveal in OS file explorer (capital O) | XS | Vim `O` (capital) opens the selected file's containing folder in the OS file explorer with the file selected. New daemon endpoint + DetailPanel button. macOS `open -R`, Windows `explorer /select,`, Linux `xdg-open <dirname>`. Lowercase `o` keeps existing "open file in default app" behaviour. | **DONE** |
| F15 | Reduce glow / expose procedural detail | XS | Bright additive halos drown out the per-instance procedural detail (red giant mottling, nebula FBM, neutron-star nucleus dots). Lower exposure curve + sprite halo alpha so the artwork reads. | **DONE** |
| F16 | Galaxy visibility toggle (hide / show) | S | Renderer-only filter on indexed galaxies. Per-galaxy show/hide checkbox in GalaxyPanel. Hidden galaxies still indexed in DB; just absent from the StarMap, search results, and stats counts. Persisted in `localStorage`. | **DONE** |
| F17 | Indexing progress bar | S | Live progress UI while `POST /api/index` walks a directory. Walker emits `{scanned, indexed, skipped, errors, currentPath}` events; renderer subscribes via SSE or polls a status endpoint. Shows in GalaxyPanel as a progress fill + "234 / ~1500 (15%)" text. Currently the indexer blocks UI feedback until the whole walk completes. | **DONE** |

Detail for each feature is inlined into the relevant section below (Layout, Schema, API, Graph display, etc.). Recommended sequencing at the bottom.

---

## Core use cases

1. **Browse the sky** — open the app, see the full map of all indexed files. Pan, zoom, hover for metadata.
2. **Search to navigate** — type a query; camera animates to the matching region; matching stars highlight and pop.
3. **Recenter on a file** — click a star; camera zooms to it; its top-K neighbors highlight.
4. **Watch the sky grow** — newly indexed files appear with a subtle visual marker for N days; user perceives the map evolving.
5. **Local neighborhood inspection** — hover a star → see its top-K neighbors with weights and metadata.
6. **Reposition manually** — drag a star to a chosen spot; position persists across daemon restarts and re-layouts (F4).
7. **Group into collections** — save a query result or hand-picked set as a named, persistent collection rendered as its own constellation hull (F5).
8. **Drive by keyboard** — vim-style modal navigation across the entire UI (F6).
9. **Drill into hierarchy** — zoom out sees mega-clusters; zoom in expands them recursively into child clusters and ultimately individual stars (F7).
10. **Deep-zoom planet view** — zoom past the star-sprite scale and individual files render as unique procedural planets (F8d).

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
| **Collection** | User-defined group of files (static list or dynamic query) rendered as its own hull. Independent of clusters. |
| **Tree node** | A node in the hierarchical k-means tree (F7). Leaves point to files; interior nodes have a centroid + member count. |

---

## Engine

### Embedding-first

The default similarity engine is `EmbeddingEngine`, not `MetadataEngine`. The semantic graph is the *substrate* for the spatial layout — lexical/structural signals are too coarse to produce a meaningful map.

- **Local model default:** Ollama `nomic-embed-text` (768d). Pluggable via config.
- **Cloud model opt-in:** OpenAI `text-embedding-3-small`, Voyage AI, etc., behind a config flag. Off by default for privacy.
- **ANN index:** `hnswlib-node`, persisted at `~/.starpalace/hnsw.bin`. Reloaded on daemon start.
- **Embedding cache:** stored in `files.embedding BLOB`. Re-embed only when content fingerprint changes.

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
5. **Re-axable** — the user can swap which principal components drive X and Y without retraining or schema migration (F3).
6. **Pin-respecting** — user-pinned positions survive layout retrains and PC-pair switches via embedding-delta math (F4).

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
- Output: model parameters serialised to `layout_meta.projection_model` (JSON).

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

### F3 — PC dial (pick X/Y from top-8 components)

Different PC pairs surface different structure. Let the user flip axes.

- PCA training computes top **8** components (was 2). Top-2 stays the default for back-compat.
- Renderer UI: two dropdowns "X = PC1", "Y = PC2" (top-right corner, near search). On change, all stars reproject and the canvas re-fits.
- Choice persists in `localStorage`.
- Reprojection is client-side: daemon ships all 8 PCs once; client computes `x = embedding · pcX`, `y = embedding · pcY` per star on selection.
- `clusters` and per-file `cluster_id` are PC-pair-independent (cluster on full embedding, not projection). No change.
- `Pca.ts`: `StarPca.train(embeddings)` keeps top-K (K=8); `pca.project(embedding, axisX, axisY)` dots with selected components; `pca.serialize()` includes `componentCount` + 8×D matrix.
- Migration: one-time `relayouter.train()` on startup if `componentCount < 8`; existing `pca_v1` rows ignored or auto-upgraded.

### F4 — Manual reposition + pin (embedding-delta policy)

User drags a star to a new spot. Position is permanent (survives daemon restart, layout retrains, PC switches). Embedding remains unchanged so semantic search is unaffected.

**Pin policy (locked) — embedding-delta:** at pin time the user wants `(targetX, targetY)` while axes `pcA`, `pcB` are active. Solve for `Δ = α·pcA + β·pcB` such that `Δ·pcA = targetX − naturalX` and `Δ·pcB = targetY − naturalY`. PC vectors are orthonormal so `α = (targetX − naturalX)`, `β = (targetY − naturalY)`. Persist `(α, β, axisA_idx, axisB_idx)`.

On any future PC pair (X, Y):

```
Δ·pcX = α(pcA · pcX) + β(pcB · pcX) = α[A==X] + β[B==X]
```

Offset only manifests on axes that were active at pin time. On unrelated PC axes the displayed position equals the natural projection. User-visible meaning: "I pinned this in the PC1×PC2 view; on PC3×PC4 the file is back where the math says it should be."

**Behavior:**
- Drag a star (mousedown on hovered star + drag): live preview updates as cursor moves.
- Release → `POST /api/file/:id/pin` with `{ targetX, targetY, axisA, axisB }`.
- Daemon computes `α, β`, stores, sets `is_pinned = 1`.
- Unpin via DetailPanel button → `POST /api/file/:id/unpin`; clears all 5 columns.
- Relayouter on retrain does **not** overwrite `(x, y)` for pinned files — reads pin coefficients and applies the offset to the natural projection.
- Renderer always receives the *displayed* position (natural + offset); it doesn't need to know about pin internals.

**Edge cases:**
- Drag while no PCA model trained → reject.
- Pin a file with null embedding (binary/media without text) — allow; `naturalX = naturalY = 0` so `α = targetX`, `β = targetY`.
- Re-pin: overwrite previous atomically.
- Search: embedding unchanged; ANN results unchanged. Pin only affects display.

**Implementation (shipped):**
- Gesture: **Shift + mousedown on a hovered star** starts the drag. Plain drag continues to pan everywhere; the Shift modifier is the explicit pin signal (no click-vs-drag threshold). Esc cancels mid-drag.
- Pin math lives **client-side** in `usePcDial.scaledById`. The renderer adds `α/β` to the active axes' natural PC values before computing per-axis min/max scale, so the pinned star lands at the requested world position even on PC-pair switches.
- Daemon endpoint takes PC-space `(x, y)` (not world coords); the renderer inverts its own min/max scaling locally via `worldToPc(...)` before posting. Keeps the daemon ignorant of the renderer's normalisation state.
- PCA sign-flip on retrain: `Relayouter.train()` captures the previous eigenvectors, calls `detectSignFlips(old, new)`, and `db.applyPinSignFlips(...)` negates `α/β` on any axis where the dot-product flipped sign. Where `|dot| < 0.9` the axis is logged as unstable and offsets are left as-is (best-effort).
- Visual surface: gold lock glyph above pinned stars at `cam.zoom > 1.5`, dashed line preview during drag, lock badge in HoverCard, "Pinned at PC{a} × PC{b}" + Unpin button in DetailPanel.

**Known limitations (logged from ship):**
1. **Min/max rebase**: the per-axis min/max calc includes pinned files. Dragging a star far outside the natural cluster bounds compresses everything else toward centre. Spec-faithful; mitigation (exclude pinned from bounds) deferred.
2. **PCA axis swap on retrain**: when two close eigenvalues swap order between trains, the sign-flip detector returns 0 and the offset is left untouched (logged `[F4] pin axis k unstable`). Visually the pin will look wrong until the user re-pins. Rare in practice.
3. **No `(x, y)` write on retrain for pinned files**: pinned position is computed client-side from the projection payload + `α/β`, not persisted into `files.x/y`. The legacy fallback path (server `(x, y)` from `/api/map/all`) therefore shows the natural position for pinned files until the renderer applies the offset.

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
- **Color:** assigned by `color_index % palette.length`.
- **User labels:** users can name a constellation ("research", "tax docs"). Label persists across re-layouts and recomputes — bound to `cluster_id`, not to position.

Isolated stars (no edge above similarity threshold 0.3) have `cluster_id = NULL`, dim grey color, no glow.

### F7 — Hierarchical k-means / LOD tree

The flat cluster set (a few dozen disks) is insufficient at 18,800+ files. Hierarchical clustering gives a tree (root: 4–8 mega-clusters; each splits into child clusters; leaves are individual files).

- **Algorithm:** recursive bisection on embeddings using k-means with k=2 (or k=4 for shallower tree). Stop when subtree size < `LEAF_THRESHOLD` (default 30). Tree depth typically 6–10 for 18,800 files.
- **Render LOD:** world-space radius of a cluster scales with `sqrt(memberCount)`. At a given camera zoom a cluster is *expanded* if its on-screen radius exceeds `EXPANSION_PX` (default 80 px); otherwise it renders as a single blob with member count. Zoom in → top-level mega-clusters expand into children → grandchildren → individual stars.
- **Renderer:** `StarMap.tsx` traverses tree top-down each frame. Drawing budget ≤ 200 visible blobs/clusters at any time (cull rest). Smooth interp animation when blobs expand/collapse on zoom.
- **Migration:** one-shot `relayouter.trainHierarchy()` after deployment. Runs k-means recursively; ~30s for 18,800 × 768 embeddings. Old `clusters` table preserved; renderer toggles flat-vs-tree via `?clusters=tree` until tree is the default.
- **Cross-PC-pair consistency:** tree is computed in embedding space, so it's automatically PC-pair-invariant; visual layout of nodes depends on the active PC pair via centroid projection.

---

## Virtual collections (F5)

User says "everything about magnets" or "all my pitch decks". Result is a named, persistent group of files visible in the sky as its own constellation, listed in a sidebar, and searchable by name.

### Two flavors (both supported)

1. **Static collection** — explicit list of file IDs. Add/remove members manually or "save current search results as collection".
2. **Dynamic collection** — saved query string + optional similarity floor. Membership re-evaluated on demand (button) and cached. UI shows a "stale (last evaluated 3h ago)" badge if embeddings have changed since.

### Behavior

- Search bar gains a "Save as collection" button on results screen.
- New "Collections" sidebar (toggle via `c` / leader-c if F6 lands; otherwise a small button bottom-left). Lists collections with member count and color chip. Click → highlights members in the canvas (treat like search results: dim non-members, bright members, gold ring per F1).
- Right-click member → "Remove from collection".
- Dynamic collections show "Refresh" button → re-runs the query, diffs against current members (additions in green, removals in red for 5s, then settled).

### Hull rendering

- Each collection gets a constellation-style outline (convex hull of member positions) drawn in its `color_index`-derived hue, name centered.
- Static and dynamic visually identical; dynamic gets a tiny "↻" glyph next to the name.

### Search integration

- Free-text search box already returns nearest neighbors. Add a second axis: typing `c:foo` (or `#foo`) filters to members of collection `foo` *first*, then ranks by embedding similarity.
- Renderer treats collection-active state the same way as search-active for the F1 dim/scale logic.

### Edge cases

- Dynamic refresh while query embedding API down: return 503; UI shows "refresh failed".
- Renaming: `UNIQUE(name)`; reject conflicts with 409.
- Collection of size 1 or 0: hull renders as a circle around the single point or a label-only marker.
- Delete collection — files unaffected (only membership rows go).

---

## Schema

### `files` columns

| Column | Type | Purpose |
|---|---|---|
| `embedding` | `BLOB` | Float32Array of dim 768. |
| `x` | `REAL` | Persistent 2D x coordinate (displayed = natural + pin offset). |
| `y` | `REAL` | Persistent 2D y coordinate (displayed = natural + pin offset). |
| `cluster_id` | `INTEGER` | FK to `clusters.id`. NULL for isolated. |
| `layout_version` | `INTEGER` | Increments on each global re-layout. |
| `first_seen` | `INTEGER` | Unix ms. Used for "new since" visual marker. |
| `view_count` | `INTEGER` | Anchor-mass input for re-layouts. |
| `is_pinned` | `INTEGER` | 1 = user-locked position; immune to re-layout repositioning. |
| `pin_alpha` | `REAL` | F4: offset coefficient on `pin_axis_a`. |
| `pin_beta` | `REAL` | F4: offset coefficient on `pin_axis_b`. |
| `pin_axis_a` | `INTEGER` | F4: PC index 0..7 active at pin time. |
| `pin_axis_b` | `INTEGER` | F4: PC index 0..7 active at pin time. |
| `pinned_at` | `INTEGER` | F4: unix ms; null = not pinned. |
| `tree_node_id` | `INTEGER` | F7: leaf reference into `cluster_tree(id)`. |
| `galaxy_id` | `INTEGER` | F9: parent galaxy. NULL only on legacy rows pre-migration; backfilled to the `default` galaxy on startup. |
| `os_use_count` | `INTEGER` | F10: Spotlight `kMDItemUseCount` on macOS; NULL on platforms without a count signal. Re-read on every walker pass. |
| `os_last_used` | `INTEGER` | F10: unix ms. Spotlight `kMDItemUseDate` on macOS, `stat().atimeMs` elsewhere. |
| `importance_score` | `REAL` | F10: denormalised composite of `view_count`, `os_use_count`, recency. Recomputed at index time. NULL means "compute on next walk". |

`pos`-related columns may be NULL for files in cold-start phase. Renderer skips NULL-position files.

### `layout_meta`

```
layout_meta (
  version          INTEGER PRIMARY KEY,
  algorithm        TEXT,      -- 'cose' | 'pca' | 'umap'
  projection_model BLOB,      -- serialised parametric model; F3 grows components: number[][] (8 × 768) + mean: number[] (768)
  computed_at      INTEGER,
  node_count       INTEGER,
  drift_score      REAL       -- last-measured correlation
)
```

F3 bumps `LAYOUT_VERSION` constant; `componentCount` field added to JSON.

### Collections (F5)

```sql
CREATE TABLE collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('static','dynamic')),
  query       TEXT,            -- non-null for dynamic
  similarity_floor REAL,       -- non-null for dynamic; default 0.6
  color_index INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  evaluated_at INTEGER         -- last time membership was computed (dynamic)
);

CREATE TABLE collection_members (
  collection_id INTEGER NOT NULL,
  file_id       TEXT NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, file_id)
);
CREATE INDEX idx_cm_file ON collection_members(file_id);
```

### Cluster tree (F7)

```sql
CREATE TABLE cluster_tree (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id     INTEGER REFERENCES cluster_tree(id),
  depth         INTEGER NOT NULL,
  member_count  INTEGER NOT NULL,
  centroid_x    REAL,
  centroid_y    REAL,
  centroid_emb  BLOB,         -- 768-float32, for label-on-demand search
  color_index   INTEGER NOT NULL,
  label         TEXT          -- LLM-generated or null
);
```

Flat `clusters` table preserved for compatibility; `tree_node_id` is the leaf assignment. Top-level mega-clusters reconstructed by walking up.

---

## Daemon API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness. |
| `/api/map/viewport` | GET | Query: `?x1=&y1=&x2=&y2=&zoom=`. Returns stars within bounds, decimated by zoom level. Optionally edges among them. |
| `/api/map/all` | GET | Bulk fetch (used for client-side reprojection on F3 dial change). Includes 8-PC projection matrix or use `/api/map/projection`. |
| `/api/map/projection` | GET | F3: returns `{ components: number[][], mean: number[], componentCount }`. Renderer caches. |
| `/api/map/stats` | GET | Total stars, clusters, layout version, drift score, last re-fit timestamp. |
| `/api/search` | POST | Body: `{ query: string, limit?: number }`. Returns matching star IDs + coordinates + scores. |
| `/api/file/:id` | GET | Full metadata for one file. |
| `/api/file/:id/neighborhood` | GET | Top-K edges + neighbor metadata. |
| `/api/file/:id/pin` | POST | F4: body `{ x, y, axisA, axisB }`. Returns `{ ok: true, alpha, beta }`. |
| `/api/file/:id/unpin` | POST | F4: clears pin columns. |
| `/api/cluster/:id` | GET | Cluster metadata, member IDs, centroid. |
| `/api/cluster/:id/label` | POST | Body: `{ label: string }`. Set/update user label. |
| `/api/collections` | GET | F5: list all. |
| `/api/collections` | POST | F5: body `{ name, kind, query?, similarityFloor?, fileIds?, colorIndex? }`. |
| `/api/collections/:id` | GET | F5: detail with member ids. |
| `/api/collections/:id/members` | POST | F5: body `{ fileIds: string[] }` (static add). |
| `/api/collections/:id/members/:fileId` | DELETE | F5: remove member. |
| `/api/collections/:id/refresh` | POST | F5: dynamic; re-runs query, replaces members. Returns `{ added: string[], removed: string[] }`. |
| `/api/collections/:id` | DELETE | F5: drop collection (members rows go; files unaffected). |
| `/api/tree` | GET | F7: full tree (~few thousand nodes). Renderer caches. |
| `/api/tree/:nodeId/members` | GET | F7: paginated. |
| `/api/tree/relabel` | POST | F7: kick off LLM label generation (out of v1 scope). |
| `/api/relayout` | POST | Admin: force a re-fit. |
| `/api/galaxies` | GET | F9: list galaxies with member counts. |
| `/api/index` | POST | Body `{ path, galaxyName? }` — F9 extends this; returns walk stats + assigned `galaxyId`/`galaxyName`. |

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
  - With F7 tree active: replace flat decimation with tree traversal — expand a node only if its on-screen radius > `EXPANSION_PX` (default 80 px).
- **Edges:** rendered only on hover, on search, or on click. Never as a default background.
- **Constellations:** rendered as faint filled convex hulls (or alpha-shape) in the constellation color, opacity ~0.15. Always visible.
- **Constellation labels:** drawn at centroid in the constellation color, font size scaled by member count. Visible at all zoom levels above 0.5.

### Visual encoding

- Star size: mapped from `log(view_count + 1)` on a `[12, 36]` px range.
- Star color: constellation color (or auto-type override per F2; or pin/type override per file).
- Star glow: `0 0 8px <color>` default; `0 0 14px <color>` for highlighted/origin.
- Search highlight: matching stars get a yellow `#ffe066` ring (2px, glowing). Non-matching stars dim per F1a (≤ 0.08 alpha).
- "New since last session" marker: subtle pulsing ring for files where `first_seen > last_session_open`. Clears after one full session view.
- Pinned marker: small lock icon in HoverCard; subtle ring at high zoom.

### F1 — Search pop + extended zoom + zoom-exposure (DONE)

Three trivial renderer-only changes; bundle in one branch. Constants live at the top of `StarMap.tsx` for tuning.

#### F1a — Search pop

- Non-matches dim to ≤ 0.08 alpha (was 0.25).
- Matches scale to 1.5–1.8× their default sprite size with a brief eased pulse (200 ms ease-out) on result arrival.
- Pulse triggers once per new search; static state thereafter. Track `searchAnimationStart` ref; reset on each new highlight set.
- Existing gold ring (`HIGHLIGHT_COLOR = '#ffe066'`) stays.
- Edge cases: no-results search behaves as no-search (no dim). Selected star that is also a match: scale only once (don't compound with hover scale).

#### F1b — Extended zoom range

- Wheel-zoom max raised to **100** (was 10) in `handleWheel`. Min stays 0.05.
- Sprite quality at high zoom: append `22` to `SIZE_RADII` and bump `SIZE_BUCKET_COUNT`. Optional `cam.zoom > 4` branch picks a larger size bucket.
- Backdrop (`background.ts`) renders at 1× viewport size and doesn't pan with the camera, so it stays correct at any zoom.
- Pin (F4) drag-to-reposition uses world coords; high zoom makes pins more accurate.

#### F1c — Zoom-aware exposure

The main star pass uses `globalCompositeOperation = 'lighter'` (additive). When zoomed out, hundreds of stars project onto each pixel and sum to white; when zoomed in, the same stars are spread across many pixels and look dim. Real telescopes do the opposite. Apply a single global exposure scalar driven by camera zoom.

```ts
const ZOOM_REF = 1.0           // exposure = 1.0 at this zoom
const EXP_MIN = 0.3
const EXP_MAX = 1.6
const exposure = clamp(
  Math.pow(cam.zoom / ZOOM_REF, 0.55),
  EXP_MIN,
  EXP_MAX
)
```

`pow(x, 0.55)` ≈ `sqrt(x)`, perceptually even ramp: zoom 0.1 → 0.30 (clamped); zoom 1 → 1.0; zoom 10 → 1.6 (clamped); zoom 100 → 1.6.

- Multiplied into `ctx.globalAlpha` for: main star pass, animation overlay (pulsar/quasar), nebula pass, edges pass.
- Backdrop image (pre-baked) skipped, with constants reserved for an optional fade-out at extreme zoom-out.
- Composes naturally with search dim: `alpha = matchAlpha * exposure`. Selected white-core overlay also multiplied. F4 drag preview uses the same value.

Out of scope: HDR / tone-mapping (Reinhard / ACES); per-cluster exposure; user-facing exposure slider.

### F2 — Auto-schema (extension → star type)

Without manual tagging, certain file types should still look distinct. Powerpoints feel like pulsars; CSVs feel like white dwarfs.

- Default star type computed from `mimeType` + filename extension at render time (no DB write). Manual `star_type` (set via DetailPanel / daemon endpoint) overrides.

| Match | Default type |
|---|---|
| `.pptx` `.ppt` `.key` | `pulsar` |
| `.pdf` (mimeType startsWith `application/pdf`) | `quasar` |
| `.csv` `.tsv` | `white-dwarf` |
| `.json` `.yaml` `.yml` | `neutron-star` |
| `.zip` `.tar` `.gz` | `black-hole` |
| Image media (`mimeType` startsWith `image/`) | `nebula` |
| `.md` `.markdown` | (none — uses cluster hue) |
| code (`category === 'code'`) | (none — cluster hue) |
| else | (none) |

- New helper: `src/renderer/src/components/StarMap/autoStarType.ts` exporting `defaultStarType(name, mimeType, category): StarType | null`.
- StarMap main pass: `const effective = star.starType ?? defaultStarType(...)`.
- DetailPanel star-type chip should label "Default → Pulsar (from .pptx)" so the user understands what they'd be overriding.
- Acceptance: open a PowerPoint → pulsar visuals without tagging. Override to `red-giant` → visuals change, persists. Clear override → reverts to pulsar (the auto-default), not plain cluster hue.
- Out of scope: DB backfill / `star_type` column writes; user-editable rules.
- **F2 + F10 interaction:** F2's extension-derived defaults are the entire payload of "type mode" in the F10 toggle. When the toggle flips to "usage mode" the F2 mapping is bypassed; manual `star_type` overrides still win in either mode.

### F10 — Usage-driven star classification (mode toggle)

PM framing: "the user could select either the type-based classification of stars, or usage based." White dwarfs are babies (small, untouched); red giants and blue supergiants are the files the user keeps coming back to.

**Locked decisions (from PM + user):**
- Two classification modes, user-selectable, persisted in `localStorage`. **Type** = current F2 extension-driven path. **Usage** = new percentile-driven lifecycle on the indexed corpus.
- Lifecycle chain (most-to-least common): `white-dwarf` → `main-sequence` → `red-giant` → `blue-supergiant`.
- New `STAR_TYPES` member: `'main-sequence'`. Requires a new sprite drawer.
- OS metadata source: macOS Spotlight (`mdls -name kMDItemUseCount -name kMDItemUseDate`) primary; `stat().atimeMs` fallback elsewhere.

#### Importance score

Denormalised composite, computed once at index/re-index time and stored in `files.importance_score`:

```
importance_score = view_count
                 + log2(os_use_count + 1) * 4
                 + recency_boost
recency_boost    = clamp(1 - (now - os_last_used) / SEVEN_DAYS_MS, 0, 1) * 5
```

Tunable. Recomputed on every walker pass since usage decays/grows continuously. Cheap (no embed call). Daemon never reads `importance_score` for layout — it only feeds the renderer's classifier.

#### Usage classifier (renderer-only)

When the toggle is "usage", the renderer computes corpus-wide percentiles of `importance_score` once per data load (or on score change) and assigns:

| Percentile | Type |
|---|---|
| Bottom 50% | `white-dwarf` |
| Next 30% (50–80%) | `main-sequence` |
| Next 15% (80–95%) | `red-giant` |
| Top 5% | `blue-supergiant` |

Ties broken by file id hash to prevent visual flicker on edge cases. Star size in usage mode also scales with `importance_score` (replaces the existing `view_count`-only sizing in this mode).

#### Mode toggle UI

- New `useClassificationMode()` hook in `src/renderer/src/hooks/`: returns `mode: 'type' | 'usage'`, `setMode()`. Persists to `localStorage` key `starpalace.classMode.v1`. Default: `'type'`.
- Toggle UI: small segmented control top-right of the canvas, near the PC dial. Two pills: "Type" / "Usage". One-click flip; whole sky re-renders.
- New helper `effectiveStarType(star, mode, percentileBuckets): StarType | null`:
  1. If `star.starType` (manual override): return it.
  2. Else if `mode === 'type'`: `defaultStarType(name, mimeType, category)` (existing F2 helper).
  3. Else if `mode === 'usage'`: bucket via percentile.
  4. Else null (cluster hue fallback).

#### OS metadata ingestion

In the walker (`src/daemon/index/walker.ts`):

- macOS path: `execFile('mdls', ['-raw', '-name', 'kMDItemUseCount', '-name', 'kMDItemUseDate', path])`. Parse output (Spotlight returns `(null)` for never-opened files — treat as 0 / NULL). Per-file fork ~1ms; acceptable on local FS scale.
- Other OS: `fs.stat(path)` and use `atimeMs` as `os_last_used`; leave `os_use_count = NULL`. Importance score weights `os_last_used` more heavily when count is missing.
- Spotlight unreachable on macOS (rare): same fallback path; log once per session.
- Cloud platforms (Google Drive etc.): no Spotlight, no atime. Both columns NULL; importance score reduces to `view_count` alone. Acceptable.

#### Schema migration

```sql
ALTER TABLE files ADD COLUMN os_use_count INTEGER;     -- NULL ok
ALTER TABLE files ADD COLUMN os_last_used INTEGER;     -- NULL ok
ALTER TABLE files ADD COLUMN importance_score REAL;    -- NULL ok
```

All NULL on existing rows; first walker pass after upgrade backfills.

`STAR_TYPES` array gains `'main-sequence'`. No DB enum to migrate (column is `TEXT`).

#### Sprite work

- New `drawMainSequence(ctx, cx, cy, r)` in `sprites.ts`. Visual target: warm yellow Sun-like core, modest halo, no spikes baked. Sits between `white-dwarf` (small/cool/white) and `red-giant` (large/warm/orange) on the lifecycle scale.
- F8a procedural variation features for `main-sequence` deferred to F8a rollout; F10 MVP renders deterministically.
- `TYPED_SCALE` map in `sprites.ts` gains a `'main-sequence': 1.0` entry.

#### Edge cases

- New file with `importance_score = 0` or NULL → bottom percentile → `white-dwarf` in usage mode. Matches "baby" intuition.
- Single-file corpus: every file lands in the bottom percentile → all `white-dwarf`. Acceptable; degenerate.
- Toggle while a star has manual override: override stays; mode is irrelevant for that star.
- Galaxies (F9) interaction: percentile computed across the **entire corpus**, not per-galaxy, for v1. Means a galaxy of frequently-used files could read mostly red giants while a galaxy of unread files reads mostly white dwarfs. Revisit if this looks washed-out per galaxy.
- Pinned star (F4): pin only affects position, not type. Mode toggle and pin are orthogonal.

#### Out of scope (v1 of F10)

- User-tunable percentile thresholds.
- More than 4 buckets in usage mode.
- Per-galaxy percentile windowing.
- Background re-walk to refresh `os_use_count` without re-indexing.
- Decay / time-weighted model on `importance_score` beyond the 7-day recency boost.
- Server-side classifier (stays renderer-only for symmetry with F2).
- Linux `stat -c %X` per-platform branching beyond what `fs.stat` already exposes.

#### Acceptance

1. Index a folder containing one frequently-opened `.pdf` and many never-opened `.pdfs`.
2. Toggle "Color by" → "Usage". Frequently-opened `.pdf` becomes `red-giant` or `blue-supergiant`; others become `white-dwarf`.
3. Toggle back → "Type". All `.pdfs` become `quasar` (existing F2 behaviour).
4. Manually set one `.pdf` to `nebula`. Both modes show `nebula` for that file.

#### Shipped (F10 v1)

- Schema: `os_use_count`, `os_last_used`, `importance_score` columns added via additive `hasColumn` ALTER pattern; `IndexedFile` and `Star` extended with `osUseCount`, `osLastUsed`, `importanceScore`.
- Walker: `mdls -raw -name kMDItemUseCount -name kMDItemUseDate` per-file on macOS; `fs.stat().atimeMs` fallback elsewhere. Per-file fork ~1ms (acceptable on local FS scale per spec). Spotlight unreachable → atime fallback, logs once per session.
- Score: `computeImportanceScore({ viewCount, osUseCount, osLastUsed, now })` in `src/daemon/pipeline/importanceScore.ts`. Recomputed at every walker pass.
- New `STAR_TYPE` member `'main-sequence'` with warm yellow Sun-like sprite (jwst) + posterized hyper-yellow disc (vapor). `TYPED_SCALE['main-sequence'] = 1.0`.
- Renderer: `useClassificationMode` hook (localStorage key `starpalace.classMode.v1`, default `'type'`); `usageStarType` + `computePercentileBuckets` helper in `src/renderer/src/components/StarMap/usageStarType.ts`; segmented "Color by: [Type] [Usage]" toggle in StatsBar; mode-aware `effectiveStarType` resolves manual override → type-mode (F2) → usage-mode (percentile). Usage mode also drives star size from `importance_score`.

#### Known limitations / follow-up

- F8a per-id procedural variation for `main-sequence` is deferred — the new drawer renders deterministically. Other types still get the F8a per-star variation pulled in via F11.
- Percentile classifier runs across the entire corpus, not per-galaxy. A galaxy of frequently-touched files reads mostly red-giant; a galaxy of unread files reads mostly white-dwarf. Out of scope for v1; revisit if it looks washed-out per galaxy.
- No background re-walk: `os_use_count` only refreshes when the user re-indexes. Spec out-of-scope.
- `effectiveStarType` test coverage stays at the helper level (`usageStarType.test.ts`); the StarMap draw loop is exercised manually by the user (no canvas/jsdom in test env).

### F11 — Theme selector

Same sky, totally different look. The user picks a visual theme; every typed-star sprite, the canvas backdrop, and the UI accent shift in one swap. Two initial themes ship; more can land later as drop-in modules.

#### Two themes at launch

Both prototyped end-to-end as standalone HTML decks (see worktree references in the F11 row):

- **`jwst`** (default) — deep-space realism. Dark slate `#0a0d1a` backdrop. Multi-stop radial gradients, `screen` / `lighter` additive blends, soft alpha falloff. Naturalistic palette per type (red giant orange, blue supergiant cyan, etc.). Gold accent `#ffe066` on UI. Matches existing production aesthetic + the F8a v2 deck (`worktree-agent-af8ce890cf5c7d92b`).
- **`vapor`** (alternate) — synthwave / chromatic-aberration. Sunset gradient backdrop (purple → magenta → orange) with Tron-grid overlay + CRT scanlines. Hot magenta `#ff2afc`, electric cyan `#00f5ff`, lime `#39ff14`, hyper-yellow `#fff200`. Posterized glow (3-4 sharp colour bands instead of smooth gradients). Hot pink accent `#ff007a` on UI. Uppercase letter-spaced titles. Glitch-slice displacement on ~10% of sprites. Matches the F8a vapor deck (`worktree-agent-acb91a52b583dc370`).

Both themes implement the same set of typed drawers + cross-cutting circular fade mask + F8a procedural variation features (per-instance hash-driven asymmetry).

#### Theme registry

```ts
interface Theme {
  id: string                                  // 'jwst' | 'vapor' | ...
  name: string                                // human label for the picker
  description: string
  drawers: Record<StarType, ThemedDrawer>     // 9 typed drawers + main-sequence (F10)
  defaultDrawer: ThemedDrawer                 // for cluster-hue / no-type stars
  background: {
    canvasFill: string | CanvasGradient
    overlay?: (ctx, w, h) => void             // grid lines, scanlines, etc.
  }
  ui: {
    accentColor: string                       // gold, hot-pink, etc.
    fontStack: string                         // chrome font
    titleTransform?: 'uppercase' | 'none'
    titleLetterSpacing?: string
  }
}

type ThemedDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  rng: () => number,                          // F8a seeded PRNG
) => void
```

Themes live as ES modules in `src/renderer/src/themes/`:
- `src/renderer/src/themes/jwst/index.ts` (drawers + background + ui)
- `src/renderer/src/themes/vapor/index.ts`
- `src/renderer/src/themes/registry.ts` exports a `Map<ThemeId, Theme>` and a `defaultThemeId`.

Adding a new theme = add a new directory + register it. No daemon changes, no schema migration.

#### Picker UI

- New `useTheme()` hook in `src/renderer/src/hooks/`: returns `{ theme: Theme, setTheme(id): void, available: ThemeSummary[] }`. Persists to `localStorage` key `starpalace.theme.v1`. Default `'jwst'`.
- Theme picker UI: dropdown in the StatsBar (bottom-left) labelled "Theme: [JWST ▾]". Dropdown lists all registered themes by name + 1-line description.
- Switching themes: instant (no transition animation in v1). Sprite cache is keyed per-theme so the swap is `O(visible-stars)` re-renders.

#### Sprite cache key

LRU cache key from F8a (`type:T|s:S|h:HASH12`) gains a theme prefix:

```
themeId:T_id|type:T|s:S|h:HASH12
```

Means switching themes does NOT evict the previous theme's sprites — they stay in LRU until aged out by churn. User flipping back and forth pays only the first switch's render cost.

#### Background + UI chrome

- `themedBackground` component reads `theme.background.canvasFill` and applies it to the StarMap canvas's clear-pass + any `overlay` callback (grid, scanlines).
- `themedAccent` exposed via CSS variable `--starpalace-accent: <color>`. UI components that currently hard-code gold (HoverCard ring, search highlight, pinned lock badge) read the variable.
- Title font + letter-spacing applied to slide / panel titles via the same CSS-variable approach.

#### Edge cases

- Theme registered with a missing drawer for some `StarType` → fall back to that theme's `defaultDrawer`. Log once.
- `localStorage` set to an unknown theme id → fall back to `defaultThemeId`, clear the bad value.
- F8a procedural infrastructure (`seedFromId`, `LRUSpriteCache`) is shared across themes — only the drawers differ.
- Galaxies (F9): theme is global, not per-galaxy. Same sky, one aesthetic.
- Usage classification (F10): theme is orthogonal. Mode toggle stays in the corner; theme picker is its own control. Both persist independently.

#### Out of scope (v1 of F11)

- Per-galaxy or per-cluster theme override.
- User-authored custom themes (drop-in JSON config).
- Theme transition animations on switch.
- Server-side theme rendering (themes stay client-only).
- More than 2 themes shipped at v1 (extensibility is structural; new themes are follow-up work).

#### Acceptance

1. Open the app on `jwst` (default). Sky reads as deep-space realism.
2. Open the StatsBar theme dropdown → pick `vapor`. Canvas backdrop, every sprite, accent colors flip in one swap.
3. Refresh browser → theme persists.
4. Switch back to `jwst` → instant; sprites previously rendered are still cached.
5. Manual `star_type` overrides (F2/F4) and pin overlays (F4) render correctly under both themes.

### F12 — Selection animation (pulse / breathe)

When a star is selected, animate its scale or alpha so the selection state reads as alive, not static. Inspired by the existing per-frame pulsar beam rotation that the user explicitly likes.

**Implementation shipped:**
- Both scale and boost-alpha pulse on a shared 1.5s sine wave so the selected sprite breathes with synchronised size + brightness.
- Constants in `StarMap.tsx`: `SELECTION_PULSE_PERIOD_MS = 1500`, `SELECTION_PULSE_AMPL = 0.06` (±6% scale), `SELECTION_BOOST_ALPHA_BASE = 0.45`, `SELECTION_BOOST_ALPHA_AMPL = 0.15` (boost-alpha sweeps 0.30 .. 0.60).
- Helpers `selectionPulse(tNowMs)` and `selectionBoostAlpha(tNowMs)` are called inline in the main star pass and the decoration pass; the pin-drag preview keeps the static `SPRITE_SELECTED_SCALE` (a brief preview shouldn't pulse).
- The static `SPRITE_SELECTED_BOOST_ALPHA` constant was removed in favour of the time-varying helper.
- Cheap; runs in the existing per-frame draw loop; no caching invalidation.

**Files**:
- `src/renderer/src/components/StarMap/StarMap.tsx` — selection scale + boost-alpha apply sites.

**Out of scope**:
- Multi-state animation (e.g. different pulse for hover vs select).
- Per-type animation profiles.

### F13 — Search-match explainability (literal hits + AI insight)

When a search ranks a file, the user often wants to know *why*. Two surfaces in DetailPanel, complementary and independently useful.

#### (a) Literal-string highlight

Renderer-only. When the active search query is non-empty and the user opens DetailPanel for a result, highlight every literal occurrence of the query inside the content viewer.

- Case-insensitive substring match.
- Wrap each hit in `<mark>` (or a styled span) so CSS controls the highlight colour. Use `var(--starpalace-accent)` so it inherits the active theme.
- Auto-scroll the viewer to the first hit on open. "Next/prev hit" buttons + counter ("3 / 47") in the panel header.
- Multi-word queries: highlight each word separately. Quoted substrings ("foo bar") highlight as one literal.
- Skip when content is binary/media (no text payload).
- Cost: O(content length × query terms). Cap at the first ~5000 hits to avoid pathological pages.

**Files (renderer)**:
- `src/renderer/src/components/DetailPanel/DetailPanel.tsx` — render `<mark>` spans, hit counter, next/prev nav.
- `src/renderer/src/components/DetailPanel/highlightLiteral.ts` (NEW) — pure helper: `highlightLiteral(text, terms): Array<{text: string, hit: boolean}>`. Unit-test in `tests/renderer/highlightLiteral.test.ts`.
- `src/renderer/src/styles/global.css` — `.detail-content mark { background: var(--starpalace-accent); color: #000; }`.

#### (b) AI insight

Daemon endpoint calls an LLM with the query + file's embedded text + top-K neighbor snippets → returns a short explanation of why the file matched.

- New endpoint `POST /api/file/:id/search-insight` body `{ query: string }` → response `{ insight: string, model: string, tookMs: number }`.
- Daemon assembles a prompt: query + first ~2000 chars of file content + first 3 neighbors' filename + first 200 chars each.
- LLM provider config in daemon: `STARPALACE_INSIGHT_MODEL` env (default `null` → endpoint returns 503 "insight not configured"). Optional later: pluggable Ollama / OpenAI / Anthropic backends.
- DetailPanel renders an "✨ Why this file?" button (visible when active search query exists). Click → POST endpoint → display response below. Loading spinner. 503 → polite "AI insight requires INSIGHT_MODEL configured".
- Cache: in-memory LRU keyed on `(fileId, query)`, cap 64 entries. Short TTL (10 min).
- Cost: one LLM call per click. User-initiated, not automatic.

**Files (daemon)**:
- `src/daemon/index.ts` — new POST endpoint.
- `src/daemon/insight/generate.ts` (NEW) — prompt assembly + LLM call. Pluggable `InsightProvider` interface; first impl wraps Ollama (which is already in the stack for embeddings).
- `src/daemon/insight/cache.ts` (NEW) — LRU 64.

**Files (renderer)**:
- `src/renderer/src/components/DetailPanel/DetailPanel.tsx` — button + response card.
- `src/renderer/src/api.ts` — `requestSearchInsight(id, query)` helper.

#### Edge cases

- Empty / no-query DetailPanel open: hide both surfaces.
- Non-text file (media): hide (a); for (b), still allow but the LLM gets only filename + neighbors.
- LLM provider unreachable: 503 → polite message, retry button.
- Query changes after insight cached for that (file, query): show stale insight as-is; user can click again to regenerate.
- Multi-galaxy: insight is per-file, galaxy-agnostic.

#### Out of scope (v1 of F13)

- Server-side highlight rendering (renderer does the literal pass).
- Streaming LLM responses (await the full response).
- Per-paragraph attribution (which sentence contains the match) — keep it short and overall.
- Insights for files with no search context (no global "summarise this file" path).
- Insight history persistence across sessions.

### F15 — Reduce glow / expose procedural detail

After F11 procedural sprites + F8a per-id variation shipped, the bright additive glow halos drown the per-instance artwork (red giant convection mottling, nebula FBM color washes, neutron-star nucleus dots, black-hole accretion ring asymmetry). Lower the global exposure / halo alpha so the procedural detail reads.

**Knobs to tune (StarMap.tsx):**
- `EXPOSURE_MIN` / `EXPOSURE_MAX` / `EXPOSURE_GAMMA` — global multiplier on additive star pass.
- `SPRITE_HOVER_SCALE` / `SPRITE_HIGHLIGHT_SCALE` / boost-alpha — selection brightness pop.
- Per-drawer `halo` gradient max alpha in `themes/jwst/drawers.ts` and `themes/vapor/drawers.ts`.

**Approach:**
- Drop `EXPOSURE_MAX` from 1.6 → 1.1 (less zoom-driven brightening).
- Drop default halo alpha by 25-35% across drawers (multiply each `rgba(...,a)` first stop by 0.7).
- Keep core brightness — just dim the outer halos so the disc/structure shows through.
- Iterate live with reload until detail reads.

**Acceptance:**
- At default zoom, the inside of a red giant or nebula is clearly distinguishable from a generic glowing disc.
- Selected stars still pop (selection ring + pulse intact); just less halo bloom.

**Files:**
- `src/renderer/src/components/StarMap/StarMap.tsx` — exposure constants.
- `src/renderer/src/themes/jwst/drawers.ts` and `src/renderer/src/themes/vapor/drawers.ts` — halo alpha multipliers.

**Out of scope:**
- Per-type independent exposure profiles.
- User-facing exposure slider (F1c notes a slider as a future option).

### F16 — Galaxy visibility toggle (hide / show)

User has 3 indexed galaxies (e.g. `~/code`, `~/Documents`, `~/scratch`). Sometimes wants to focus on just one or two without re-indexing or losing data. Add per-galaxy show/hide that's purely a renderer filter.

**Behaviour:**
- GalaxyPanel adds a checkbox / eye-icon per galaxy row. Toggle switches the galaxy's visibility.
- Hidden galaxies:
  - Their stars are excluded from `projectedStars` in App.tsx.
  - Excluded from search highlight resolution (search results pointing at hidden-galaxy files are dropped).
  - Excluded from F2/F10 percentile bucketing (don't influence others' classification).
  - Their galaxy origin marker (if any HUD shows them) hides too.
  - StatsBar count "N stars" reflects visible only; show a smaller "(M hidden)" suffix when any hidden.
- Visibility persisted in `localStorage` under `starpalace.galaxyVisibility.v1` as `Record<galaxyId, boolean>`. Default: all visible.
- DB schema unchanged. Daemon endpoints unchanged. Hidden galaxies stay indexed and re-indexable.

**Files:**
- `src/renderer/src/hooks/useGalaxyVisibility.ts` (NEW) — `{ visibleSet: Set<number>, isVisible(id), toggle(id), setVisible(id, v) }`. Persists.
- `src/renderer/src/components/GalaxyPanel/GalaxyPanel.tsx` — add eye toggle button per row.
- `src/renderer/src/App.tsx` — filter `projectedStars` and `projectedHighlights` by visibility set.
- `src/renderer/src/components/StatsBar/StatsBar.tsx` — show "(M hidden)" when applicable.

**Edge cases:**
- All galaxies hidden: show empty sky + a polite "All galaxies hidden — toggle visibility in the panel" overlay.
- Default galaxy (`__default__:default`): can be hidden too. Show with a special label "default (legacy)".
- A galaxy is removed from the indexer between sessions: drop its stale visibility entry on next read.

**Out of scope (v1):**
- Per-cluster or per-collection hide.
- "Solo" mode (hide all but one) — derived from the existing toggle in two clicks.
- Daemon-side filter (search still scans all stars; renderer drops the hidden ones from results — cheaper than rewriting `/api/search`).

### F17 — Indexing progress bar

`POST /api/index` walks a directory tree, embedding each file via Ollama (~10–100 ms per file). On a Documents folder of 1500 files this can take 1–3 minutes. Currently the renderer just hangs on the request — no visual feedback until completion. Need live progress.

**Daemon side:**
- Walker (`src/daemon/index/walker.ts` or pipeline `Insert.ts`) emits a periodic event with `{scanned, indexed, skipped, errors, currentPath, etaSec}` (~10 Hz, throttled).
- Two transport options:
  - **SSE (Server-Sent Events)** — `GET /api/index/progress?jobId=…` streams events; each `POST /api/index` returns a `jobId`. Cleaner; one connection per indexing job.
  - **Polling endpoint** — `GET /api/index/status` returns current job's stats. Renderer polls every 250 ms while indexing. Simpler; no streaming dependency.
- Recommend **SSE** for v1 — Express has built-in support, and avoids the polling overhead at high file counts.
- New helper: in-memory `Map<jobId, ProgressState>` in daemon. Job ids are unix-ms + random suffix. Cleaned up 60 s after completion.

**Renderer side:**
- `useIndexProgress(jobId)` hook subscribes to the SSE stream and exposes `{scanned, indexed, total?, percent?, errors, currentPath}`.
- `total` is unknown until the walker has discovered all files; `percent` is computed from `scanned / total` once `total > 0`. Before that, show indeterminate (animated stripes).
- GalaxyPanel "Index" button morphs into a progress row while `jobId` is active: thin progress fill (theme accent) + "234 / 1500 (15%) — current/path/here.md" + cancel button.
- Cancel: `DELETE /api/index/progress/:jobId` aborts the walker. Walker checks an abort flag at each step.

**Files (when implemented):**
- `src/daemon/index/walker.ts` — emit progress events.
- `src/daemon/index.ts` — extend `POST /api/index` to return jobId; add `GET /api/index/progress?jobId=` SSE endpoint; add `DELETE /api/index/progress/:jobId` cancel.
- `src/daemon/index/progressStore.ts` (NEW) — in-memory Map + emit/subscribe/cleanup.
- `src/renderer/src/hooks/useIndexProgress.ts` (NEW) — EventSource wrapper.
- `src/renderer/src/components/GalaxyPanel/GalaxyPanel.tsx` — progress row.
- `src/renderer/src/styles/global.css` — `.galaxy-panel-progress*` styles.

**Edge cases:**
- Browser disconnects mid-stream (tab close): walker continues to completion; cleanup removes the Map entry on next GC.
- Two concurrent index jobs (rare): each gets its own jobId; UI shows the most recent.
- Embedding API (Ollama) hangs on a single file: progress stalls but doesn't error — UI shows last-update timestamp + "stalled?" hint after 10 s of no movement.
- Ollama unreachable mid-walk: walker returns indexed=0 errors=N; UI shows the error count + reload hint.

**Out of scope (v1):**
- Pause/resume (cancel-then-restart is the workflow).
- Persistent job history (refresh loses the in-memory Map).
- Per-file detail breakdown (just an aggregate count + currentPath).
- Notifications when indexing completes from a backgrounded tab.

### F14 — Reveal in OS file explorer (capital O)

Lowercase `o` already opens the selected file in the OS default app (`open <path>` on macOS, etc.). Capital `O` should instead open the containing folder in the OS file explorer with the file highlighted.

**Bindings:**
- Vim `O` (capital, normal mode) — only when a star is selected. Calls daemon endpoint.
- Lowercase `o` unchanged.
- DetailPanel adds a small "Reveal in Finder" button (label adapts per platform: "Reveal in Finder" / "Show in Explorer" / "Open folder").

**Daemon endpoint:**
- `POST /api/file/:id/reveal` → spawns the OS reveal command, returns `{ ok: true }`.
- macOS: `execFile('open', ['-R', path])` — reveals file in Finder, highlights it.
- Windows: `spawn('explorer', ['/select,', path], { windowsVerbatimArguments: true })` — same RCE-safe pattern as `openInDefaultApp`.
- Linux: `execFile('xdg-open', [dirname(path)])` — opens the folder; xdg-open has no native "select file" flag.

**Files:**
- `src/daemon/index.ts` — new endpoint.
- `src/daemon/util/openInDefaultApp.ts` — extend with `revealInFileExplorer(path)` sibling function (mirrors the cross-platform shape).
- `src/renderer/src/hooks/useVimMode.ts` — add `case 'O'` mirroring the existing `case 'o'`.
- `src/renderer/src/components/DetailPanel/DetailPanel.tsx` — Reveal button beside the existing Open button.
- `src/renderer/src/api.ts` — `revealFile(id)` helper.
- Cheatsheet update.

**Edge cases:**
- File path no longer exists (deleted/moved since indexed): OS command fails silently or shows an error; daemon returns 200 anyway (we did try). Optional: stat first → 404.
- Linux without xdg-open: 500 with a polite error.

**Out of scope (v1):**
- Per-platform "show in <named explorer>" customisation (Path Finder, Total Commander).
- Highlighting the file inside a third-party file manager.

### F8 — Procedural per-file graphics

Layer procedurally-generated detail on top of the existing visual identity (cluster hue + temperature jitter + size bucket → ~120 sprites for 18,800 files) so two files in the same cluster + same size still look different. Variation derives from a deterministic hash so the same file always looks the same.

**Decisions locked:**
- Seed source: `Star.id` via FNV-1a 32-bit hash (`hashStr` already in `sprites.ts`). Same id → same look forever; renames / content edits don't reroll.
- Cache strategy: LRU per-file sprites, cap **500 entries**. Eviction → next render rebuilds. Bucket sprites continue to handle the common case (off-screen / tiny on-screen stars).
- Scope: typed-star sprites (F8a), default cluster-hue stars (F8b), cluster nebulae (F8c), deep-zoom planet view (F8d).

**Seed plumbing** — small RNG helper, deterministic and cheap:

```ts
// src/renderer/src/components/StarMap/proc.ts
export function seedFromId(id: string): () => number {
  let s = hashStr(id) >>> 0
  return () => {                          // mulberry32
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

#### F8a — Typed-star instance variation

- Rotation: `rng() * 2π` for the dominant axis (jets, spikes, halo squish).
- Halo squish: `0.7 + rng() * 0.6` for elliptical eccentricity.
- Spike count for "spiky" types (blue supergiant, neutron star): pick from `[6, 8]` weighted by `rng()`. Pulsar's beam tilt also rng-seeded.
- Color jitter: ±8% hue shift inside the type's palette.
- Nebula type: 2–4 filament arms; lengths and hues seeded.
- Black hole: accretion ring tilt and ring-thickness seeded.
- Binary: separation distance and core size ratio seeded.
- `sprites.ts`: extend `getTypedStarSprite(type, sizeBucket)` → `getTypedStarSprite(type, sizeBucket, starId)`. Cache key adds a 12-bit hash of the id (~9 types × 7 sizes × 4096 hashes; LRU caps the working set).

#### F8b — Default cluster-hue micro-jitter

- Per-id rotation: 0–2π applied at draw time via `ctx.rotate`. No new sprite needed.
- Per-id alpha jitter: ±10% on global brightness.
- Per-id micro-spike-count: half of stars get the 6-spike variant, half a 4-spike variant (new sprite generation path). Cached on `(colorIndex, tempBucket, sizeBucket, spikeVariant)`. Bucket count 120 → 240, still small.
- The drawn sprite stays bucket-keyed; variation comes from runtime rotation + alpha multiplied per id.

#### F8c — Procedural cluster nebulae

Replace each cluster's 4-stop radial gradient with a procedural shape:
- Worley/voronoi noise for filament structure.
- 2–3 internal hot spots (smaller bright cores embedded in the blob).
- 1–3 dark dust lanes carved with negative-blend strokes.
- Color: cluster's palette hue + a complementary accent at the rim.
- Per-cluster seed = `cluster.id` (not file id); blob is fixed per cluster.
- Pre-render to an offscreen canvas keyed on `(cluster.id, nebulaResolution)`. Re-render only when memberCount changes substantially (every 20% delta). Drawn at world-space size (scales with zoom).

#### F8d — Deep-zoom planet view

When a single star occupies more than ~80 px on screen (`screenRadius = spriteCoreRadius(sb) * scale > 80`), switch from "star sprite" to "planet disc" rendering. At `cam.zoom = 100` (the F1b max) this triggers for any file.

- **Disc color palette** (3–5 colors): half the time pull from cluster's hue family; half random within "habitable" ranges (terrestrial blues/greens/browns, gas-giant bands, ice whites, lava reds).
- **Surface pattern** (one per id, seeded):
  - Terrestrial: voronoi continents over base ocean color.
  - Gas giant: horizontal banded perlin noise; Jupiter-style.
  - Ice: low-saturation marble pattern.
  - Lava: cracks via reaction-diffusion (cheap pre-baked variant).
  - Cratered moon: random circles via Poisson disc sampling.
- **Atmosphere ring**: faint glow on the limb, color-complementary to surface.
- **Optional (post-MVP):** rings (à la Saturn), small moons orbiting.
- **Render surface:** new `src/renderer/src/components/StarMap/planet.ts` with `renderPlanet(starId, radiusPx): HTMLCanvasElement`. LRU cache, cap 500. Sized by current screen radius rounded to a few steps (e.g. 64, 128, 256 px).
- **Rotation:** planet appears to spin slowly. Per-frame `ctx.rotate` at draw time; angular velocity seeded per id (some retrograde). Only animates when in planet mode (cardinality is small at deep zoom).

#### LRU cache (cross-cutting)

```ts
class LRUSpriteCache<K> {
  constructor(public cap: number) { ... }
  get(key: K): HTMLCanvasElement | null { ... }
  set(key: K, sprite: HTMLCanvasElement): void { ... }
}
```

- F8a: 500-entry cap shared across all typed-star variants.
- F8c: separate cluster-nebula cache, cap = cluster count (~40), no eviction needed.
- F8d: 500-entry cap, separate (planet sprites bigger).
- F8b: NO cache (rotation/alpha applied at draw time on existing buckets).

Total max memory: ~500 × 64 KB (typed) + ~500 × 256 KB (planets) + ~40 × 64 KB (nebulae) ≈ 160 MB. Tunable.

**Edge cases:**
- Star with no cluster (`clusterId === null`): use the random-roll path for planet palette.
- Files with no embedding (binary/media): same procedural path applies; visual still derived from `id`.
- Cache thrash on rapid zoom oscillation: LRU should absorb; if not, add a "warm zone" of sticky entries.

**Out of scope (v1 of F8):** animated cloud bands; per-cluster galactic morphology; WebGL shader path; user-customisable seed override.

### Search → camera animation

1. User types query.
2. Daemon returns ranked IDs + their `(x, y)`.
3. Renderer computes bounding box of top-N results.
4. Camera animates pan + zoom to bounding box over ~600ms with easing.
5. Highlight applied; non-matching dimmed (per F1a).
6. Pressing Escape clears highlights and returns to free browse.

---

## Galaxies (F9)

Multi-root indexing without files merging into one big sky. Each indexed
directory becomes its own **galaxy** at a deterministic origin offset on
the map; the user pans/zooms between them or uses a "Fly to" button in
the panel.

### Data model

```sql
CREATE TABLE galaxies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  root_path   TEXT NOT NULL UNIQUE,
  origin_x    REAL NOT NULL,
  origin_y    REAL NOT NULL,
  created_at  INTEGER NOT NULL
);
ALTER TABLE files ADD COLUMN galaxy_id INTEGER REFERENCES galaxies(id);
```

Migration is additive. A `default` galaxy at origin `(0, 0)` is created on
startup if it doesn't already exist; any pre-existing files (galaxy_id
NULL) are backfilled to it so the migration is safe on a populated DB.

### File ID derivation

`fileIdFromPath(path, galaxyScope?)` salts the SHA-1 input with the
galaxy ID when one is supplied. Same on-disk path under two galaxy roots
produces two distinct file IDs (and therefore two distinct stars). When
the scope is undefined the legacy path-only ID is preserved.

### Origin spiral

`galaxySpiralOffset(n)` walks a square Ulam spiral around `(0, 0)` with
leg lengths `1, 1, 2, 2, 3, 3, …` and direction order
`right → up → left → down`. Step size is `GALAXY_SPIRAL_STEP = 1000`
world units (PCA spread is ±500, so 1000 puts adjacent galaxies one
diameter apart — visibly separated and easily reachable with a single
pan or `gh`).

| n | (x_step, y_step) |
|---|---|
| 1 | (0, 0) — `default` |
| 2 | (1, 0) |
| 3 | (1, 1) |
| 4 | (0, 1) |
| 5 | (-1, 1) |
| … | … |

### Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/index` | POST | Body `{ path, galaxyName? }`. Find-or-create galaxy → assign every walked file to it. Defaults to `basename(path)`. |
| `/api/galaxies` | GET | `{ galaxies: GalaxySummary[] }` with `id, name, rootPath, originX, originY, createdAt, memberCount`. |

### Renderer

Each star's displayed position is `localPCA(x, y) + galaxy.origin`. The
offset is composed in `App.tsx`'s `projectedStars` memo, layered on top
of (and independent from) any future pin offset.

### UI

`GalaxyPanel` lives at the bottom-right (collapsible). Inputs for path
+ optional galaxy name + Index button. Below that, a list of all
galaxies with their member count and a "Fly to" button that pans the
camera to the galaxy's origin at zoom `0.3` so the whole galaxy fits.

Indexing the same path twice is idempotent: the galaxy's row is reused
(unique on `root_path`) and contents re-walked.

### Out of scope (v1 of F9)

- No deduplication when the same file appears under two galaxies.
- No galaxy-level color theming.
- No drag-to-reorder of galaxy origins on the spiral.
- No `/api/galaxies/:id/refresh` endpoint (re-index by re-POSTing `path`).
- No galaxy hulls or labels in `StarMap`.

---

## Vim mode (F6)

User wants to drive the entire app from the keyboard.

### Modes

- **Normal** (default): navigation + commands.
- **Search**: typing in the search box.
- **Visual**: rectangle selection (drag without releasing or `v` + hjkl).
- **Command**: `:` opens a command palette (rename collection, set type, etc).

### Bindings (initial)

| Key | Mode | Action |
|---|---|---|
| `h` `j` `k` `l` | normal | Pan camera (1 viewport step / multi-press for momentum) |
| `H` `J` `K` `L` | normal | Pan 4× |
| `+` `-` (or `=` `_`) | normal | Zoom in/out |
| `gg` | normal | Fit all stars |
| `gh` | normal | Fit current cluster |
| `gc` | normal | Fit current collection (if active) |
| `/` | normal → search | Focus search bar |
| `Esc` | any | Back to normal / close panel |
| `n` `N` | normal | Next / prev search result (cam pan) |
| `Enter` (on hovered star) | normal | Select (open DetailPanel) |
| `o` (on selected) | normal | Open in default app |
| `t` | normal | Open star-type dropdown for selected |
| `T` (capital) | normal | Cycle through types forward |
| `p` | normal | Pin the selected star at current screen position |
| `u` | normal | Unpin |
| `c` | normal | Toggle collections sidebar |
| `:` | normal → command | Command palette |
| `?` | normal | Show keymap cheatsheet (overlay) |

Visual mode (after F4 / F5 land):
- `v` start rect select; `hjkl` extend; `y` "yank" → save selection as collection (prompt for name); `t<type>` set star_type for all selected.

### Implementation

- `src/renderer/src/hooks/useVimMode.ts` — single keydown listener, mode state machine, dispatches to actions.
- `src/renderer/src/components/Cheatsheet/Cheatsheet.tsx` — **persistent side panel** (left or right edge), NOT a transient overlay. F6 departs from vim orthodoxy in places (`y` = save-as-collection, not yank-paths) so keep the cheatsheet visible by default. Toggle hide via `?`. Compact, mono font, two-column.
- Existing `<input>` elements (search bar) suppress global key handling via `e.target instanceof HTMLInputElement` guard.

### Acceptance

- Disable mouse, drive the entire flow: search → fit results → next/prev → open detail → set type → open file. Smooth.

### Out of scope

- Multi-keystroke recording / macros.
- Custom keybinding config.
- Modal indicator UI element (status text in `StatsBar` is enough).

---

## Indexing

- SQLite at `~/.starpalace/index.db`, WAL mode, `STARPALACE_DB` override.
- Walker ignores `node_modules`, `.git`, `.DS_Store`, `dist`, `__pycache__`, `.next`, `build`, `coverage`.
- 5 MB max file size.
- Chokidar marks files `stale=1` on change/delete.
- Daemon start does mtime diff scan.
- Stale files re-indexed lazily when they appear in queries or background work.
- On re-index, embedding recomputed only if content fingerprint changed.
- On re-index that produces a sufficiently different embedding (cosine to old < 0.95), `(x, y)` is recomputed via current `project` model and animated to the new position.
- **F10 — usage metadata read at every walker pass**. macOS: `mdls -raw -name kMDItemUseCount -name kMDItemUseDate <path>` per file (~1ms fork). Other platforms: `fs.stat().atimeMs`. Result: `os_use_count`, `os_last_used`, recomputed `importance_score`. Cheap; no embed call, no Ollama dependency.

---

## Caching

- **Query result cache:** small LRU keyed on normalised query string (repeated identical searches).
- **Platform API cache:** 10-minute TTL for cloud platform metadata.
- **Hot file cache:** removed. Edge persistence makes neighborhood queries O(K) reads.
- **Viewport cache:** renderer caches the most recent N viewport responses keyed on `(zoom-bucket, bounds-bucket)` to make panning instant.
- **Sprite caches:** per F8 (typed-star LRU 500, cluster nebulae ~40, planets LRU 500).

---

## Platforms

- **v1:** Local filesystem + Google Drive.
- **v2:** Confluence, Dropbox, OneDrive/SharePoint.

Cloud surface deferred to focus engineering on the layout/persistence pipeline. Adding a new platform is mostly an indexer — once a file enters the SQLite index with content for embedding, it joins the sky like any other.

---

## File types

Document, data, code, media. Embedding works on text content; for non-textual files:

- **Document, code, data:** embed file content (truncated to 8k tokens).
- **Media:** embed filename + path + extracted EXIF/ID3 metadata as a synthetic text representation. Acknowledged weak signal — these stars cluster by filename patterns more than content.

---

## Scale targets

- Local index: up to 100k files.
- Insert latency: < 200 ms (embedding call dominates).
- Search latency: < 100 ms.
- Map viewport fetch: < 50 ms for any viewport at any zoom.
- Background re-fit: < 30 s for 100k files on a modern laptop.
- F7 hierarchy training: < 30 s for 18,800 × 768 embeddings.
- F8 steady state: 60 fps at default zoom; renderer memory under ~200 MB.

LSH banding for MetadataEngine candidate filtering required at scale (`b=32, r=4`), stored as `minhash_bands` inverted-index table.

---

## Non-goals (v1)

- No real-time collaboration.
- No file editing or preview.
- No mobile.
- No "ego graph" / per-query subgraph layout — search returns highlights on the persistent map only.
- No manual edge editing — the user does not draw or break edges.
- No LLM-generated tree node labels (deferred from F7).
- No user-customisable F8 seed override.
- No WebGL shader path for F8 (canvas2d only).

---

## Cross-cutting concerns

### Backwards compatibility

- All schema changes additive (no drops). Daemon migration runs idempotently on startup. Existing 18,800-row DB upgrades in place.
- Renderer feature flags via query string (`?renderer=`, `?clusters=`, `?vim=`) so each feature can be enabled independently for testing.

### Tests

Each feature ships:
- Daemon-side endpoint test in `tests/api/contract.test.ts` (note: this file currently SIGSEGVs under vitest — pre-existing — so tests must run cleanly under `npm run test` despite that limitation).
- DB-side round-trip in `tests/api/FileIndex.test.ts`.
- Renderer logic tested via unit tests on extracted helpers (`autoStarType.ts`, `pinMath.ts`, `useVimMode.ts`).

### CLAUDE.md compliance

Every commit gates on `npm run typecheck && npm run lint && npm run test`. Conventional Commits (`feat`, `fix`, `refactor`, `chore`).

---

## Recommended sequencing

1. **F1 + F2** (one branch, one PR) — small, immediate user-visible gain. **DONE**
2. **F3** — unlocks F4. Self-contained. **DONE**
3. **F4** — depends on F3 for the multi-PC-aware embedding-delta math. **DONE**
4. **F5** — depends on nothing else; can also slot in parallel to F3/F4. **DONE**
5. **F6** — independent; nice once F1–F5 land so there's enough surface to bind keys to. **DONE**
6. **F9** — galaxies; multi-root indexing. Independent. **DONE**
7. **F11** — theme selector. Renderer-only; landed the F8a foundation (`proc.ts` + per-id variation) for both `jwst` and `vapor`. **DONE**
8. **F10** — usage-driven classification. Independent. Pairs naturally with F8a (procedural variation gives the new `main-sequence` sprite its visual identity). **DONE**
9. **F7** — biggest scope; benefits from the tree visualization making the rest of the UI more useful.
10. **F8** — F8a foundation + per-type variation shipped via F11 (both themes). Remaining work: F8b (default cluster-hue jitter, ½d), F8c (procedural cluster nebulae, 1d), F8d (deep-zoom planet view, 2–3d).
11. **F14** — XS reveal-in-explorer extension to F6's vim mode. Independent; landed after F6. **DONE**

Each phase = its own feature branch off `main`, merged on green CI.

---

## Adding a new platform

1. Add a new value to `Platform` in `src/shared/types.ts`.
2. Implement a walker that yields `{ node: FileNode, content: Buffer }`.
3. Call `insertOne()` per file from `indexPath()` or a new endpoint.
4. The file enters the sky like any local file once it has an embedding and a position.

---

## Future work

Out of scope for v1 but tracked here so the architecture leaves room.

### 3D projection mode

- Optional `project: ℝ^768 → ℝ^3` parametric model (UMAP `n_components=3` or PCA top-3).
- Camera becomes an orbit camera (yaw/pitch/zoom + dolly) rather than pan/zoom.
- Schema: add `files.z REAL`, nullable; v1 ignores it. `layout_meta.algorithm` extended to `'pca-3d' | 'umap-3d'`.
- Occlusion: depth-sorted draw, additive blending so foreground stars don't fully hide background.
- Decision deferred: 2D first, prove the layout pipeline, then add 3D as a renderer toggle.

### Shader-grade rendering

Push the visual from "stylised CSS" to "JWST-grade." Mandates a WebGL renderer (Three.js or regl) — CSS/SVG hits a ceiling well before the 100k-star target. Also the natural home for F8 if canvas2d perf fails.

- **Bloom / HDR glow:** post-process pass instead of `drop-shadow`. Per-star intensity from `view_count` + highlight state. UnrealBloomPass or custom dual-Kawase.
- **Twinkle:** per-star phase-offset opacity oscillation (`sin(t * f + phase)`), `f` ~0.3–1.5 Hz, amplitude scaled by star size. Cheap; runs in vertex/fragment shader from a `(phase, freq)` attribute.
- **Parallax star field:** 3–4 background layers of decorative stars at fractional pan rates.
- **Edges as gradient filaments:** drawn only on hover/search as soft additive lines with alpha falloff at endpoints.
- **Constellation nebulae:** soft alpha-blended noise textures (Perlin/Worley) tinted by cluster color, replacing flat convex hulls. Density modulated by member count.
- **Milky-Way-like backdrop:** density gradient tied to global cluster centroid distribution.
- **Tone mapping:** ACES filmic on the final framebuffer so bloom doesn't blow out to white.

### Star Palace as an AI-work visualizer

**Premise.** AI agents now generate code faster than a human can read. Reading is innately slow; visualization scales better. Star Palace's persistent spatial map of files is a natural surface for *watching* an AI work instead of reading every diff.

**Concept.**

- Each cluster represents a **task** (e.g., "renderer UI", "sorting-algorithm impl", "schema migration"). Either auto-derived from the existing constellation grouping or explicitly assigned by the agent at task start.
- Files the agent creates or edits become **new or modified stars** in the appropriate cluster. A pulse animation (reuse F12) marks recently-touched stars.
- The agent annotates each cluster as it works: **why** the change was made, **what impact** it has on the overall objective. Annotations live in `clusters.label` (already nullable) plus a new `clusters.rationale` field, surfaced in a per-cluster info card.
- A timeline scrubber replays which stars lit up in which order across an agent run. Lets a human audit "what did this agent actually do" at a glance.

**What's already there.** Position and edges are persisted; F12 selection pulse and F1 search-pop visuals can stand in for "recently changed". F9 galaxies could host a "this run" galaxy that vanishes when the run ends. F5 collections can serve as a per-task filter today (no schema change needed).

**What's missing.**

- An **agent-visible API** for `tag this commit's files into cluster X with rationale Y`. Today's daemon assumes file changes come from a `walker.ts` pass, not an agent's diff stream.
- **Directory-as-tag in the embedding** (F19) so cluster boundaries reflect human-curated folder semantics, not just body-text similarity. Without F19 the agent's "UI cluster" can scatter across the map because UI files share words with non-UI files.
- A **diff-driven update path**: instead of re-walking the tree, accept a `{ added, modified, deleted }` set from the agent and route each through `insertOne` with a `runId` tag.
- **Per-cluster rationale rendering** in the renderer (likely a panel toggled on cluster click).

**Why this matters for the project itself.** Dogfood opportunity: every commit on Star Palace itself could be visualized in Star Palace, with the agent that wrote the commit narrating its own changes per cluster. The repo becomes its own demo.

**Out of scope for v1.** Multi-agent disambiguation; long-term agent-rationale storage beyond the current run; replaying past runs from git history.

### Other

- WebGPU path once Three.js / regl support stabilises across Electron and browsers.
- VR/AR view of the 3D sky (WebXR). Speculative.
- Audio: subtle ambient drone keyed to the cluster the camera is centered over.
- LLM-generated tree node labels (F7 follow-up).
- F2.1 user-editable extension → star-type rules.
- Animated cloud bands on F8d planets.

---

## Open questions

1. **Projection algorithm:** parametric UMAP (better separation, heavier dependency, slower training) vs incremental PCA (closed-form, fast — but less visually pleasing clusters)?
2. **Cold-start UX:** show transient `cose` layout immediately, or hold off rendering until first projection is trained?
3. **"New since" marker scope:** files added in the last session, last 7 days, or until the user dismisses?
4. **Constellation labeling:** automatic name suggestions (e.g., from top tf-idf terms across cluster) or user-only?
5. **Drift correction visibility:** does the user see a notification when a re-fit is about to happen, or is it silent with animation?
6. **F2 schema:** defaults are opinionated. User should review the table and swap any types they dislike before we ship.
7. **F5:** dynamic collections refresh policy — manual button only (current spec) or automatic on every layout retrain?
8. **F6:** clipboard yank/paste analog? (`y` already used for "save selection as collection".)
9. **F7:** leaf threshold — 30 feels right but might need tuning at scale.
