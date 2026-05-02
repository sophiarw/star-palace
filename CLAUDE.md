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

- `files.embedding` is a 768-float32 BLOB (3072 bytes). NULL until embedded.
- `files.x`, `files.y` are NULL until `layout_meta.version >= 1`. Renderer skips NULL-position files.
- `files.layout_version = 0` means file was indexed but not yet projected. Gets updated to 1+ during Relayouter.train().
- `edges` has at most K=20 outgoing rows per `src_id`. Pruned in Insert pipeline.
- `clusters.color_index` is modulo-indexed into `CONSTELLATION_PALETTE`.

## Insert flow

`insertOne()` in `src/daemon/pipeline/Insert.ts`:

1. Hash content → skip if `files.content_hash` matches (no re-embed).
2. Embed via Ollama.
3. Upsert `files` row.
4. Add to HNSW.
5. ANN top-K=20 → write `edges`.
6. Update neighbors' `edges` if this file displaces their K-th.
7. Cluster: plurality vote on neighbors' `cluster_id`.
8. Project if `Relayouter.isReady`.

Layout trains automatically once 200 embeddings exist (first call to `relayouter.maybeTrainFirst()`).

## PCA projection

`src/daemon/layout/Pca.ts` wraps `ml-pca`:

- `StarPca.train(embeddings)` — SVD, extract columns 0 and 1 of the eigenvector matrix (PC directions).
- `pca.project(embedding)` — subtract mean, dot with each PC.
- Positions are scaled to `[-500, 500]` world units by `scalePositions()`.
- Serialised to `layout_meta.projection_model` as JSON.

UMAP swap: implement `Umap` with same `train/project/serialize` interface in `Pca.ts`, update `Relayouter.train()` to call it.

## HNSW index

`src/daemon/ann/HnswIndex.ts` wraps `hnswlib-node`:

- Space: `ip` (inner product). For normalised vectors: distance = 1 - cosine_similarity.
- `addPoint(embedding, fileId)` — embedding must be normalised Float32Array for cosine math to hold.
- `searchKNN(embedding, k)` returns `{ id, distance }` sorted ascending by distance (= descending by similarity).
- `hnsw.save()` / `hnsw.load()` persist bin + JSON map to disk. Called after `/api/index` completes.

## Git discipline

Before any commit:

```
npm run typecheck && npm run lint && npm run test
```

All must pass. No `// @ts-ignore`, no `eslint-disable` (except in vitest.config.ts and the vite config files which are excluded).

Conventional commits: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

## Adding a new platform

1. Add a new value to `Platform` in `src/shared/types.ts`.
2. Implement a walker that yields `{ node: FileNode, content: Buffer }`.
3. Call `insertOne()` per file from `indexPath()` or a new endpoint.
4. The file enters the sky like any local file once it has an embedding and a position.
