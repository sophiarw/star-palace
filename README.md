# Star Palace

A persistent star map of your files. Each file is a star with a stable 2D position. Semantically related files cluster together into constellations. Search pans the camera; it does not rebuild the graph.

Website: [starpalace.ai](https://starpalace.ai). The website's source, local preview, feedback behavior, and domain setup are documented in [website/README.md](website/README.md).

## License

Star Palace is source available under [PolyForm Noncommercial 1.0.0 with an additional workplace-use permission](LICENSE). You can use and modify it for personal use and internal workplace use, including paid professional work. Selling or monetizing Star Palace itself, modified versions, or paid services offering its functionality requires a separate license. Third-party components retain their own licenses. The full license controls.

## Install from source on Mac

Install Node.js 22, Git, and the macOS command line tools (`xcode-select --install`), then:

```sh
git clone --branch feat/atlas-revamp https://github.com/sophiarw/star-palace.git
cd star-palace
npm ci
npm start
```

Open [127.0.0.1:5173](http://127.0.0.1:5173). One terminal runs both processes; Control C stops them. Existing users should back up `~/.starpalace` before adopting the development branch. After `npm run seed:atlas`, `npm run start:demo` runs a separate fictional library at port 5174.

A standalone Mac app is being investigated; there is no signed installer yet. See [Mac distribution findings](docs/mac-distribution.md) for the tested runtime foundation and remaining release work.

## Try the new atlas

The default workspace has a persistent galaxy shaped by file relationships, local name/text search, map/list/grid browsing, and an expandable reader. Files remain available without an embedding model. Most files appear as pale stars, with bounded size variation based on file bytes and deterministic details based on file ID. Mark a file as a favorite to give it a pulsar or black-hole appearance. Pins still control position; legacy manual classifications remain available in the classic workspace.

The revamp lives on `feat/atlas-revamp` in `worktrees/atlas-revamp`. From that directory, run an isolated demo:

```sh
npm install
npm run seed:atlas
# Terminal 1
npm run dev:atlas:daemon
# Terminal 2
npm run dev:atlas:web
# Open http://127.0.0.1:5174
```

This creates 124 fictional files and a separate database in `.atlas-dev/`. Two demo files are explicit favorites; the remaining files are ordinary stars. Legacy manual classifications also remain for the classic workspace. Re-running the seeder resets the generated file contents. It does not seed your primary library.

## Use your library

The current real-library review runs at `http://127.0.0.1:5176` against an isolated backup. See [restart instructions](docs/revamp-progress.md#real-library-review) to resume that preview.

Tested with Node 22.17. Start `npm run dev:daemon` and `npm run dev:web`, then open `http://localhost:5173`. The daemon uses `~/.starpalace` unless `STARPALACE_DIR` or `STARPALACE_DB` is set. Atlas tables are additive; the classic positions, embeddings, collections, and user metadata remain available. Back up a primary database before adopting any development branch.

Choose **Manage sources → Index folder** to add or refresh a folder. Ollama with `nomic-embed-text` is optional for names, tags, text search, and browsing; it is required for semantic indexing and related-meaning search:

```sh
ollama pull nomic-embed-text
```

## Atlas controls

| Action | How |
|---|---|
| Explore | Scroll continuously into the galaxy; click a heading to visit a region; use Your atlas to return to the full view |
| Pan / zoom | Drag / wheel, `h j k l`, `+` / `−` |
| Inspect an object | Select it and zoom in; close-up detail is seeded by its file ID |
| Search | `/` forward, `?` backward, `⌘/Ctrl K` or `⌘/Ctrl F`; arrow keys select a result, Enter opens it; Escape leaves typing with the query intact |
| Read | Select a file to preview; **Expand** or Enter opens the full reader |
| Next / previous file | `n` / `N` outside text fields |
| First / last file | `g g` / `G`; counts such as `12G` select within the loaded page |
| Fit view | **Fit view** or `z f` |
| Folder connections | **Folder constellations** selects all folders, the selected folder, or off |
| File ranges | `v`, then motions; `y` copies paths and `:collection` saves the range through a form |
| Marks / jumps | `ma` saves session mark a, `'a` returns; `Ctrl O/I` visits older/newer keyboard jumps |
| Keyboard reference | **Commands**, `:help`, or F1; [full mapping and limits](docs/vim-browsing.md) |
| Pin | Shift-drag a file, or use its file details |
| Save a place | **Save place** captures scope, selection, and camera |
| Change an object's type | **Tags, pinning & file details → Star type** |
| Learn the objects | **Object guide** |
| Open / reveal original | `o` / `O` or reader buttons |
| Settings / snapshots | Gear button; snapshots restore positions, pins, and region geometry with an automatic backup |
| Advanced tools | **Commands → Embedding lab, PCA & classic themes**, or `?view=classic` |

The reader supports Markdown with a contents list, highlighted text/code with line numbers, virtualized CSV/TSV tables, image zoom, and PDF pages or extracted text. Search opens matching passages. Text extraction is capped at 2 MiB; PDF/DOCX containers over 32 MiB remain accessible as metadata. Scanned PDFs need external OCR. Filename identity is path-derived: moving a file is currently an indexing change, not a guaranteed identity-preserving rename.

Folder constellations connect direct siblings at their existing coordinates; [geometry and rendering notes](docs/folder-constellations.md) explain the limits. The approved [Clouds & landmarks language](docs/design/stellar-atlas-study.html) is shared by the atlas and website. Subtle colored nebulae group duplicates or strong indexed semantic matches; directory membership alone is not similarity evidence. [Favorites](docs/favorites.md) are separate from pins and persist through reindexing.

See [implementation and rollback notes](docs/revamp-progress.md), [measured performance](docs/atlas-validation.md), and the [approved vision](docs/revamp-vision.md).

## Classic workspace controls

The controls below apply to `?view=classic`, which retains the original map, theme artwork, usage classification, PCA axes, and embedding experiments.

### Camera + selection

| Action | How |
|---|---|
| Pan | Drag, or `h` / `j` / `k` / `l` (held = continuous); `H J K L` (4× speed) |
| Zoom | Scroll wheel, or `+` / `-` |
| Fit all stars | `gg` |
| Fit selected cluster | `gh` |
| Hover a star | See file metadata in the hover card |
| Click / Enter | Select hovered star → DetailPanel opens with content + neighbors |
| Search | `Cmd+F` / `Ctrl+F` to toggle the search bar (or click it) |
| Cycle search results | `n` / `N` |
| Open file in default app | `o` (selected star) |
| Reveal in OS file explorer | `O` (capital — Finder / Explorer / file manager) |
| Star-type dropdown | `t` (open) / `T` (cycle forward) |
| Pin a star to a position | Shift + drag the hovered star |
| Toggle cheatsheet | `?` |
| Toggle Collections sidebar | `c` |
| Focus Galaxy panel path input | `i` |
| Toggle perf overlay | `Shift+P` (FPS, p99, dropped frames — see [Performance](#performance)) |
| Toggle Embedding Lab | `Shift+E` (run / preview / promote / revert embedding experiments) |
| Esc | Cancel pin-drag / leave search / clear selection / clear active collection |

### Top bar (StatsBar)

- **Color by** — `Type` uses the auto/manual star type; `Usage` buckets by the daemon's `importance_score`.
- **Theme** — dropdown picker. Five themes share the procedural engine; each owns its own resolution + smoothing + lighting:
  - **JWST** — deep-space realism, Carina-palette nebulae, soft halos + vignette.
  - **Vapor** — synthwave + Tron grid + CRT scanlines (theme `postPass`).
  - **Atari low-res** — chunky 8-bit (theme sets `dprCap: 1.0`).
  - **Lost in space** — astronauts, ships, wormholes (theme sets `flatLighting`).
  - **Bioluminescent** — anemones, jellyfish, glowing flora (theme sets `flatLighting`).

### Panels

- **PC dial** (top-left) — pick any two of the top 8 principal components for the X/Y axes. Layout is precomputed; flipping axes only re-projects, no re-train.
- **Galaxy panel** (top-right) — index a folder as a galaxy; one row per indexed root with live progress, hide/show toggle, and "fly to" button.
- **Collections sidebar** (left, toggle with `c`) — static (explicit member list) or dynamic (saved query) groups. Active collection draws a constellation-style hull on the map and dims non-members.
- **DetailPanel** (right, opens on selection) — file content viewer (markdown / code / image), neighbor list, star-type override, **tag chip list** (B1), pin/unpin, "remove from collection" when one is active.
- **Embedding Lab** (`Shift+E`) — pick a subdir + an embedding strategy, run an experiment on the subset, preview the new layout, then **Promote** (adopt as default + re-embed rest of corpus in the background) or **Revert** (restore prior embeddings + positions from snapshot).

## Tags (per file)

Click any star to open the DetailPanel, then enter tags as chips below the star-type selector. Tags survive re-index (COALESCE-preserving upsert, like pins / star_type) and feed the `tags+metadata+content` embedding strategy when active. Persisted in `files.tags` (JSON-encoded `string[]`). Backend: `GET/POST /api/file/:id/tags`.

## Embedding strategies

The daemon's prompt to Ollama is configurable per-file via the `embedding_strategy` column. Five strategies live in `src/daemon/embedding/strategies.ts`:

| Strategy | Prompt shape | Use case |
|---|---|---|
| `content-only` | Raw UTF-8 file content | Legacy default; long prose. |
| `metadata-only` | filename + parent + ext + mime + size + mtime header | Tiny files where content alone is too short to embed usefully. |
| `metadata+content` | Metadata header THEN truncated content | Recommended new default; metadata stays even when content gets truncated. |
| `tags+metadata+content` | User tags first, then metadata + content | When you've curated tags and want them to dominate similarity. |
| `sampled-stats+metadata` | Numeric summary (n, min, max, mean, std) + raw values + metadata for tiny numeric files; falls through to `metadata+content` otherwise | Sensor / measurement data (e.g. `data_subjectX_DayY.txt`). |

Active default lives in `app_settings.default_strategy` (single-row k/v). Flip via the Embedding Lab "Promote" flow, or directly:

```sh
sqlite3 ~/.starpalace/index.db "UPDATE app_settings SET value='metadata+content' WHERE key='default_strategy'"
```

New rows always record their strategy in `files.embedding_strategy`. Re-index re-embeds when `(content_hash, strategy)` differs.

## Index your own files

In the atlas, choose **Manage sources → Index folder**. In the classic workspace, press <kbd>i</kbd> to focus the Galaxy panel. Enter a folder path and an optional source name.

Or from the command line, while the daemon is running:

```sh
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

## Features

Per-feature spec lives in `REQUIREMENTS.md` (search by `F<N>` ID). Quick index:

| ID | Feature | Surface |
|---|---|---|
| F1 | Search pop + zoom-aware exposure | Search bar + camera animation |
| F2 | Auto star types (extension → type) | StarMap + Type pill |
| F3 | PC dial (top-8 components) | PCDial top-left |
| F4 | Manual reposition + pin | Shift-drag a star; DetailPanel unpin |
| F5 | Virtual collections (static + dynamic) | Collections sidebar (`c`) |
| F6 | Vim mode | Cheatsheet (`?`) |
| F8a/b | Procedural per-file graphics | Per-id sprite jitter, baked at draw time |
| F9 | Galaxies (multi-root indexing) | Galaxy panel |
| F10 | Usage-driven classification | StatsBar `Color by: Usage` |
| F11 | Theme selector | StatsBar Theme dropdown |
| F12 | Selection pulse animation | Selected star breathes |
| F14 | Reveal in OS file explorer | `O` (capital) |
| F15 | Reduced halo glow | Always-on |
| F16 | Galaxy visibility toggle | Galaxy panel hide/show |
| F17 | Live indexing progress (SSE) | Galaxy panel progress fill |
| F-NEXT-A..D | Crisp graphics rework | DPR-aware sprites, halo grading, per-theme background paint, vapor CRT |
| Themes | 5 themes, per-theme `dprCap`/`smoothing`/`flatLighting`/`postPass` | StatsBar Theme dropdown |
| B1 | Tags + embedding strategies + schema | DetailPanel chip list; `app_settings.default_strategy` |
| B2 | Experiment endpoints + subset PCA + snapshots | `POST /api/embedding/experiment` / `:promote` / `:revert` |
| B3 | Embedding Lab UI | `Shift+E` panel — preview / promote / revert |

## Performance

The renderer ships an interactive perf overlay. Press `Shift+P` to toggle.
Captured per frame: avg / p50 / p99 / worst ms, FPS, dropped frames (>33 ms),
rAF-skipped count, **interacting-only** subset (mouse drag / vim pan / pin
drag / wheel within 200 ms), and the visible-star count from the most
recent draw. `reset` clears the buffer; `copy` puts a plain-text summary
on the clipboard and dumps to console.

LOD policy (always on):

- **Same sprite at every zoom.** The cheap-LOD swap was retired so per-theme
  aesthetics stay recognisable when zoomed out (the prior fallback hid the
  procedural detail entirely). Sprites bake at the effective DPR (cache key
  includes the DPR bucket) so the bitmap matches the device pixel grid.
- Pulsar / quasar beam overlay skips below 4 px on-screen (sub-perceivable).
- Backing-store DPR caps at the active theme's `dprCap` (or native if none).
  Atari sets `dprCap: 1.0` so the 8-bit aesthetic reads chunky by default;
  JWST / Vapor / Lost / Bio leave it uncapped for crisp high-DPI rendering.
- The global `Low / Med / High / Ultra` quality dropdown was retired —
  themes own resolution + smoothing + lighting via the Theme contract.

Focused stars (selected / hovered / neighbor / search hit) get a tinted
ring (decoration pass) so the file you're acting on never gets visually
lost. `repo-state.md` has the full implementation index (spatial grid,
dirty-flag rAF, sprite cache, position-delta refetch, idle prebuild,
frame metrics).

## Development

```sh
npm run typecheck     # tsc strict check (daemon + renderer)
npm run lint          # eslint --max-warnings 0
npm run test          # vitest run
npm run test:watch    # vitest watch mode
```

`npm install` runs the `prepare` script, which copies
`scripts/git-hooks/pre-commit` into `.git/hooks/`. The hook then runs
the three gates above before every commit. Re-run
`bash scripts/install-git-hooks.sh` if you ever need to reinstall it
manually.

### Graphics test bed

Spin up a throwaway DB with one cluster per star type and side-by-side
the renderer with the original pitch deck:

```sh
bash scripts/dev-audit.sh                # builds audit-corpus/, seeds an isolated daemon
npm run dev:web                          # renderer talks to the audit daemon on :7373
( cd docs && python3 -m http.server 8181 )   # serves the deck reference
# → open http://localhost:8181/three-new-themes/index.html
# → open http://localhost:5173/
```

Full guide: [`docs/graphics-test-bed.md`](docs/graphics-test-bed.md).
Validation: `tests/graphics/auditCorpus.test.ts`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `STARPALACE_DB` | `~/.starpalace/index.db` | SQLite path |
| `STARPALACE_DIR` | `~/.starpalace/` | Data directory (HNSW bin, mapping JSON) |

Daemon and Ollama ports are constants in `src/shared/types.ts`
(`DAEMON_PORT = 7373`, `OLLAMA_PORT = 11434`). Change them there if
you need a non-default port.

## Future work

See `REQUIREMENTS.md` §Future work for:
- 3D projection mode
- WebGL/shader rendering (bloom, twinkle, parallax)
- Drift detection + background re-fit
- Louvain clustering
- Electron desktop wrapper
