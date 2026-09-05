# Folder constellations

The atlas connects direct sibling files with faint, pale blue lines beneath their celestial artwork. The **Folder constellations** control offers all folders, the selected folder, or off. It remembers the choice. Lines fade in as metadata becomes available and become clearer at ordinary browsing zoom. Selection gently emphasizes that folder; search dims unrelated connections.

File coordinates remain authoritative. This feature creates no layout, database schema, or file changes. Different folders with the same name remain separate. Nested folders have their own constellations. A distant file is allowed to remain disconnected rather than drawing a line across the galaxy.

## Geometry and rendering

- The daemon derives a sparse forest from complete folder membership, independently of viewport tiles and active filters. Adjacent points in horizontal and vertical order supply at most two candidates per axis; shortest candidates are admitted without cycles, with at most three neighbors per file and a 2,400-world-unit distance limit. This is a bounded approximation of a local spanning forest, not a full all-pairs minimum spanning tree.
- A cached graph serves viewport hydration. Adding/removing files, changing paths, pinning, restoring a snapshot, or explicitly reshaping invalidates it. Text extraction, tags, classifications, and unrelated atlas revisions reuse the graph. The cache is ephemeral and can be rebuilt after restart.
- A tile includes each file's full-folder neighbors in optional `folderLinks`. The renderer only draws an edge when both endpoint files are in the current scope. Loading or discarding a tile can reveal/hide an existing connection; it never chooses another neighbor. The painter fades these transitions.
- Rendering admits at most 1,600 edges, with selected-folder edges first. Old edges may temporarily occupy an additional 1,600 fade slots. Stroke width stays at 0.75 CSS pixels; short and excessively long screen-space connections fade smoothly. There is no perpetual animation or procedural texture allocation. Shift-dragging a file moves attached lines with it.
- The layer shares the existing atmospheric canvas beneath the stars and labels, adding no canvas allocation. Reduced-motion preferences settle visibility immediately.

## Validation and limits

Unit tests cover direct parents, distinct roots, missing paths, invalid coordinates, deterministic input ordering, sparse large folders, stable coordinates, partial hydration, filtered endpoints, settled fades, selection controls, and camera invariance. Store integration checks unchanged source rows, cache reuse after extraction/tags, and correct neighbors after pin/deletion. The browser regression checks all/focus/off controls without camera/label jumps and hides links when filtering to the fixture's single media file.

A single graph-only synthetic run on September 5, 2026 measured the following construction time. These are synchronous Node timings, excluding SQLite retrieval, serialization, transport, and browser rendering; they are not foreground frame-rate measurements.

| Files | Folders | Build time |
| --- | --- | --- |
| 10,000 | 1 | 14.1 ms |
| 10,000 | 1,000 | 9.1 ms |
| 100,000 | 1 | 194.6 ms |
| 100,000 | 1,000 | 99.0 ms |

The first requested viewport after membership or position changes pays the construction cost. This can briefly delay that daemon response for a very large library; subsequent tile requests use the same graph. The graph uses O(n) storage and O(n log n) construction. A background worker remains an option if measured full-application cold navigation warrants it. Folder topology can change after membership changes, while file positions remain unchanged.

## Illustrated figures

Zodiac-like figures remain a separate visual review. A suitable next prototype assigns a deterministic figure to the folder identity, positions faint line art behind its existing graph, and offers an explicit illustration toggle. It must follow the files and must not reshape their locations into a preset animal or symbol. The current implementation deliberately establishes readable folder lines before selecting an illustration style.
