# REQUIREMENTS — Starmap "Star Palace"

## Vision

A persistent star map of the user's files. Each file is a star with a stable 2D position. Semantically related files are spatially near each other. Adding a new file places a new star without disturbing the rest of the sky. Searching pans the camera to find a star or a region. The map is the product; queries are a way to navigate it.

The user returns to the same view session after session. Spatial memory accrues.

---

## v2 feature roadmap

Locked decisions:
- Pin policy: **pin in embedding-delta** (offset stored in embedding space, reprojected onto whichever PC pair is active). Survives PC switch.
- Hover bug + DetailPanel + JWST visuals + 9 manual star types are already shipped on `main` (commits `4b03f06`, `ae50d6a`, `cf3999d`).

| ID | Feature | Effort | Notes | Status |
|---|---|---|---|---|
| F1 | Search pop + extended zoom + zoom-exposure | XS | Visual only; same-day. | **DONE** |
| — | **BUG**: neighbor stars still vanish at high zoom despite bypass-cull fix | — | Root cause unclear; multiple fix attempts failed. | **OPEN** |
| F2 | Auto-schema (extension → star type) | S | Renderer fallback only; no DB migration. | **DONE** |
| F3 | PC dial (pick X/Y from top-8 components) | M | Layout meta change; no schema for files. | **DONE** |
| F4 | Manual reposition + pin | M | New columns; embedding-delta math. | **DONE** |
| F5 | Virtual collections | M-L | New tables + endpoints + render hull. | |
| F6 | Vim mode | M | Pure UI; no backend. | **IN PROGRESS** |
| F7 | Hierarchical k-means / LOD tree | L | Re-architecture; biggest blast radius. | |
| F8 | Procedural per-file graphics | L | Bigger graphics push: every file's visual is hash-derived. | |

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

1. **F1 + F2** (one branch, one PR) — small, immediate user-visible gain.
2. **F3** — unlocks F4. Self-contained.
3. **F4** — depends on F3 for the multi-PC-aware embedding-delta math.
4. **F5** — depends on nothing else; can also slot in parallel to F3/F4.
5. **F6** — independent; nice once F1–F5 land so there's enough surface to bind keys to.
6. **F7** — biggest scope; benefits from the tree visualization making the rest of the UI more useful.
7. **F8** — visual polish on top; split into F8a (typed variants, 1d), F8b (default jitter, ½d), F8c (procedural nebulae, 1d), F8d (planet view, 2–3d).

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
