# Atlas revamp — implementation log

Branch: `feat/atlas-revamp` · worktree: `worktrees/atlas-revamp`

The original checkout is preserved. The first commit on this branch checkpoints its existing source edits and approved design references. All runtime validation uses fixtures or a SQLite backup in `.atlas-dev/`, never the primary database.

## Delivery checklist

- [x] Agent reading map and isolated Git baseline.
- [ ] Additive atlas/search storage, complete file coverage, scoped lexical and semantic retrieval, shared extraction.
- [ ] Stable region → neighborhood → file hierarchy, world pins, snapshots and restoration.
- [ ] Default atlas shell matching the visual concept, GPU/Canvas rendering, bounded labels, coherent navigation.
- [ ] Persistent search/results, accessible file list/grid, reader and content-specific previews.
- [ ] Collections, sources/indexing, tags, manual classification, saved places, themes and advanced workspace.
- [ ] Integration/browser tests, actual-data review, rendering/search benchmarks, documentation and final checkpoint.

## Validation record

Baseline: typecheck and lint pass. Default tests: 384 pass, 3 fixture-dependent graphics checks skipped in the worktree. The same three checks passed in the original checkout with its audit corpus. The legacy HTTP contract suite remains opt-in due to its documented native teardown crash.

## Rollback

Use the original checkout on `main` to run the original app. This implementation will retain the legacy UI behind an explicit view switch. Atlas coordinates and search data use additive tables; legacy PCA positions and embeddings remain available. The isolated development database can be discarded without affecting the primary library.

Do not reset the original checkout: it contains pre-existing uncommitted user work. Revert implementation commits on this branch if an individual change needs to be backed out.
