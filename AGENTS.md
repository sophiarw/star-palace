# Star Palace — agent guide

## Read first

- [docs/revamp-vision.md](docs/revamp-vision.md): approved redesign vision, findings, architecture, and acceptance targets.
- [docs/revamp-concept.html](docs/revamp-concept.html): approved visual direction for the default atlas, search, and reader; fictional data only.
- [README.md](README.md): setup, scripts, configuration, and supported user flows.
- [CLAUDE.md](CLAUDE.md): persistence invariants and commit gates.
- [repo-state.md](repo-state.md): historical implementation map. Prefer current code when the snapshot is stale.
- [REQUIREMENTS.md](REQUIREMENTS.md): existing capabilities and original product rationale. The approved revamp supersedes old presentation constraints.
- [docs/revamp-progress.md](docs/revamp-progress.md), when present: implementation checkpoints, validation, remaining work, and rollback instructions.

## Working agreement

The map is a persistent memory palace. Search navigates and highlights it; ordinary indexing must not rearrange existing files. Every indexed file must remain accessible without an embedding model. Preserve user metadata, collections, pins, source roots, and existing advanced capabilities.

Develop the revamp in `worktrees/atlas-revamp` on `feat/atlas-revamp`. Keep the original checkout and its pre-existing uncommitted changes intact. Commit a baseline in the worktree before implementation, then use focused conventional commits. Never run experimental migrations against the user's primary database: validate against an isolated copy or fixtures.

Before committing, run `npm run typecheck`, `npm run lint`, and `npm test`. Build the renderer for integration milestones. Add meaningful regression tests for data integrity, search correctness, layout stability, and user interactions. Record measured performance separately from targets; do not infer foreground frame rate from background or headless timing.

## Code map

- `src/daemon/index.ts`: HTTP composition and legacy routes.
- `src/daemon/db/FileIndex.ts`: SQLite schema and file/collection persistence.
- `src/daemon/pipeline/Insert.ts`: indexing transactions and ANN ordering.
- `src/daemon/index/`: traversal, extraction, ignore rules, and progress.
- `src/daemon/search/`: retrieval implementations.
- `src/daemon/layout/`: projection and clustering.
- `src/daemon/embedding/`: model adapter, strategies, and experiments.
- `src/renderer/src/App.tsx`: default application entry.
- `src/renderer/src/components/`: existing map, viewers, and advanced panels.
- `src/renderer/src/themes/`: retained theme artwork and contracts.
- `src/shared/types.ts`: shared API contracts.
- `tests/`: automated checks; the default suite excludes the legacy HTTP contract test for its documented native teardown issue.

Renderer code must not import Node APIs. Embeddings entering HNSW remain L2 normalized. ANN lookup precedes the SQL transaction and ANN insertion follows commit. Derived search/layout indexes should be recoverable and versioned; user-authored state remains authoritative in SQLite.
