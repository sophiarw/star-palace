# Future ideas

This backlog distinguishes approved feature requests from historical design exploration. Approval to record a request does not mean it is implemented or scheduled.

## Current release scope

The user selected a first text-only Git history slice (FR-08), wavelength lenses (FR-11), the Update button (FR-07), and fullscreen (FR-06), then required screenshot tutorials accessible inside the app. These are now implemented in this worktree; validation and release checkpoints are recorded in `revamp-progress.md`. Text history is opt-in, covers indexed UTF-8 text/source files up to 1 MiB, and offers content/diff viewing and copy recovery. Full-sky rewind, named milestones, retention UI, and identity-preserving moves remain future work. See [text history](text-history.md), [updates](app-updates.md), and [observing/tutorials](observing-and-tutorials.md) for exact limits.

### FR-12: In-app screenshot tutorials

Every feature needs a concise tutorial accessible within the app, with screenshots. The initial implementation includes 16 guides covering existing browsing operations and the new release, with contextual links for the new controls. Use fictional data for all screenshots and update the guide whenever its UI changes.

## September 5: daily use and distribution requests

The user approved the first six requests below for the backlog, then added an Update button as a seventh. Implementation remains future work; the current task is documentation and discussion of larger product directions.

### FR-01: A living library

Automatically refresh indexed metadata and searchable text after external edits, including saves from Vim/Neovim. Catch up on changes made while Star Palace was closed. Follow with identity-preserving renames and moves so positions, favorites, tags, pins, and collection membership survive.

Current limitation: refresh requires reindexing and file IDs are path-derived. Implement incremental refresh first, then carefully establish move/rename identity. Matching content alone must not merge distinct duplicate files. Validate atomic editor saves, offline changes, ambiguous moves, and metadata preservation with isolated fixtures; ordinary refresh must not rearrange the atlas.

### FR-02: Places in search

Return folders, sources, and collections as navigable search results alongside documents. For example, searching “Incoming” offers “Incoming — folder, 37 files”; selecting it visits that place and supports browsing its members and revealing the folder in Finder.

Folder paths and atlas labels already match member files. This request adds place destinations, with clear result types, paths to distinguish identically named folders, predictable keyboard navigation, and scope-aware counts. Typing a query must not move the camera; explicit navigation should preserve a way back.

### FR-03: Personal constellations

Build on existing collections with optional recognizable figures or emblems, a short description, and a designated starting document. A writing project might have a fox illustration; travel documents might have a ship.

Extend the deferred illustrated-constellation idea below to authored collections while keeping folders, collections, and content similarity distinct. Illustrations and faint connecting lines follow existing file coordinates and appear gently on focus. Start with a visual prototype for review; preserve individual file access, readable labels, and bounded rendering costs.

### FR-04: Quiet indexing

Support pause/resume and durable progress across app restarts. Distinguish files discovered, searchable, and processed for similarity so the user can understand readiness without needing implementation details. Keep active browsing, reading, and search responsive during ingestion.

Measure foreground interaction while indexing roughly 2,000 representative files, including operation without an embedding model. Existing navigation measurements on an already indexed library do not establish concurrent-indexing performance. Preserve the current bounded extraction and early metadata availability; this extends the indexing workflow rather than replacing those capabilities.

### FR-05: A Mac application

Provide a downloadable Mac app: drag into Applications, choose folders, and browse. Manage the daemon lifecycle within the app and offer an optional system-wide quick-search shortcut that returns to the existing atlas.

Continue the investigation in [Mac distribution](mac-distribution.md), including signing/notarization, first-run behavior, upgrades, shutdown, and preservation of existing libraries. Current distribution remains source installation; no signed installer is available. Scope is macOS only.

### FR-06: Atlas fullscreen

Add an expand control that hides the toolbar and panels so the galaxy fills the app window. Search remains available on demand as an overlay. Escape exits this mode and restores the prior panel layout, camera, selection, and focus. Support `:fullscreen` through the native Vim command system.

Distinguish the app's immersive atlas mode from operating-system/browser fullscreen during implementation. Handle nested overlays predictably: Escape dismisses the active overlay before leaving the immersive atlas. Ordinary typing and existing keyboard navigation must continue to work; entering or leaving fullscreen must not fit or reset the map.

### FR-07: Update button

Provide an in-app Update action that pulls the current published version from the project's repository automatically, without requiring Terminal commands. For source installations, check the configured official release branch, fetch and fast-forward safely, install changed dependencies when needed, and coordinate rebuilding/restarting with a clear progress and completion state.

Preserve the library and local checkout changes. Never discard edits, reset divergent branches, or silently switch a development worktree to the release branch. Explain conflicts and failed/offline updates with an actionable status, preserve a recovery path, and ensure interrupted updates do not leave the app claiming success. Coordinate restart with active indexing. Keep repository operations in the local launcher/daemon, outside the renderer. The later packaged Mac app should offer the same user-facing action through an appropriate application updater rather than requiring a Git checkout.

Suggested sequencing from the proposal: place destinations first, then automatic refresh and indexing responsiveness, an illustrated-constellation prototype for visual review, and the Mac app as a larger release. Fullscreen fits the current work on collapsible panels; the Update action improves the existing source-install experience. This is a suggested order, not a delivery commitment.

## September 5: astronomy-led exploration and history

The user prefers starting with interesting astronomical phenomena and finding useful memory-palace meanings for them. They welcomed solar-system document interiors, binary relationships, wavelength lenses, and personal asterisms; comets were considered fun but not useful enough to pursue. They explicitly requested recording the astronomical clock/version-history concept. These requests are not implemented. The user also wants a deliberately small next feature scope.

### FR-08: An astronomical clock and local version history

Explore a sky that evolves slowly and can be rewound. A time control reconstructs the library as recorded at an earlier date: files arriving, document versions changing, and authored relationships or constellations developing. Past states remain browsable and historical content can be compared with the present.

Keep observation and restoration distinct operations. Moving the clock does not write to original files. Offer explicit per-file restoration as a copy, or replacement with the current version preserved first. Begin history when capture is enabled; never imply that old bytes are recoverable from modification timestamps or metadata alone.

Use Git for the first content-history implementation, in a separate local archive, with a change history for stable file identities, names, memberships, and map state. The user narrowed the feature to **text documents and source files only**, explicitly naming `.md`, `.txt`, and `.py`; Git-backed text history is the selected scope. This is not a request to initialize all source folders as repositories. Preserve existing repositories and original directory structures. Current atlas snapshots contain positions and regions only; they do not reconstruct past libraries or preserve file contents.

Capture settled saves, coalesce edit bursts into useful checkpoints, and support named milestones. Enable content history per folder with visible storage use and retention controls; protect explicit milestones from ordinary retention pruning. Include Markdown, plain text, and common textual source/config formats, validating actual text content as well as names; define bounded size/encoding eligibility and explain skipped files. Exclude images, video, PDF/DOCX containers, archives, and other binary contents from this feature. Distinguish historical metadata from retained content, and define recoverable behavior for missing originals and interrupted captures. A local archive is not an independent-device backup.

First useful slice: **rewind one constellation**. Enable history on a writing or source folder, capture subsequent text edits, explore an earlier state, compare versions, and recover a passage or a draft. Stable identity and reliable incremental refresh from FR-01 are prerequisites for complete historical reconstruction. The first text-history slice must explicitly describe any move/rename limitations rather than claiming complete reconstruction. Whole-library rollback remains deferred; binary/media version storage is outside the selected scope.

The user likes extremely slow galaxy evolution and moving orbits. Explore deterministic clock-driven motion so revisiting a recorded date yields reproducible positions. Any galaxy-wide drift would explicitly revise today's fixed-position contract and needs a bounded, opt-in visual design review; recording this request does not authorize changing ordinary indexing layout. Keep restoration of map state distinct from restoration of file contents.

### FR-09: Solar-system document interiors

Enter a document's star deliberately to explore a local solar system: sections as planets, with subsections or annotations as moons. Start with reliable Markdown headings and links back to exact passages; preserve the return location in the outer atlas.

The user explicitly prefers **very slow moving orbits**, somewhat sped up from real planetary timescales, over frozen planets. Explore deterministic per-document planets with gently evolving, wavy procedural atmospheres or cloud bands. Orbital tracks and recognizable planet appearances provide continuity while positions change. Support pause/reduced motion and reliable keyboard/pointing selection; camera follow is a design option for an inspected planet. Generate detail only for the active system with bounded graphics work. Prototype visual appeal and navigation usefulness before extending to complex document formats.

### FR-10: Binary stars and stellar families

Give explicitly related files a paired or family appearance: paper/supplement, original/edited image, manuscript/translation. Users can establish the relationship or accept an evidence-backed suggestion. Distinguish authored pairing from generic content similarity, duplicate detection, favorites, and folder membership. Explore connecting or shared-halo treatments at existing atlas positions before considering any motion or relocation.

### FR-11: Wavelength lenses

Use astronomical observing modes as the visual language for filters. Show different information in the same familiar sky: folder relationships, content similarity, recent changes, or file size. Preserve camera and coordinates when switching; clearly identify the active lens and provide a simple return to the canonical sky.

Start with a small set based on existing data, with a compact control and legible meaning. Preserve explicit favorite silhouettes, selection cues, searchable access to every file, and bounded rendering work. Recent-change coloring must describe the available timestamp's meaning, not imply a recorded version history before FR-08 exists. Additional lenses need a concrete browsing use rather than merely adding decoration.

### FR-03 extension: Personal asterisms and sky lore

The user particularly liked drawing and naming sparse connections among arbitrary files, including across folders, with a short explanation: “The three papers that changed my mind.” Asterisms can overlap, and are user-authored associations rather than inferred similarity. Build on collections and the existing faint-line language, preserving positions and individual access. Illustrations remain optional later work; a named figure and a sentence can provide the core utility.

### Proposed small next scope

Updated recommendation after the user's text-only Git decision: a bounded FR-08 text-history slice for daily usefulness, supported by the incremental change capture it requires, and a compact first set of FR-11 wavelength lenses for astronomy-led exploration. FR-06 fullscreen is a small companion. The user's decision selects the text/Git scope; this proposed combination is still for discussion. Keep full historical-sky reconstruction, durable indexing pause/resume, rename identity, solar-system interiors, and broader distribution work separately scoped rather than bundling the entire backlog into one release. Solar systems merit the next visual prototype; the full astronomical clock follows reliable refresh and identity.

## September 5 implementation and design pass

The user authorized parallel work and selected Clouds & landmarks. Native Vim browsing, folder connections, canonical stellar artwork, persistent favorites, and evidence-led nebulae are now integrated into the atlas branch. Zodiac illustrations and image-specific similarity detection remain deferred. The original requests below are retained as design history.

The user explicitly reopened the old file-type/object mapping: ordinary files might be main-sequence stars, exceptionally large files might become pulsars, and unusually similar groups (such as image series) might read as nebulae. Compare alternative systems instead of treating the old mapping as a requirement for the new design. Folder membership and content similarity are separate relationships. Preserve stable positions and access to every individual file in all proposals.

The deferral notes below describe the original request context; this later authorization supersedes them for the current pass. Zodiac-like figure artwork and the final brand treatment still need visual review.

### Visual review decision: clouds and favorite landmarks

The user selected **Clouds & landmarks**. Use the [new star-cluster reference](design/stellar-cluster-palette-reference.png) for quieter ivory/warm-white/gold/pale-blue colors, mostly smaller stars, and a few larger outliers. This supersedes the original saturated atlas palette request below; the calligraphy still informs the brand.

Further refinement: retain a wider, Lorentzian-like distribution of saturation, with a few moderately richer red/blue larger stars amid the pale majority. Nebulae connecting similar groups can carry a little more color. These are restrained exceptions; the user approved the general visual language and requested only a small adjustment.

Reserve pulsars, black holes, and similar special silhouettes for **user-marked favorite files** rather than automatically assigning many of them by file type or size. Provide a favorite/unfavorite toggle. Keep favorite state separate from positional pins, byte-size magnitude, and similarity grouping; persist it through re-indexing and preserve manual metadata. The review starts with only three favorites among 650 files. More files must not create more favorites automatically. The [visual study](design/stellar-atlas-study.html) demonstrates the toggle and pulsar/black-hole appearance choice; [production favorite persistence](favorites.md) is now implemented.

## Bright, glowing celestial icons

Requested September 5, 2026. The user explicitly wants the main atlas file icons to adopt the aesthetic of their [revised stellar-calligraphy image](design/palace-stellar-calligraphy-reference.jpg): bright, saturated celestial colors surrounded by glow, with luminous cores and softer halos. The blue, white, yellow, orange, and red stars in this reference are the visual target.

Apply that rendering language to the atlas's existing celestial objects, preserving distinct file-type identities (nebulae, pulsars, main-sequence stars, and others), intermixed placement, and deterministic per-file variation. The reference's calligraphic character is for the brand; the atlas objects should retain their own silhouettes.

Make the color and glow legible at ordinary browsing zoom, building on the improved icon screen sizes. Preserve readable labels, smooth zoom, and stable file positions. Keep sprite generation and caching bounded; assess foreground performance and visual clarity with a dense library before shipping the new treatment.

This is a deferred feature request, not an atlas rendering change in the current task. The related website-background and stylized-logo ideas are recorded in [the design notes](design/README.md).

## Folder constellations and illustrated figures

Requested September 5, 2026.

Lean into the constellation metaphor: connect files within the same folder with little, subtle lines so the folder reads as a constellation. Add optional zodiac-like illustrations over those constellations, giving each group a recognizable visual figure.

Preserve the existing organic file layout and stable memory-palace positions. The lines and illustrations should follow the files rather than rearrange them into preset pictures. File types remain intermixed and retain their individual celestial identities.

Questions for a future design pass:

- Direct parent folders versus nested folder groups, and how to handle very large folders without a web of lines.
- Reveal on hover, selection, or at certain zoom levels; a simple visibility control.
- Deterministic per-folder illustration selection/generation so a constellation keeps its identity.
- Low-contrast artwork beneath labels and file objects, with bounded generation/rendering costs.
- How the illustrations relate to user-created collections, without conflating them with folders.

The user explicitly deferred this feature. Do not implement it as part of the website or Mac distribution work.

## Stellar classes as a visual language for file size

Requested September 5, 2026, with a Hertzsprung–Russell diagram showing the main sequence, white dwarfs, subgiants, giants, bright giants, and supergiants as visual inspiration.

The range of stellar appearances offers a strong visual vocabulary for file size. Explore representing file sizes through stellar scale, luminosity, color, and/or class, so differences in file size can be recognized visually.

This is a design exploration, not a scientific assertion that stellar diameter, luminosity, temperature, and mass are interchangeable. Decide which visual property maps to file bytes and make that meaning legible in the object guide.

Preserve the user's preferred mixed celestial file-type identities unless a future review explicitly changes that decision. Explore a secondary size/brightness treatment within each file-type identity, or an optional “Color/classify by size” mode, before replacing type-based objects.

Use a logarithmic or bounded scale so a huge archive cannot cover its neighbors and a tiny note remains readable and selectable. Respect the recently improved screen-size curve: users should not have to zoom excessively to see object details. Consider interaction with manual classifications and the existing usage-based classification mode.

Deferred for a future feature pass; no file-size classification or artwork changes are part of the current website work.

## Comprehensive Vim-style browsing

Requested September 5, 2026. The user wants approximately the full Vim command vocabulary supported as native browsing, wherever a meaningful equivalent exists. A Vim user should be able to try familiar keystrokes and get recognizable, interpretable behavior.

Before implementation, audit the Vim command suite and the operations people perform in Star Palace. Produce an explicit mapping, including contexts and conflicts, rather than adding isolated shortcuts.

Areas to cover in that future audit:

- Motions, word/line/document boundaries, screen positions, paging, and numeric counts.
- Search initiation, forward/backward search, next/previous matches, and return to the prior location.
- Normal, insert, and visual-selection behavior where those concepts fit file browsing.
- Multi-key sequences, repeat behavior, marks, jumps, and navigation history.
- Selections, collections, pins, file actions, and reader/map focus or pane navigation.
- Consistent behavior across the map, list/grid views, search results, and document readers, with explicit context-sensitive differences.
- An audit of existing shortcuts such as `h j k l`, `g g`, `n/N`, `o/O`, and Escape; preserve useful behavior or document intentional remapping.
- Ordinary typing in text inputs and native text selection must continue to work. Commands with editing/destructive meanings in Vim need deliberate browsing equivalents, not accidental changes to original files.
- A discoverable command reference and a coherent answer for commands that have no sensible browsing equivalent.

The user explicitly deferred this work. Record and design the mapping in a future feature pass; do not implement Vim behavior during the website/logo work.
