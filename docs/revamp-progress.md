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

## Stellar calligraphy reference

The user rejected all ten logo studies and supplied a new calligraphic 宫 made of glowing stars. Their revised image is saved unchanged at `docs/design/palace-stellar-calligraphy-reference.jpg`. `docs/design/README.md` records the new brand direction and proposed website background; `docs/future-features.md` records the explicit request for bright, glowing atlas icons in this aesthetic. These notes supersede the earlier logo exploration; no new logo or atlas rendering has been deployed.

## September 5: parallel browsing features and visual proposals

The user authorized parallel implementation/design work, then explicitly allowed rethinking the file-type/object mapping. Three independent workstreams produced folder constellations, broader native Vim browsing, and reviewable stellar visual languages. Integration retained the original production star artwork while the user reviews semantics.

- Folder lines use a complete-folder, sparse derived graph, cached until membership or geometry changes. The renderer adds faint bounded connections behind stars, with all/selected-folder/off controls and continuous visibility fades. No source files or atlas positions move. See `docs/folder-constellations.md` for graph costs and limits; illustrated zodiac figures remain for visual review.
- Vim browsing adds counts, contextual motions, forward/backward search, file-range selection and collection handoff, copying paths, session marks and jump history, reader scrolling, pane focus, and command help. Native typing and control activation remain intact. `gg` now means first file/top; `zf` fits the map; `?` searches backward; `:help` or F1 opens the reference. This is bounded browsing support, not complete Vim emulation; `docs/vim-browsing.md` lists supported and omitted semantics.
- `docs/design/stellar-atlas-study.html` compares size-led stars, file-family colors, and clouds/landmarks using identical fictional data and positions. It includes a pulsar/giant comparison, glow and size controls, zoom, and close-ups. `stellar-semantics.md` records the proposals and recommendation. Similarity memberships in the study are fictional; no image-similarity detection has been implemented.
- `docs/design/stellar-brand/index.html` explores the supplied calligraphy as a website hero background and an editable simplified logo. Desktop/mobile and treatment controls were inspected; the public website remains unchanged pending selection.
- Validation: typecheck/lint, 426 passing unit/integration tests (3 historical skips), all 20 Chrome browser tests including existing zoom/hover/idle/reader regressions, and the renderer production build. The first sandboxed HTTP-test run could not bind its local server; the permitted rerun passed. New visual prototypes were exercised at desktop/mobile sizes with no browser errors. These checks are not new foreground frame-rate measurements.

## Clouds and favorite landmarks: review refinement

The user selected Clouds & landmarks, supplied a quieter star-cluster palette, and requested smaller typical stars with more size variation. The visual study now opens in that direction with pale colors, restrained halos, and a bounded curved byte-size scale. The user then assigned special silhouettes to explicit favorites: three demo files start as pulsars, with a black-hole appearance option and a favorite/unfavorite toggle in the detail view. Size alone no longer creates special objects. The new reference is saved under `docs/design/`; the favorite request and distinction from positional pins are recorded in `docs/future-features.md`.

Browser checks verified the default direction, three initial favorites, favorite toggling and black-hole appearance, unchanged positions/bytes, reset behavior, and a 390-pixel layout without overflow or page errors. Favorite state is currently an in-memory prototype interaction; no production artwork or favorite persistence changed.

The subsequent minor color pass retains the approved pale majority and adds a bounded Lorentzian-inspired tail of moderately richer red/blue tints to a few larger ordinary stars (13 of 650 sample files). Similarity haze now has faint blue, rose, and amber color. Favorite counts, size distribution, and file positions are unchanged; the prototype's existing bounded sprite cache remains in use.

## September 5: canonical stellar language in the app and website

The parallel work is consolidated on `feat/atlas-revamp`. The default atlas and public site now share the approved Clouds & landmarks palette: near-black backgrounds, mostly small pale stars, bounded byte-size magnitude, sparse richer red/blue outliers, and deterministic close-up details. Explicit favorites alone become pulsars or black holes. Favorite metadata survives reindexing and remains independent of pins and preserved classic classifications.

Folder constellation lines are included. Separate colored nebulae use duplicate content or strong indexed semantic links; they never infer similarity merely from folder membership or move files. Their recoverable cache invalidates on evidence/geometry changes, with a separate summary epoch so edge-only updates reach the UI. Zodiac figures and image-specific similarity detection remain deferred.

The website uses the supplied calligraphy once as decorative background shading at **10% opacity**, plus a simplified editable vector mark. Its fictional illustration uses the same renderer rules as the app. Installation instructions target the actual atlas branch, explain Mac prerequisites, and cover adding the first folder and subsequent launches. The site still offers source installation; a signed downloadable Mac application is not available.

Validation so far: 441 unit/integration checks passed (3 historical skips), typecheck/lint, renderer/site builds, 23 app browser checks, and 7 website browser checks. The initial concurrent browser runs exposed shared Playwright artifact deletion; separate output directories fixed that test-runner issue. Final clean-install acceptance and any resulting first-run fix are recorded below.

Foreground production navigation was checked on the 1,748-file isolated library, with visible Chrome at 1500×1000 CSS pixels and DPR2. GPU frame p95 was 17.6ms / draw p95 1.8ms; Canvas frame p95 was 17.6ms / draw p95 1.4ms. Neither recorded a long task during the sampled navigation. These are measurements on this Mac, not work-laptop guarantees or a 100k-file frame-rate claim. Local results/screenshots remain ignored under `.atlas-real/`; no real-library data is included in the website.

Rollback: the previous pushed checkpoint is `37ee334`. Keep the original checkout and historical worktrees intact. Revert the new focused commits on the atlas branch if needed; do not reset the user's original checkout or database.

Final source-install acceptance passed from a clean anonymous HTTPS clone plus the pending release files, with freshly installed dependencies on Apple silicon / Node 22 / installed Xcode tools. First-folder submission (including spaces in the path), indexing, extracted-text search, Reader preview, and Control-C shutdown passed both with a model and with its endpoint unavailable (zero embeddings). The actual empty-library test caught and fixed a canvas stacking bug that blocked the first-folder button. The additional onboarding browser regression passed. Full environment, reproduction commands, and dependency-audit limitations are recorded in [source-install-validation.md](source-install-validation.md). `STARPALACE_OLLAMA_URL` now permits testing/configuring the optional local model endpoint without affecting its default.

## Public branch promotion

At the user's request, the tested atlas is promoted to public `main`, with the previous remote main preserved as `legacy/pre-atlas-main-2026-09-05`. Website deployment follows `main` only and normal clone instructions obtain the atlas by default. Promotion is a fast-forward, preserving history. The original local checkout, its local `main` ref, and its uncommitted files remain untouched; development continues in the atlas worktree.

## September 5: atlas space, responsive gestures, and external editing

The library starts collapsed and the reader takes no space until a file is selected or the preview is opened. Library, preview, and search results have explicit controls; collapsing retains selection, camera, and (for results) the query/highlights. Library preference persists, while reloading starts with the preview closed. Mobile panels remain dismissible overlays. Website source instructions now include **Library → Manage sources**.

A high-frequency input regression reproduced the zoom complaint: the first frame showed no movement because each wheel event restarted a 140ms easing animation. Wheel gestures now update the pointer-anchored camera directly and draw once per animation frame; zoom buttons retain animation. The regression checks next-frame response, exact input accumulation, anchor stability, and absence of catch-up motion after input ends. Hit targets reuse cached stellar appearances instead of computing new palette/size records every frame.

**Space e**, **:edit**, and **Edit in Vim** open the selected local text/Markdown file in Terminal, preferring Neovim then Vim. The daemon accepts only an indexed file ID and constructs literal editor arguments, with supported-file and readable-regular-file checks. Automated safety tests use fake editors and stubbed launch routes, never the user's original files. See [Vim browsing](vim-browsing.md) for macOS automation and reindexing details.

Folder paths were already indexed. The search fix refreshes an unchanged query when indexing advances, preserving displayed hits and avoiding repeated model requests. Source/region/neighborhood labels now also match their members; label-only hits explain why they matched. Scope filters remain in force, with a visible geographic scope and an all-regions recovery action. No schema rebuild or position changes were needed. See [search behavior](search-behavior.md).

Validation: typecheck/lint, 448 passing unit/integration tests (3 historical skips), 32 app browser checks, seven website checks, and renderer/site builds. The onboarding fixture initially mocked only the empty summary while allowing populated viewport responses; the fixture now consistently models an empty library and its click regression passes.

Foreground production navigation on the isolated 1,748-file library (1500×1000 CSS pixels, DPR2, visible Chrome) measured frame p95 18.6ms for both renderers, draw p95 3.5ms GPU / 3.1ms Canvas, and no recorded long tasks. Both returned to the original camera with zero position error after the sampled zoom sequence. This was navigation on an existing library, not a concurrent-indexing benchmark or a guarantee for the work laptop. Results stay ignored in `.atlas-real/`.

Rollback baseline for this pass: `8466358`. The original local checkout and primary database remain untouched.

## September 5: text history, observing tools, updates, and screenshot tutorials

The selected release adds opt-in local Git history for indexed text/source files, wavelength lenses, immersive fullscreen, and a managed source-update button. The user then required in-app screenshot tutorials for every feature; 16 guides now cover the existing browsing workflows and these additions, with contextual links and `:tutorials` access.

Text history uses a separate bare archive beside the selected database. It captures settled UTF-8 saves up to 1 MiB, detects atomic editor replacements, refreshes lexical text, and preserves positions and authored metadata. Previous contents and unified diffs are available through a file's History; recovery creates a unique sibling copy. Capture is disabled until the user enables a source. A 512 MiB object-storage budget bounds archive growth; no versions are automatically pruned. Whole-sky rewind, retention controls, and rename identity remain future work. See [text-history.md](text-history.md).

The updater runs through `npm start`, validates the official origin and clean `main` ancestry, and coordinates fetching, shutdown, fast-forwarding, dependency installation when needed, builds, and restart. It preserves prior dependencies for guarded recovery after a failed install/build and refuses to overwrite recovery files from an interrupted update. The UI reconnects even if Settings closes. The real IPC request was checked on the development worktree: it correctly refused the branch before any fetch or checkout mutation. Successful install/build and failure recovery were tested against disposable Git repositories with fixture dependencies. No live remote release was automatically installed into the user's checkout. See [app-updates.md](app-updates.md).

Lenses preserve coordinates and selection, using matching summary/hydrated metadata and the existing bounded sprite caches. Fullscreen restores the prior workspace and offers search as an overlay. Browser checks caught and fixed a narrow-screen overlap between fullscreen and the preview close control, and ensured focused map controls pan with Vim motions even when search remains active. Tutorial code uses distinct module basenames to avoid a case-insensitive Mac resolution collision. See [observing-and-tutorials.md](observing-and-tutorials.md).

Validation: typecheck and lint; 463 passing unit/integration tests with 3 historical skips; the complete 37-test browser run passed after the interaction fixes, and the added reconnect-after-closing-Settings check passed separately (38 browser checks covered). Every one of the 16 tutorial screenshots loaded in the browser. Renderer, daemon, and website production builds passed. These are correctness checks, not new foreground frame-rate or concurrent-indexing performance measurements.

All new capture, update, and screenshot validation used disposable repositories or `.atlas-dev/features`, a separate fictional 124-file library served on ports 7378/5178. Screenshot generation checks the source roots and replaces displayed demo paths with fictional paths. The user's primary database and original checkout remain untouched.

Rollback baseline: `19cf3fe`. Revert the release commits to remove these controls. Preserve any `text-history.git` archive when rolling back so recorded file versions are not lost; the additional opt-in SQLite table can remain unused.

The first commit hook exposed inherited Git routing variables in the disposable update tests: they redirected fixture commits to the atlas ref and changed the shared bare flag. No remote push occurred. Working files were preserved, the accidental commits were retained locally on `recovery/hook-fixtures-20260905`, and the atlas ref/index and shared bare flag were restored to their verified pre-release state. The original checkout’s status matched its initial pre-existing edits after repair. The process helper now removes inherited Git repository/index/config-routing variables, and a regression verifies both ordinary and bare child repositories leave their caller unchanged. Fixture tests also assert their disposable top-level before running any add/commit/reset.

## Persistent cluster headings

The user requested small, persistent nebula/region names after another distracting label episode. The old headings cross-faded between parent and child levels and competed with file captions. The map now labels each leaf cluster consistently (using a region itself only when it has no children). Type grows continuously from 10px at distant overview toward a 14px ceiling. Removed the secondary file-count/Explore line. Cluster names retain constant opacity, bypass the caption collision budget, and remain anchored as their text clips naturally at the viewport edge; file captions retain collision handling. Extremely compressed clusters may have overlapping names rather than alternating visibility.

Validation: 465 unit/integration tests passed, typecheck/lint and renderer build passed. The 15 existing atlas browser checks passed, and the added persistent-heading zoom regression passed separately after correcting synthetic WheelEvent pixel rounding in its pointer tracking. Updated the navigation tutorial text and six map screenshots using the isolated fictional library. No layout or data changes. Rollback baseline: `5b43739`.

## Wavelength tint correction

The user expected Ultraviolet and Infrared to look violet and red. Replaced the shared blue/ivory/gold transfer rules with violet/lavender age bands and red/orange/amber size bands, including dim colors for unavailable metadata. Favorites previously ignored overview lens colors; the fixed sprite sheet now contains all eight lens colors for ordinary stars, pulsars, and black holes. Close-ups share those colors. The existing sheet dimensions and detail-cache budgets remain unchanged. Visible and Radio retain their prior appearance and meaning.

Updated the in-app legend, guide, screenshot, and observing documentation. Validation: 467 unit/integration tests passed, typecheck/lint, renderer/site builds, camera/constellation preservation, and pixel-color assertions for both renderers at overview and close-up across all three silhouettes (24 combinations). The camera test now waits for initial library fit before comparing lens switches. Rollback baseline: `9ee5313`.

## Markdown solar systems

The user approved Contents and requested implementation. Markdown previews now open a local solar system with substantial sections as seeded planets and nested headings as moons. Clicking a planet or moon opens the reader at its source heading; the sun opens the full document. Back to solar system retains selection, page, pause state, and orbital time within the reader session. Slow motion pauses during pointing/planet keyboard focus and honors reduced motion. The atlas remains mounted with its camera and persistent file positions intact.

The approved shader supplies six surface families, with one bounded context, twelve thumbnails per page generated at most two per frame, and a single 448px inspected surface. A Canvas fallback provides static seeded surfaces. Parsing uses the reader's existing CommonMark dependencies, now declared directly. Source-line anchors disambiguate repeated titles and handle Setext/CRLF; code and quoted headings are not planets. Appearance matching uses a bounded browser-local derived cache; its sixteen-document retention, ambiguous edits, and file-rename limitations are explicit in [document-systems.md](document-systems.md).

Section editing validates a numeric line, source line, and current preview SHA-256 before launching the original in Neovim/Vim. Space e and :edit honor the active reader section. Model-free Refresh document updates metadata and lexical text without embedding or moving files. Source originals are changed only in the user's external editor; text-history capture remains separately opt-in.

Validation: typecheck/lint, 474 unit/integration tests (3 historical skips), renderer and daemon builds. All 45 browser checks passed across the final suite and one targeted rerun: the delayed-viewport zoom check initially hit a local `route.fetch` ECONNRESET, then passed against the restarted isolated preview. New coverage includes exact duplicate-heading navigation, moons, line-edit payloads and shortcuts, stale edits, refresh identity, slow/pause behavior, heading-free files, pagination, narrow windows, and no-WebGL fallback. The actual isolated backend returned 200 for text refresh with place/favorite metadata preserved and 409 for a deliberately stale editor request; no terminal was launched. Tutorial 17 and the updated reader screenshot use only the guarded fictional library.

Rollback baseline: `189a127`. Revert the two release commits to remove the feature; no schema migration or primary-library experiment was performed. Budgets above are implementation bounds, not new foreground performance measurements.
