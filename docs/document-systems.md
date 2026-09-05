# Markdown solar systems

Preview a local `.md` or `.markdown` file and choose **Explore solar system**. A leading document title is the sun; its major sections are planets. Point or focus a planet to inspect its generated surface, then click it or press Enter to open the reader at that heading. The sun opens the full document. Heading-free Markdown has one Contents planet.

Nested headings are moons. Up to four small moons orbit the inspected planet, and its direct subsections are listed in the inspector. Each opens the corresponding passage. Figures, attachments, and authored annotations are not parsed into moons yet.

**Back to solar system** preserves the selected planet, page, pause state, and elapsed orbital time within that reader session. The outer atlas stays mounted and retains its camera and file positions. Sections follow document order. More than twelve planets are split into pages; a fixed section list accompanies every page. Keyboard users can use Tab/Shift-Tab and Enter. Orbits pause under the pointer or while a planet has keyboard focus; **Pause orbits** and the system reduced-motion preference provide a still view.

## Editing and refresh

**Edit section in Vim** opens the original file in macOS Terminal, preferring Neovim then Vim, with a numeric line argument. **Space e** and **:edit** also use the active section after navigating from a planet. The ordinary **Edit in Vim** reader button still opens the full file. No in-app editor or file-writing command is introduced.

The section request supplies an indexed file ID, line, source line, and SHA-256 fingerprint of the preview. The daemon resolves the path from SQLite, validates the bounded line and current preview bytes, and passes a literal filename argument to the editor. A changed preview returns an error asking the user to refresh. Concurrent changes between the final validation and the external editor opening cannot be locked out. Tests launch stub editors only.

After saving, choose **Refresh document** in the reader or system. This rereads supported text through the bounded extractor and updates metadata, lexical search, and the reader without an embedding model or layout changes. Ordinary text-history capture remains opt-in and independent: refreshing does not enable history or retroactively retain earlier bytes. Related-meaning search still needs reindexing to update its embeddings.

## Appearance and identity

The approved six surface families share one procedural shader: ocean/cloud, banded giant, dune, fractured ice, volcanic night, and veiled world. A section's identifier seeds its family and terrain. Slow sphere rotation and separate cloud motion animate only the inspected detail. A bounded Canvas drawing fallback remains available when WebGL is unavailable.

CommonMark source positions handle ATX and Setext headings, formatting, CRLF, and duplicate names. Fenced code, indented code, and quoted headings are excluded from the orbital hierarchy. Reader anchors use source lines rather than duplicate-prone title slugs; ordinary heading-fragment links still work.

Section appearances are reconstructed deterministically and matched conservatively against a small browser-local identity cache. Unique body fingerprints preserve a renamed heading; unique heading paths/names preserve normal body edits. Identical duplicate sections cannot be distinguished reliably, and simultaneous renaming/content replacement may receive a new identity. The cache retains the last sixteen viewed documents and is not authored library metadata or synchronized across browsers. File rename/move identity remains subject to the existing path-derived ID limitation. Planet selection and orbital time persist while the file's reader remains mounted, not across a browser restart.

## Bounds and implementation

- One WebGL context per open system; twelve 128×128 thumbnails per page, with at most two generated per frame; one 448×448 inspected surface. Four moons use small CSS surfaces.
- At most 512 headings and the existing 2 MiB preview cap. Limits are shown in the system; the original file and full reader remain accessible.
- Rendering requests are capped at 30 per second. Hidden tabs skip rendering and paused scenes stop drawing after pending thumbnails finish. These are implementation bounds, not foreground frame-rate measurements.
- The system is lazy-loaded from the reader. It does not allocate textures for the full library or change the atlas's existing close-up cache.
- `markdownSections.ts`: parsing and conservative identity matching. `SolarSystem.tsx`: orbital controls and reader navigation. `planetSurface.ts` / `planetShader.ts`: bounded artwork. `Reader.tsx`: anchors and editing context. `openInTerminalEditor.ts`: checked external-editor launch. `AtlasService.refreshText`: model-free content refresh.

The in-app **Document solar systems** tutorial includes an actual screenshot from the fictional demo. `node scripts/capture-tutorials.mjs solar-system reader` refreshes it with the existing guarded capture workflow.
