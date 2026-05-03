# Star Palace — CLAUDE.md

## Architecture

Two processes connected over HTTP:

- **Daemon** (`src/daemon/index.ts`) — Express on `127.0.0.1:7373`. Owns SQLite, HNSW index, PCA model. No React.
- **Renderer** (`src/renderer/`) — Vite + React web app on `:5173`. Canvas2D. Talks to daemon via `fetch`. Never imports Node APIs.

Start both: `npm run dev:daemon` and `npm run dev:web` in separate terminals.

## External prerequisites

```
ollama serve              # must be running
ollama pull nomic-embed-text
```

Daemon warns on `/api/health` if Ollama unreachable. Embeddings call `POST localhost:11434/api/embeddings`.

## Data layout

```
~/.starpalace/
  index.db          # SQLite (WAL mode) — files, edges, clusters, layout_meta
  hnsw.bin          # hnswlib-node persisted index
  hnsw.bin.map.json # fileId <-> hnswlib label mapping
```

Override with `STARPALACE_DB=/path/to/db` and `STARPALACE_DIR=/path/to/dir`.

## Schema invariants

- `files.embedding` is a 768-float32 BLOB (3072 bytes). NULL until embedded. Vectors are L2-normalised in `EmbeddingEngine.embed` so the HNSW `ip` space yields cosine similarity directly.
- `files.x`, `files.y` are NULL until `layout_meta.version >= 1`. Renderer skips NULL-position files.
- `files.layout_version = 0` means file was indexed but not yet projected. Gets updated to 1+ during Relayouter.train().
- `files.is_pinned` (0/1) and `files.star_type` (nullable text from `STAR_TYPES`) survive re-index — `upsert` does not overwrite them.
- `edges` has at most K=20 outgoing rows per `src_id`. Pruned in Insert pipeline.
- `clusters.color_index` is modulo-indexed into `CONSTELLATION_PALETTE`.

## Insert flow

`insertOne()` in `src/daemon/pipeline/Insert.ts`:

1. Hash content → skip if `files.content_hash` matches (no re-embed).
2. Embed via Ollama (vector validated + normalised).
3. ANN top-K=20 against the existing index (new point added afterwards so a transaction rollback never leaves an HNSW orphan).
4. **Single DB transaction**: upsert `files` row, write outgoing `edges`, displace K-th edge of neighbors if applicable, cluster vote, project position.
5. After commit, `hnsw.addPoint()` registers the new embedding.

Layout trains automatically once 200 embeddings exist (first call to `relayouter.maybeTrainFirst()`).

## PCA projection

`src/daemon/layout/Pca.ts` wraps `ml-pca`:

- `StarPca.train(embeddings)` — SVD, keep top `PC_COUNT` eigenvector columns (PC directions). `PC_COUNT = 8` powers the F3 PC dial: the renderer picks any two of the top 8 components for X/Y without retraining.
- `pca.project(embedding)` — subtract mean, dot with each active PC.
- Positions are scaled to `[-500, 500]` world units by `scalePositions()`.
- Serialised to `layout_meta.projection_model` as JSON. Daemon startup runs an F3 migration: if a persisted model has fewer than `PC_COUNT` components it retrains once.

UMAP swap: implement `Umap` with same `train/project/serialize` interface in `Pca.ts`, update `Relayouter.train()` to call it.

## HNSW index

`src/daemon/ann/HnswIndex.ts` wraps `hnswlib-node`:

- Space: `ip` (inner product). For normalised vectors: distance = 1 - cosine_similarity.
- `addPoint(embedding, fileId)` — embedding must be normalised. `EmbeddingEngine.embed` normalises before returning, so all callers in this codebase already satisfy the contract.
- `searchKNN(embedding, k)` returns `{ id, distance }` sorted ascending by distance (= descending by similarity).
- `hnsw.save()` / `hnsw.load()` persist bin + JSON map to disk. Called after `/api/index` completes.

## Git discipline

Before any commit:

```
npm run typecheck && npm run lint && npm run test
```

All must pass. No `// @ts-ignore`, no `eslint-disable` (except in vitest.config.ts and the vite config files which are excluded).

Conventional commits: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

A tracked pre-commit hook at `scripts/git-hooks/pre-commit` enforces
the three gates above. `scripts/install-git-hooks.sh` copies it into
`.git/hooks/` and is invoked by the `prepare` script in `package.json`,
so a fresh `npm install` arms the hook. Re-run the install script
manually after fresh-cloning into a worktree where `.git/hooks/` is
empty.

## Renderer hot-paths

- `src/renderer/src/components/StarMap/StarMap.tsx` — canvas draw loop. Backing-store sized to `window.innerWidth × devicePixelRatio` so retina displays render crisp; mouse handlers read `canvas.clientWidth` (CSS pixels).
- `src/renderer/src/components/StarMap/coords.ts` — pure `worldToScreen`/`screenToWorld` (separated from StarMap so the math is unit-testable in node).
- `src/renderer/src/hooks/useVimMode.ts` — keybindings: `h/j/k/l` pan, `gg` fit-all, `gh` fit-cluster, `n/N` cycle search hits, `o` open file, `t/T` star type, `?` cheatsheet, `/` focus search. The full table lives in `src/renderer/src/components/Cheatsheet/Cheatsheet.tsx`.

## Test runner caveat

`tests/api/contract.test.ts` (and any other test that imports `src/daemon/index.ts` directly) currently triggers a SIGSEGV on the vitest worker exit due to hnswlib-node's async loader still settling when `node:worker_threads` cleans up the env. Tests pass before the crash; the crash is on tear-down. Prefer running affected tests in isolation (`npx vitest run path/to/file.test.ts`) and route new daemon-side tests through extracted helpers (see `src/daemon/util/openInDefaultApp.ts` for the pattern) to avoid the daemon import.

## Adding a new platform

1. Add a new value to `Platform` in `src/shared/types.ts`.
2. Implement a walker that yields `{ node: FileNode, content: Buffer }`.
3. Call `insertOne()` per file from `indexPath()` or a new endpoint.
4. The file enters the sky like any local file once it has an embedding and a position.
