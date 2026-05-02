# Plan — Alternate Requirements: Starmap "Star Palace"

## Context

The original Starmap concept treats the graph as a **logical structure** computed on demand: each query yields a freshly laid-out 50-node subgraph, edges drawn from a similarity scoring function evaluated at query time. Position is presentational — recomputed every render via Cytoscape `cose`.

The user's revised intent is fundamentally different: a **persistent spatial map** of all files. Files have stable positions in 2D space. The user develops spatial memory ("research notes are in the upper-left, code in the lower-right"). Adding a file is an *insertion* into the existing layout, not a trigger to recompute it. Search is *navigation*, not subgraph generation — it pans the camera to a region of the persistent map.

This is closer to a **memory palace**: position is the artifact. The system's main job is to assign each file a coordinate that respects semantic structure, then *never move it without good reason*.

## How this differs from the current REQUIREMENTS.md

Implementation differs sharply in five ways:

1. **Layout is precomputed, persisted, and updated incrementally** — never recomputed at query time.
2. **Search returns coordinates + IDs** — the renderer pans/zooms; it does not lay out a new graph.
3. **The ANN index over embeddings drives positioning**, not pairwise scoring at render time.
4. **Edges are persisted** (top-K nearest neighbors per node) and updated on insert, not derived per-query.
5. **A drift-detection / background re-fit job is required** to keep the projection valid as the index grows.

The full requirements artifact is in `REQUIREMENTS.md` alongside this file.

## Critical files (when this plan moves to implementation)

- `REQUIREMENTS.md` (project root) — replace with `star-palace/REQUIREMENTS.md`, or branch as `REQUIREMENTS-palace.md` until the user picks a direction.
- `CLAUDE.md` — substantial rewrite of "Architecture", "Similarity engine design", "Indexing and caching", "Graph display" sections.
- `src/daemon/similarity/` — `EmbeddingEngine` becomes the primary engine; `MetadataEngine` becomes a pre-filter.
- `src/daemon/layout/` — new module: `ParametricProjection.ts`, `DriftDetector.ts`, `Relayouter.ts`.
- `src/daemon/db/` — schema migrations for `files.x`, `files.y`, `files.cluster_id`, `files.layout_version`, `files.first_seen`, `files.view_count`, `files.is_pinned`, `embedding` BLOB; new `edges`, `clusters`, `layout_meta` tables.
- `src/daemon/index.ts` — new endpoints under `/api/map/*`.
- `src/renderer/src/components/Map/` — replace `Graph/` with a camera-based `Map` component. Pan/zoom, viewport queries, LOD rendering.

## Verification (when implemented)

- Cold start: empty index, add 50 files. Verify `cose` placeholder renders. Add 200 files. Verify projection trains, positions written, animated transition.
- Insert stability: snapshot positions of 100 files, add 1 file, re-snapshot. Verify all 100 existing positions are unchanged (within float epsilon).
- Drift correction: simulate a heavy distribution shift (e.g., add 500 files in one new domain), verify drift detector triggers, verify Procrustes alignment keeps anchor positions visually close.
- Search navigation: search query → camera animates, highlights apply, non-matching dim. Pressing Escape returns to free browse.
- Edge persistence: insert file, query `edges` table; verify exactly K rows for new file's `src_id` and that it appears in K' ≤ K neighbors' edge lists where it displaces their old K-th.
- Scale: index 50k files, measure insert latency, search latency, viewport latency. Compare against scale targets.
- `npm run typecheck && npm run lint && npm run test` green throughout.
