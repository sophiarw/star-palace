# Solar-system proposals

September 5, 2026 · Contents approved; the first Markdown integration is implemented. See [document systems](../document-systems.md) for supported flows and limits.

## Approved direction

The user selected **Contents** as the meaning of the planets after approving the procedural surface study. The document is the sun; its substantial internal sections are planets. Start with Markdown headings and exact reader anchors. Figures, subsections, or annotations can be moons belonging to their section. Code functions/classes and workbook sheets are later format extensions. Sources, milestones, and reading routes remain alternative proposals, not selected features.

[Interactive planet study](planet-study.html) explores six seeded procedural surfaces: ocean/cloud, banded giant, dune, fractured ice, volcanic night, and veiled world. One active WebGL sphere uses spherical noise, surface lighting, an atmosphere rim, and independent cloud motion. Six small cached thumbnails supply the catalog and orbit sketch. No image-generation service, external assets, library data, or production app changes are involved.

## Questions a file's system could answer

| View | Question | Planets | Smaller bodies | Assessment |
| --- | --- | --- | --- | --- |
| Contents | What is in here, and where was that passage? | Prose sections; code functions/classes; workbook sheets; notebook sections | Figures, subsections, annotations attached to their parent | Strongest first implementation. Markdown headings are already a reliable starting point. Other formats need extraction work. |
| Sources | What is this based on, and where is it used? | Explicitly linked documents, citations, imports, or input datasets | Specific cited passages or imported symbols | Useful second view. Distinguish incoming and outgoing references. Resolve actual links; inferred similarity must carry separate evidence. |
| Milestones | How did this get here? Which draft did I mean? | A few deliberately saved versions | Individual changes within a selected milestone | Visually promising once named milestones exist. Hundreds of automatic saves need a timeline, not hundreds of planets. |
| Reading route | What mattered to me here? | User-bookmarked passages, decisions, or questions | The user's notes on each bookmark | A personal memory palace rather than a structural table of contents. Strong utility, but requires new authored anchors and annotation storage. |

Begin with the approved **Contents** system. **Sources** is a possible later, explicitly selected alternate view. Do not put sections, revisions, tags, and other files into one unlabeled orbital population. Existing related files remain stars in the outer atlas; a Sources system would be a local relationship view with links back to those stars, not a new permanent classification.

For a project folder, a different scale is coherent: a central project with its files as planets. That is an alternative to the document-interior design, not something to silently switch to mid-zoom. Compare it only if folder browsing becomes the primary use case.

## A visual language with few rules

- The central sun identifies the document and opens the full reader.
- Orbital order follows document order. Planet radius gives a bounded hint of section length. Explicit labels and a static contents list remain available.
- Each section receives a persistent visual seed and surface family. They are recognition aids, not inferred grades of correctness, importance, completion, or emotion. A lava planet does not mean “bad code.” Let users choose a landmark appearance later.
- Moons belong to a specific parent section: figures, tables, footnotes, or authored notes. Reveal them for the inspected planet instead of making every paragraph orbit.
- Rings are a possible cue for saved highlights; test their meaning before adding them. File metadata such as bytes, path, and timestamps is clearer as readable text.
- Keep versions in the existing history view initially. A later time control could change the same familiar planet's surface at explicit checkpoints. It must not imply recovery before history capture began.

## Continuity and cost

For production, do not reseed a planet from changing file contents. Use a retained document/section identity, with conservative matching across heading edits. Duplicate headings, inserted sections, and renames need explicit handling; current path-derived file identity is a known limitation.

Use very slow deterministic orbits, stable orbital tracks, and a paused or followed inspected body. Pause on interaction and honor reduced motion. Enter a system deliberately and preserve the atlas camera on return. Ordinary atlas indexing and map geometry remain unchanged.

The study caps the active render at 1,000 square pixels per side and 30 requested frames per second, skips hidden-tab rendering, and stops drawing while paused unless a control changes. Those are budgets, not measured performance claims. A production implementation would generate detail only for the active system and retain the atlas's bounded close-up cache. The current study evaluates appearance; its section buttons select a fictional world rather than navigate real document content.

## Integration requirements

The surface study and Contents direction are approved. An implemented system needs an in-app screenshot tutorial, exact reader anchors, keyboard navigation, reliable pointer selection during motion, and regression checks for persistent identity and camera return.
