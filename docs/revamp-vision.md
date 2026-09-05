# Star Palace: a readable atlas of your files

Design and architecture brief · September 4, 2026

## Recommendation

Keep the persistent spatial library as the product. Rebuild the application shell and browsing experience, introduce a hierarchical layout, and evolve the existing daemon behind compatible interfaces. A complete rewrite of persistence, indexing, and every feature is not justified by the evidence so far.

The experience should be: **recognize a place, find a file, read it comfortably, and return to where you were.** The map should help all four actions. Its visual richness should reveal information as you approach it.

The companion [interactive concept](revamp-concept.html) illustrates the proposed visual hierarchy with fictional files. It is a design sketch, not an implementation or a performance demonstration.

## What the app does today

Star Palace indexes local folders, embeds file content through local Ollama, stores metadata and vectors in SQLite, builds a persistent HNSW similarity index and neighbor graph, and projects embeddings into a persistent two-dimensional map. Folder roots become galaxies. React manages the interface; Canvas2D draws the map; an Express daemon owns filesystem access and persistence.

The current functionality is substantial: multiple roots and visibility controls; indexing progress and cancellation; semantic and macOS Spotlight search; static and saved-query collections; tags; manual pins and classifications; related-file navigation; markdown, text, image, and PDF viewing; OS open/reveal; keyboard navigation; five visual themes; and an embedding lab with experiments, live mixing, promotion, snapshots, and reversion.

The key product promise in `REQUIREMENTS.md` is spatial memory: search navigates an existing map, and adding a file should not rearrange familiar places. Preserve that promise. Some earlier specifications describe unimplemented features or superseded constraints; this review treats executable code as the implementation reference.

## Evidence and limits of this review

Reviewed the current working tree at commit `00d2803`, including pre-existing uncommitted renderer changes, the architecture/specification documents, earlier search and graphics audits, and historical performance reports. Inspected aggregate counts in the default local SQLite index through a read-only connection; no file bodies were queried for that inspection.

The default database contains 1,748 files. This may differ from a database selected through `STARPALACE_DIR` in another session. Neither the renderer nor daemon was listening when inspected. This review did not run a foreground browser session, measure current frame times, or visually validate the existing app. Visual findings below derive from component/CSS inspection and are distinguished from historical measurements.

Baseline checks on the current working tree: typecheck, lint, and production web build pass; all 387 tests in the 35 default suites pass. The HTTP contract suite is excluded by the repository's default test configuration because of its documented native-module teardown crash; it was not run here. Passing these checks does not establish good usability or production performance.

## What most needs to change

| Finding | Evidence in current code/data | Consequence |
| --- | --- | --- |
| The cluster model barely subdivides the current library. | The default DB has two clusters; the largest contains 1,096 of 1,135 positioned files (96.6%). `src/daemon/layout/clustering.ts` uses connected components above a similarity threshold. | A chain of moderately similar files can join an enormous component. It cannot provide meaningful districts or progressive drill-down. |
| Many indexed files never reach the map. | 613 of 1,748 files have no coordinates, including all 591 media files. All embedded rows use `content-only`. `/api/map/all` includes only positioned files. | Indexing a file does not guarantee that the user can browse it. The app needs a useful place for files awaiting or lacking embeddings. |
| Duplicate spacing is lost in the normal display path. | 225 embedded files share vectors across 73 duplicate groups. Stored positions are distinct, but `usePcDial.scaledById` reconstructs positions from PCs without the daemon's deterministic positional jitter; `App.projectedStars` prefers those positions. | Identical vectors within a galaxy can occupy exactly the same displayed point. More decorative detail cannot make those files independently selectable. |
| Pinning can rescale unrelated files. | `usePcDial.ts` includes pin offsets in the min/max bounds used to normalize every point. | Moving one file far away compresses the rest of the map. This undermines the spatial-memory promise. |
| The UI offers little hierarchy between everyday and experimental controls. | The app mounts independent fixed panels for galaxies, collections, PCA axes, statistics, cheatsheet, detail, and experiments. The cheatsheet opens by default. | Controls consume map space and compete with browsing. Important actions are spread across corners and keyboard modes. |
| The reader is sized as an inspector. | `global.css` limits it to `min(520px, 40vw)`; preview text is mostly 11.5–13px. Classification, tags, and pin controls precede the document. | Reading takes place in the space left after metadata and controls. Long documents and tables need a proper reading surface. |
| Search interferes with text entry and lacks a results surface. | `SearchBar.tsx` intercepts `n`/`N` while the input is focused once hits exist. Enter hides the bar. Results become map highlights. | Users cannot reliably edit ordinary queries or scan filenames, paths, and supporting excerpts. |
| Async search can display stale results. | Debounced requests lack abort/sequence guards and timer cleanup; changing the mode alone does not rerun the query. Errors are swallowed. | An older request can overwrite a newer query or repopulate cleared highlights. The visible mode can disagree with the results. |
| Search coverage is tied to drawing eligibility. | Both search implementations discard unpositioned files. Semantic search retrieves a global top-K before `App` removes hidden galaxies. | A file can exist in the index but remain unfindable; hidden roots can consume the candidate budget. |
| Indexing and preview extraction are separate. | The walker reads non-media bytes; strategies decode them as UTF-8. PDF/DOCX extraction exists in the content-view endpoint. Embedding input is capped at 8 KiB; the walker skips files over 5 MiB. | A document that previews correctly is not necessarily indexed as meaningful text. Long documents lose later sections, and large files disappear from ingestion. |
| Layout and refresh ownership is fragmented. | The daemon stores positions, the renderer recomputes PC positions, and the embedding lab supplies overrides. The PC hook refreshes on mount/pin actions; layout polling updates a separate stars array. | Layout-version updates need a coherent revision contract so stale projection data cannot override newer coordinates. |

Earlier search audits describe several bugs already fixed in the current code, including query validation and collection-scoped semantic recall. Those are not being proposed as new discoveries.

## The product vision

### A map with useful scales

At the widest scale, show named regions, counts, and a few recognizable landmarks. As the user approaches a region, reveal subregions and representative files. At reading distance, reveal clear filenames, file-type cues, previews, and independently selectable files.

| Scale | What the user sees | What it helps them do |
| --- | --- | --- |
| Library | A small set of labeled regions and landmarks; subdued density | Recognize where research, projects, reference material, and media live |
| Neighborhood | Subtopics, groups of related files, representative names, counts | Browse a subject and understand what is nearby |
| Files | Collision-free selectable items with names and optional thumbnails | Distinguish versions, inspect contents, and choose a file |
| Reader | Spacious content with path, search matches, and a compact related-file rail | Read, compare context, and move to the next relevant file |

These are levels of detail in one persistent atlas. The reader and list are alternate surfaces over the same selection and location. Going back restores camera, selection, result position, and reader scroll.

Dense or identical files become explicit stacks with counts. Opening a stack reveals an ordered tray or local expansion with connectors to the permanent anchor. This improves selection without changing saved world positions. Labels receive a screen-space collision budget; focused items have priority.

Keep source roots as clear scopes. Within a root, provide a useful hierarchy. Cross-root related files remain accessible through search and related-file navigation; a unified semantic atlas can be a later optional view. Merely placing folder roots at arbitrary spiral offsets should not carry the full organizational burden.

### One coherent workspace

A compact top bar contains persistent search and location. A collapsible left rail contains the library, source roots, collections, and saved places. The center is the map, with a synchronized list/grid alternative. Search opens a results rail. Selecting a file opens a resizable preview that can expand into the reader.

Typical journey: open to your last place → type a remembered phrase → see filenames and excerpts immediately → select a hit → read its matching passage → inspect related files → return to the same map location.

Typing updates results and map highlights without moving the camera on every response. Selecting a result navigates to it. An explicit “Show matches on map” action fits the result set, and Back returns to the prior location. If results span distant regions, show counts by region instead of automatically zooming so far out that nothing is legible.

Keep Vim navigation for people who want it, with ordinary text behavior inside inputs. Arrow keys navigate the result list; Enter previews; Escape returns focus predictably. Provide visible actions and a command palette for infrequent commands. Put PCA axes, diagnostics, and embedding experiments in an advanced workspace.

### Visual direction: an astronomical atlas

Use deep ink surfaces, warm white text, muted blue-gray metadata, fine boundaries, and a restrained set of region colors. Give filenames and region names the strongest typographic hierarchy. Use roughly 14–15px interface text and 16–18px reading text, with a comfortable line length and generous paragraph spacing. Monospace belongs to paths, code, and technical metadata.

Keep the star identity: subtle point light, small halos for focus, delicate relationships on selection, and gentle transitions between scales. Decorative nebulae should sit behind the information. Rich procedural file artwork can appear at close range or in the preview, where its identity is actually visible.

Use region color for location, a small shape/icon for file type, a distinct outline for selection, and an explicit match marker for search. Avoid making brightness simultaneously stand for usage, relevance, hover, type, and decoration. Every important distinction also needs a textual or shape cue.

Retain the existing themes as alternate skins after one default experience works. Theme changes should preserve typography legibility, control placement, contrast, selection rules, and rendering budgets. Support reduced motion and complete keyboard access through the list/reader surfaces.

### The default space view is a primary redesign target

The proposed default should have a deliberate composition at every zoom level. Keep most of the sky dark and use small, crisp points with restrained warm/cool variation. Concentrate soft light around a few meaningful regions; keep decorative background stars substantially dimmer than interactive file marks. Labels, focus rings, and file previews should stay legible through every visual effect.

The current JWST theme combines a cached teal/pink deep-field background, additive star artwork, constellation halos, and zoom-dependent exposure. It leaves backing-store DPR uncapped. These choices deserve separate evaluation: the background is already cached, so removing atmosphere is not automatically the biggest performance win. Large overlapping transparent sprites, high-DPI pixel work, cold procedural bakes, and the number of visible objects are more useful hypotheses to measure. Increasing DPR increases backing pixel area quadratically at a fixed CSS viewport size.

Use four deliberately budgeted layers: a cached atmospheric field; coarse region/density marks; crisp interactive file marks; and a foreground of selected relationships and readable labels. At wide zoom, the artwork should communicate geography. At close zoom, it should distinguish individual files. A selected star may have a beautiful halo and subtle diffraction spikes because only a small number of stars need that treatment at once.

The companion concept emphasizes this direction: restrained atmospheric color, generous dark space, warm typography, named regions, and a reader with its own clear surface. Its SVG/DOM sample scene illustrates composition and interaction only. Production-scale performance must be demonstrated separately with actual map data and the rendering benchmark.

### A reader worth staying in

Make preview quick and reading spacious. The reader needs adjustable width, an expand action, Back/Forward, previous/next search result, match navigation, and a stable path breadcrumb. Put tags, pinning, and classification in a collapsible inspector.

Markdown gets readable typography and a table of contents where useful. Code gets language-aware highlighting, line numbers, and horizontal scrolling. PDFs need reliable page/zoom and match navigation; images need fit/actual-size and zoom. CSV needs a virtualized table rather than a preformatted wall of text. Start with the formats already supported, then prioritize richer viewers based on actual use.

## Search: one entry point, dependable results

Make lexical retrieval independent of Ollama and map coordinates. Index names, normalized paths, tags, and extracted content in the app's own local search store. Return exact filename/path matches first when appropriate; retrieve related material through the existing vector index; combine rankings with a documented, evaluated policy. Keep “Exact” and “Related” refinements available without forcing everyone to choose an engine before searching.

SQLite FTS5 provides ranked full-text retrieval, weighted columns, snippets, highlighting, prefix queries, and an optional trigram tokenizer. It fits the existing storage foundation. Filename punctuation, substrings, and fuzzy matching still need explicit handling; FTS5 alone is not a complete filename search design. See the [official FTS5 documentation](https://www.sqlite.org/fts5.html).

Apply root, collection, type, and tag scopes during retrieval. Small constrained vector sets can use exact scoring; larger sets need measured filtered retrieval or adaptive candidate expansion. An unknown scope should ask the user to resolve it rather than silently broaden the search.

Use chunk-level retrieval for long documents, aggregate chunks to file results, and show the matching passage. Keep a separate document-level representation for map placement so a file can have many searchable passages but one stable place. A file with no embedding must still appear in name/path search and the library.

Stream or stage lexical results before semantic enrichment. Use request cancellation plus a generation ID; preserve the currently focused result when enrichment arrives. Cache query embeddings by model and normalized query. Show explicit “related search unavailable” state while lexical results continue to work. A similarity score is not a probability; explanations should cite real matching text or metadata, not invented AI rationales.

Evaluate on a small judged set from the user's workflow: exact names, partial names, punctuation, concepts, quoted phrases, late-document passages, scoped queries, missing files, and true no-match cases. Compare exact-hit success, reciprocal rank, and recall before choosing weights or another embedding model.

## Layout: replace the organization, preserve the memory

PCA remains useful as a baseline and an advanced exploration tool. It should not be the only answer to readable organization. Connected components should be replaced for navigation by a persistent hierarchy of smaller semantic groups, seeded or constrained by source/folder context where that improves recognition.

Prototype a hierarchy from the neighbor graph or bounded hierarchical clustering. Name regions initially from representative filenames, tags, and extracted terms, with manual renaming. Treat labels as suggestions. A cluster is a navigational aid, not a claim that all its files share one exact topic.

Separate three things currently entangled: semantic similarity, permanent world positions, and temporary display placement. Use one authoritative layout revision containing world coordinates, stable region IDs, parent relationships, and bounds. All clients should consume the same positions; axis experiments can create separate named views.

Insert new files into an existing neighborhood using nearby anchors and bounded local placement. Existing coordinates stay fixed during ordinary insert/search operations. Pins use stable world coordinates in the normal atlas and never participate in rescaling everyone else. An intentional global layout upgrade is previewable, versioned, and reversible. Preserve legacy PC pins in migration metadata so they can be restored or translated against their recorded model.

UMAP is a candidate for neighborhood structure, not a decision by itself. It supports transforming new data into an existing embedding, but fidelity, distribution shift, runtime, and integration must be measured; its two-dimensional distances should not be presented as exact semantic distances. Compare it with the PCA baseline and a graph-based candidate on overlap, neighbor preservation, cluster usefulness, and displacement of existing files. See the project's [transform documentation](https://umap-learn.readthedocs.io/en/latest/transform.html).

Files without usable semantic representations get a deterministic source/folder placement and an indexing-state badge. They can be promoted into semantic neighborhoods through a controlled transition. The library must work with ten files, before the current 200-embedding layout threshold, and while the model is unavailable.

## Performance: change the amount of work

The repo already has substantial performance work: spatial culling and hit testing, dirty-frame gating, cached sprites, per-frame bake limits, reduced-detail sprites, label gating, idle prebuild, and detailed metrics. Proposing these as missing would ignore the current implementation.

The historical Phase 1 report recorded much better sprite-cache behavior and about 14ms mean combined main-star/label work in its tested scenarios, but reported foreground uncertainty and 67.7ms frame p99 in a throttled tab. Its earlier 550–983ms figures are pre-fix historical results, not current benchmarks. See [the gate report](deep-research-reports/phase1-gate-54472f9.md) and [its baseline](deep-research-reports/baseline-fullcorpus-b8b982f.md).

The current typed sprite cache allows 6,000 entries and 512 MiB of estimated pixel storage, before other renderer memory. Its key includes a 4,096-bucket file hash even for cheap sprites whose rendering ignores the file ID. That creates avoidable duplicate cache entries. Byte estimates do not equal measured process memory.

The strategic improvements are:

1. **Bound visible information.** Draw region summaries when zoomed out, file marks in neighborhoods, and detailed artwork only where useful. Bound label count and preview work by viewport size.
2. **Keep camera motion out of broad UI updates.** Give the rendering engine compact position buffers and explicit change revisions. React owns controls, accessible results, and readers. Avoid rebuilding all file objects for local changes.
3. **Fetch the representation needed for the current view.** Load coarse regions first, then relevant nodes and metadata. The existing full-map and all-PC startup requests are acceptable prototypes, but they should not define a 100k-file startup contract.
4. **Separate expensive compute from serving requests.** Move PCA/clustering and expensive extraction to bounded background jobs with revision checks, progress, cancellation, and stale-result rejection. Keep index mutations ordered. Node's [worker documentation](https://nodejs.org/api/worker_threads.html) supports using workers for CPU-intensive JavaScript; a worker pool is not a reason to parallelize every SQLite write or ordinary I/O operation.
5. **Prototype a GPU map renderer.** An instanced point/sprite pass is a strong candidate for larger corpora. Keep labels in a bounded overlay and detailed previews in the DOM. [WebGL2 instancing](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/drawArraysInstanced) supplies the drawing primitive; it does not solve organization, excessive labels, transfer cost, or expensive indexing. Adopt it if a representative spike beats the simplified Canvas2D path on frame tails and memory.

Measure a production build in the foreground on a recorded machine, browser, resolution, and DPR. Use the actual library plus 10k, 50k, and 100k fixture sets; distinguish warm/cold caches. Scenarios: initial view, pan, zoom, dense-cluster selection, rapid search typing, reader open, theme change, and indexing while browsing. Record input-to-paint and long tasks as well as draw-pass time.

Provisional acceptance targets—not measured promises:

| Experience | Proposed gate on the reference machine |
| --- | --- |
| Pan/zoom | 60fps target; p95 foreground frame intervals ≤20ms and p99 ≤33ms in a repeatable trace |
| Idle | No unnecessary scene redraws; no persistent animation-driven load in reduced-motion mode |
| Local exact/name search | p95 ≤100ms from settled input to visible results, including debounce |
| Semantic enrichment | Warm p95 ≤500ms; cold-model work has immediate lexical results and visible status |
| Cached text preview | p95 ≤100ms to visible content |
| Initial usable atlas | ≤1s warm / ≤2s cold at 10k files; staged region-first loading at 100k |
| Memory | Establish baseline; initially aim for <200 MiB renderer working set at 10k, with explicit budgets for textures and thumbnails |
| Spatial stability | Ordinary insertion/search leaves existing world positions unchanged; pinning never globally rescales the map |

## Rewrite boundary and sequence

Keep TypeScript, React for the application UI, SQLite as the authoritative store, the local model adapter, the existing ANN abstraction, useful themes/artwork, and tested file/collection/tag operations. Refactor large modules along responsibilities as those surfaces change. Revisit a native daemon or desktop wrapper only when profiling or distribution requirements justify the additional migration.

Treat HNSW and search/layout indexes as rebuildable derived state. SQLite owns user-authored metadata. Preserve IDs, collections, tags, manual classifications, pins, source roots, and snapshots. Audit the current path-derived ID scheme before promising that moves/renames preserve identity. Use additive schema changes, index-version provenance, and recoverable builds with an atomic active-version switch.

| Step | Concrete result | Exit criterion |
| --- | --- | --- |
| 1. Establish the comparison | Foreground baseline, file-coverage audit, a small search judgment set, and a short list of key browse/read tasks | Reproducible scenarios and preserved data snapshot |
| 2. Build the experience slice | New shell, persistent search/results, resizable preview/reader, Back behavior, standard input handling; initially reuse current positions | Find → inspect → read → return works across the existing formats and keyboard/mouse |
| 3. Repair retrieval and coverage | Shared extraction pipeline, metadata-first indexing, local lexical search, cancellation, scoped hybrid retrieval, unpositioned-file fallback | Exact-name and late-passage cases pass; files remain browsable without Ollama |
| 4. Prove the atlas | Three-level hierarchy, named regions, overlap handling, canonical coordinates, stable insertion and pins | Useful navigation on the real library; measured spatial stability; every file independently reachable |
| 5. Prove scale | Simplified Canvas2D/GPU comparison, bounded LOD and labels, incremental payloads and worker jobs | Foreground frame, search, startup, and memory gates at agreed corpus sizes |
| 6. Replace the default | Versioned migration, state restoration, theme parity, accessibility and regression checks | Existing capabilities survive; old map/index versions can be restored |

The first implemented slice should already feel substantially better using the current backend: persistent search with readable hits, a usable reader, and one coherent workspace. The atlas experiment then tackles the hardest product problem directly. A renderer rewrite becomes an evidence-based means to meet the experience, with a clear fallback while it is proved.

## Decisions to settle during prototype review

Working assumptions: the persistent map remains the home view; local files and local inference remain primary; current capabilities should survive; experimental knobs can move into an advanced surface. The prototype review should establish the dominant file formats, typical and desired corpus sizes, whether the reader deserves most of the window by default, and how much theme richness matters relative to file legibility.

These choices can change the emphasis without invalidating the architecture above.

## Accepted implementation refinements

During the live review, the user approved the calmer graphic design and asked to restore intermixed celestial file types, improve their artwork, and preserve the playful ability to zoom into procedural objects unique to each file. The atlas therefore shares the existing automatic/manual classifications, uses a small sprite atlas at ordinary scales, and generates deterministic close-up artwork only for visible files. The bounded cache is part of the design, not a reason to remove those identities.

The implemented layout uses stable source/folder regions and bounded neighborhoods seeded by existing semantic edges. It does not claim that arbitrary two-dimensional distance is a semantic score. PCA and embedding experiments remain in the advanced workspace; automatic indexing does not replace the established atlas layout.

## September 4 evening review: continuity and file-driven form

The real-library review rejected the square grid and the subsequent imposed spiral pattern. The organic structure of the original semantic projection is part of the product, alongside mixed celestial identities. Restore that structure, include files without embeddings using their relationships/folders, and treat region headings as annotations over the files. Do not force file positions into geometric region slots.

Zoom is one continuous camera, from the whole library through close-up artwork. Detail loading does not navigate or move objects. Headings keep their placement during hover and fade between scales. Explicit navigation, saved views, and returning home remain available, independently of wheel gestures.
