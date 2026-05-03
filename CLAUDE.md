# Star Palace — CLAUDE.md

This file is the agent entry point. It contains the reading map and the rules that govern day-to-day work. Everything else is in one of three sibling docs.

## Reading map

| Doc | Audience | Read when |
|---|---|---|
| **`README.md`** | humans (and agents who need to run the app) | Quickstart, keybindings, env vars, dev gates. |
| **`repo-state.md`** | agents needing wide context | Comprehensive snapshot: every endpoint, every column, every perf gate, all branches, all stashes, full feature index with file pointers. **Load this before any non-trivial change.** |
| **`REQUIREMENTS.md`** | designers and agents implementing a feature | Feature spec (F1–F19) with rationale, status, schema design, design philosophy. Source of truth for *why*. |

If you can't find the answer in those three, the code is the source of truth — start at `src/daemon/index.ts` (HTTP routes) or `src/renderer/src/App.tsx` (UI shell).

## Commit gates

Before any commit:

```
npm run typecheck && npm run lint && npm run test
```

All three must pass. No `// @ts-ignore`. No `eslint-disable` (except in `vitest.config.ts` and the Vite config files). Conventional commits: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

A tracked pre-commit hook at `scripts/git-hooks/pre-commit` enforces the three gates above. `scripts/install-git-hooks.sh` copies it into `.git/hooks/` and is invoked by the `prepare` script in `package.json`, so a fresh `npm install` arms the hook. Re-run the install script manually after fresh-cloning into a worktree where `.git/hooks/` is empty.

## Architecture in one paragraph

Two processes connected over HTTP. **Daemon** (`src/daemon/index.ts`) is Express on `127.0.0.1:7373`; owns SQLite, HNSW, PCA, Ollama. No React. **Renderer** (`src/renderer/`) is Vite + React + Canvas2D on `:5173`; talks to daemon via `fetch`; never imports Node APIs. External prerequisite: a local Ollama server with `nomic-embed-text` pulled. Data lives in `~/.starpalace/` (override via `STARPALACE_DIR`, `STARPALACE_DB`).

Full HTTP surface, schema, pipelines, and perf gates: `repo-state.md`.

## Hard invariants

These are the rules whose violation will silently corrupt state. If a change touches the relevant area, double-check.

- **Embeddings are L2-normalised in `EmbeddingEngine.embed`** before being handed to HNSW. The HNSW space is `ip` (inner product), so distance only equals `1 − cos_sim` when the input is unit-length. All current callers satisfy this; new callers must too.
- **`Insert.insertOne` searches HNSW *before* the SQL transaction**, then calls `hnsw.addPoint` *after* commit. This ordering means a transaction rollback can never leave an HNSW orphan. Do not reorder.
- **`is_pinned` and `star_type` survive re-index.** The upsert in `insertOne` uses `ON CONFLICT` to preserve them. Same for pin coefficients (`pin_alpha/beta/axis_a/axis_b/pinned_at`). New columns that should survive re-index need the same treatment.
- **`files.x`, `files.y` are NULL until `layout_meta.version >= 1`.** Renderer skips NULL-position files. `layout_version = 0` means indexed but not yet projected.
- **Edges have at most `K_NEAREST = 20` outgoing rows per `src_id`.** Pruned in `Insert.insertOne`. Don't bypass.
- **Renderer must never import Node APIs.** No `fs`, no `path`, no `child_process`. Talk to the daemon over `fetch` or add a new endpoint.
- **F8b per-id jitter is applied at draw time, not baked into the sprite cache.** Reordering the `rng()` calls inside `defaultJitterFor` (`src/renderer/src/components/StarMap/proc.ts`) reseeds every downstream feature. Treat the call order as a stable contract.

## Test runner caveat

`tests/api/contract.test.ts` (and any other test that imports `src/daemon/index.ts` directly) currently triggers a SIGSEGV on the vitest worker exit due to `hnswlib-node`'s async loader still settling when `node:worker_threads` cleans up. **Tests pass before the crash; the crash is on tear-down.** Run affected tests in isolation (`npx vitest run path/to/file.test.ts`) and route new daemon-side tests through extracted helpers (see `src/daemon/util/openInDefaultApp.ts` for the pattern) to avoid the daemon import.
