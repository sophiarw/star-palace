# Star Palace

A persistent star map of your files. Each file is a star with a stable 2D position. Semantically related files cluster together into constellations. Search pans the camera; it does not rebuild the graph.

## Quickstart

**Prerequisites:**
- Node 20+
- [Ollama](https://ollama.com/) installed and running

```sh
# 1. Pull the embedding model
ollama pull nomic-embed-text

# 2. Install dependencies
npm install

# 3. Fetch the demo corpus (~14 MB newsgroups + 3 GitHub repos)
bash scripts/fetch-corpus.sh

# 4. Start the daemon (keep this running)
npm run dev:daemon

# 5. In a second terminal: seed + index the corpus
tsx scripts/seed-mvp.ts

# 6. In a third terminal: open the renderer
npm run dev:web
# → open http://localhost:5173
```

Seeding ~2 000 files takes roughly 2–5 minutes (Ollama embed ~50ms/file).

## Usage

| Action | How |
|---|---|
| Pan | Drag |
| Zoom | Scroll wheel |
| Hover a star | See file metadata |
| Click a star | Show nearest-neighbor edges |
| Search | Type in the search bar; camera animates to results |
| Clear search | Press Escape |

## Index your own files

```sh
# While the daemon is running:
tsx scripts/index-cli.ts /path/to/your/folder
```

## Architecture

```
Daemon (port 7373)          Renderer (port 5173)
  Express HTTP API    ←→      React + Canvas2D
  SQLite (files, edges,       Pan/zoom camera
    clusters, layout)         Star glow rendering
  HNSW ANN index              Search animation
  PCA 2D projection
  Ollama embeddings
```

See `CLAUDE.md` for internals, schema invariants, and extension guide.

## Development

```sh
npm run typecheck   # tsc strict check
npm run lint        # eslint --max-warnings 0
npm run test        # vitest (47 tests)
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `STARPALACE_DB` | `~/.starpalace/index.db` | SQLite path |
| `STARPALACE_DIR` | `~/.starpalace/` | Data directory |
| `DAEMON_PORT` | `7373` | Daemon HTTP port |

## Future work

See `REQUIREMENTS.md` §Future work for:
- 3D projection mode
- WebGL/shader rendering (bloom, twinkle, parallax)
- Drift detection + background re-fit
- Louvain clustering
- Electron desktop wrapper
