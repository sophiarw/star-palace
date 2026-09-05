# Atlas revamp — implementation log

Branch: `feat/atlas-revamp` · worktree: `worktrees/atlas-revamp`

The original checkout and its pre-existing source edits are preserved. Runtime work used generated fixtures in `.atlas-dev/` and `.atlas-benchmark/`, plus a SQLite backup in `.atlas-real/`. The primary library was never migrated.

## Delivered

- Agent reading map and isolated Git baseline (`2111795`).
- Persistent atlas, search, redesigned shell and reader (`94002be`).
- Metadata-first insertion; shared bounded extraction; trigram filename/path lookup and passage search; off-thread PCA with stale-result rejection (`ca08c96`).
- Complete file coverage, stable source/folder/semantic neighborhoods, world pins, renamed regions, reversible snapshots, saved camera positions, and Back/Forward navigation.
- GPU default with Canvas fallback, bounded scene/labels, mixed celestial file types, an object guide, smooth close-up zoom, and deterministic per-file artwork in a fixed-size cache.
- Map/list/grid browsing, keyboard search, matching-passage navigation, Markdown/code/data/image/PDF readers, source management, collections, tags, and manual classifications. The classic advanced workspace remains available.
- Integrity/HTTP/browser tests, real-library migration audit, foreground GPU/Canvas comparisons at 10k/50k/100k, and documented performance limits.

See [validation results](atlas-validation.md) for measured numbers and the remaining limits of the measurements. The user approved the live visual direction and explicitly asked to retain celestial identities, intermix file types, and restore procedural close-up exploration; those refinements are implemented.

## Run the review build

From the worktree, run `npm run seed:atlas`, `npm run dev:atlas:daemon`, and in another terminal `npm run dev:atlas:web`. Open `http://127.0.0.1:5174`. The generated demo contains 124 files and demonstrates manual celestial classifications as well as automatic file-type mapping.

## Real-library review

A separate local preview at `http://127.0.0.1:5176` uses daemon port `7376` and a fresh SQLite backup under `.atlas-real/preview-20260904-213353/`. All 1,748 indexed files were verified to exist. The original database is opened read-only for the backup; the new daemon reads and writes only the copy. Source files remain at their existing paths. Changes to tags, collections, and pins in this preview belong to the copy. Full-text extraction fills in the background. The generated demo remains on port `5174`.

To restart that preview from this worktree:

```sh
STARPALACE_DIR=.atlas-real/preview-20260904-213353 STARPALACE_PORT=7376 npm run dev:daemon
# In another terminal:
VITE_DAEMON_PORT=7376 npm run dev:web -- --port 5176 --host 127.0.0.1
```

## Evening review corrections

The initial real-library review exposed scope-switching zoom jumps, unstable headings, and an artificial arrangement. These are corrected together:

- One pointer-anchored camera with eased wheel/button zoom, spatial metadata hydration, and real persistent markers at every scale. No zoom-triggered navigation or late-response refitting.
- Retained label placement and opacity transitions; hover leaves heading pixels unchanged. Close-up artwork fades in, and an offscreen selection cannot pull button zoom away from the current view.
- Original projected structure restored for 1,135 files; 613 unprojected files are placed near graph/folder relationships. Of the projected files, 1,113 retain their exact scaled coordinates; 22 receive small local collision adjustments (maximum 31.2 units across a roughly 20,000-unit map). No duplicate positions. File records and the primary library are unchanged.
- The layout helper makes a whole-database backup and a snapshot. The real preview's snapshot 2 is the state before the organic arrangement; snapshot 1 is before the interim spiral arrangement. Restoring snapshots now restores full region geometry and natural coordinates as well as pins/names, and advances the layout epoch so stale cameras are not reused.

The real preview remains on port 5176, with its daemon on 7376. Both preview databases have the organic layout; ordinary indexing preserves existing positions. The map includes all 1,748 real file markers. Refresh and use **Your atlas** to see the full arrangement. Validation is recorded in [atlas-validation.md](atlas-validation.md).

## September 5: readable icon sizing

Celestial sprites now settle into a larger screen size at browsing distances, with slower growth as the camera continues inward. The distant overview keeps its existing density. Procedural details fade in between sprite radii of 25–42 CSS pixels, with the same 16-slot cache and two-generation-per-frame limit. GPU, Canvas, labels, and hit targets use the matching size curve. The real-library preview was inspected at zoom 0.5 in both renderers, and the six zoom/hover/fallback browser checks passed.

## September 5: website, licensing, and Mac distribution investigation

- Replaced the compass logo with the user's 宫 constellation mark across the header, hero, footer, favicon, and social card.
- Applied the user's editorial review: direct memory-palace headline, stargazing/Sharepoint description, concise headings, and celestial artwork in place of redundant prose cards.
- Added the static starpalace.ai site in `website/`, with an interactive fictional file galaxy, shared celestial artwork, four-step keyboard-accessible tutorial, source install instructions, social image, and an explicit GitHub issue draft form.
- The user made the GitHub repository public and renamed it to `sophiarw/star-palace`. Origin and public-facing links use the new name.
- Added `LICENSE`: PolyForm Noncommercial 1.0.0 plus permission for personal/internal workplace use. The user permits workplace use but prohibits selling or monetizing the software.
- Added GitHub Pages build/deployment automation and documented the account-side Pages/Squarespace configuration in `website/README.md`.
- Added `npm start` and `npm run start:demo`. Compiled daemon/PCA/text workers and source startup/shutdown were checked with temporary fixtures. A signed Mac executable is not yet available; findings and concrete remaining work are in `docs/mac-distribution.md`.
- Recorded two intentionally deferred ideas in `docs/future-features.md`: folder constellation lines with zodiac-like illustrations, and stellar visual classes as inspiration for file-size encoding.
- Validation: typecheck/lint, 412 passing unit/integration tests (3 historical skips), six website browser checks, renderer/site/daemon builds, and isolated runtime smoke checks. Desktop/mobile designs were visually inspected; no real files appear on the site.

## Rollback

The primary checkout on `main` still contains the original app and the user's pre-existing changes. It can be run independently. Do not reset or clean that checkout.

Within the new UI, `?view=classic` opens the preserved interface. Atlas/search tables are additive; original file metadata, vectors, PCA positions, and collections remain present. New atlas pins and snapshots are separate from legacy PCA pins. Atlas snapshot restoration creates a backup before applying saved positions/names and keeps files indexed after the snapshot.

Use `git log --oneline` in this worktree to review the implementation checkpoints. To undo a change on this branch, revert its commit. To inspect the pre-revamp baseline without changing this worktree, create another worktree at `2111795`. No implementation commits have been merged into `main`.

## Logo direction review and deferred keyboard work

The user rejected the first two logo treatments and requested ten diverse studies before choosing. Review artifacts live in `docs/design/`; the current interactive sheet includes the user's tapered/flared geometry as option 01, plus nine other treatments. The latest unapproved logo implementation has been reverted to the previously published assets while selection is pending.

The comprehensive Vim-style browsing request is recorded in `docs/future-features.md`, alongside the folder constellations and stellar file-size ideas. These remain future work.
