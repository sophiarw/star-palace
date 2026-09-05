# Star Palace — agent guide

## Read first

- [docs/revamp-vision.md](docs/revamp-vision.md): approved redesign vision, findings, architecture, and acceptance targets.
- [docs/revamp-concept.html](docs/revamp-concept.html): approved visual direction for the default atlas, search, and reader; fictional data only.
- [README.md](README.md): setup, scripts, configuration, and supported user flows.
- [CLAUDE.md](CLAUDE.md): persistence invariants and commit gates.
- [repo-state.md](repo-state.md): historical implementation map. Prefer current code when the snapshot is stale.
- [REQUIREMENTS.md](REQUIREMENTS.md): existing capabilities and original product rationale. The approved revamp supersedes old presentation constraints.
- [docs/revamp-progress.md](docs/revamp-progress.md), when present: implementation checkpoints, validation, remaining work, and rollback instructions.
- [docs/future-features.md](docs/future-features.md): user-requested ideas intentionally deferred, including folder constellation lines and zodiac-like illustrations.
- [website/README.md](website/README.md): public website, fictional demo, feedback handoff, GitHub Pages deployment, and Squarespace DNS.
- [docs/mac-distribution.md](docs/mac-distribution.md): Mac packaging investigation, tested build foundation, and remaining distribution work.

## Working agreement

The map is a persistent memory palace. Search navigates and highlights it; ordinary indexing must not rearrange existing files. Every indexed file must remain accessible without an embedding model. Preserve user metadata, collections, pins, source roots, and existing advanced capabilities.

Develop the revamp in `worktrees/atlas-revamp` on `feat/atlas-revamp`. Keep the original checkout and its pre-existing uncommitted changes intact. Commit a baseline in the worktree before implementation, then use focused conventional commits. Never run experimental migrations against the user's primary database: validate against an isolated copy or fixtures.

Before committing, run `npm run typecheck`, `npm run lint`, and `npm test`. Build the renderer for integration milestones. Add meaningful regression tests for data integrity, search correctness, layout stability, and user interactions. Record measured performance separately from targets; do not infer foreground frame rate from background or headless timing.

## Code map

- `website/`: static marketing/tutorial site; `vite.site.config.ts` builds `dist-site/`. Uses the app's existing Canvas artwork and fictional files only. Never publish real-library screenshots or data.
- `scripts/start-local.mjs`: one-command source launcher, including isolated demo mode.
- `tsconfig.daemon.build.json`: distributable daemon/worker compilation; `scripts/check-mac-runtime.mjs` checks it using temporary fixtures.
- `LICENSE`: PolyForm Noncommercial with the user's explicit personal/internal workplace-use permission. Describe the project as source available, not open source.

- `src/daemon/atlas/`: additive persistent atlas, FTS retrieval, region summaries, snapshots, and background service.
- `src/daemon/index/extractors/`: bounded worker extraction shared by search, readers, and embedding paths.
- `src/daemon/index.ts`: HTTP composition and legacy routes.
- `src/daemon/db/FileIndex.ts`: SQLite schema and file/collection persistence.
- `src/daemon/pipeline/Insert.ts`: indexing transactions and ANN ordering.
- `src/daemon/index/`: traversal, extraction, ignore rules, and progress.
- `src/daemon/search/`: retrieval implementations.
- `src/daemon/layout/`: projection and clustering.
- `src/daemon/embedding/`: model adapter, strategies, and experiments.
- `src/renderer/src/atlas/`: default workspace, reader, search, semantic zoom, GPU/Canvas renderer, and bounded per-file procedural sprite cache.
- `src/renderer/src/LegacyApp.tsx`: preserved advanced workspace.
- `src/shared/celestial.ts`: canonical file-type/object mapping; both renderers share it.
- `src/shared/atlas.ts`: new atlas HTTP contracts.
- `tests/atlas/`, `tests/browser/`: persistence/search integrity and end-to-end interaction checks.
- `docs/atlas-validation.md`: measured performance and limitations.
- `src/renderer/src/App.tsx`: default application entry.
- `src/renderer/src/components/`: existing map, viewers, and advanced panels.
- `src/renderer/src/themes/`: retained theme artwork and contracts.
- `src/shared/types.ts`: shared API contracts.
- `tests/`: automated checks; the default suite excludes the legacy HTTP contract test for its documented native teardown issue.

Renderer code must not import Node APIs. Embeddings entering HNSW remain L2 normalized. ANN lookup precedes the SQL transaction and ANN insertion follows commit. Derived search/layout indexes should be recoverable and versioned; user-authored state remains authoritative in SQLite.

The user specifically wants intermixed celestial file types and deterministic per-file artwork. Preserve these. Close-up generation must remain bounded and must not create a per-file texture cache for the whole library. New file placement must not separate neighborhoods solely by file type.

## Continuous map and organic layout

- `src/daemon/atlas/organicLayout.ts` preserves the legacy semantic projection, separates coincident files locally, and places model-free files using neighbors/folders. File positions remain fixed during ordinary indexing.
- `AtlasStore.summary()` returns real file markers at their persistent world coordinates. Coarse views must not substitute invented stars at unrelated positions.
- `src/renderer/src/atlas/useAtlasTiles.ts` hydrates bounded spatial viewports. A data response must never move the camera.
- `src/renderer/src/atlas/labelPainter.ts` retains visible labels and fades visibility changes. Hover must not reorder headings or flip their placement.
- Scrolling changes one camera continuously; it must not change navigation scope or restore another camera. Explicit navigation may animate to a destination. Layout epochs invalidate cameras after an explicit reshaping/restore.
- `scripts/reshape-atlas.ts` is an explicit, isolated-copy-only review helper, with a database backup and snapshot. Never run it against the primary library.
- `tests/browser/atlas.spec.ts` includes delayed-response zoom continuity, hover pixel stability, home navigation, and offscreen-selection tests. `scripts/inspect-atlas-zoom.mjs` and `scripts/benchmark-atlas-navigation.mjs` validate the real-library preview.
