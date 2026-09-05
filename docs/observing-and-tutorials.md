# Observing tools and tutorials

## Wavelength lenses

Use the map's lower-left control. **Visible** retains the canonical artwork. **Ultraviolet** colors/emphasizes files by recorded modification time (bright violet within one day, lavender within a week, muted violet older). **Infrared** shows byte-size bands (red under 1 MiB, orange through 16 MiB, bright amber above). **Radio** emphasizes folder connections and similarity haze. These are astronomical metaphors, not physical wavelength measurements.

Lens switches preserve coordinates, camera, selection, favorite silhouettes, and search highlights. They do not change retrieval scope. Radio temporarily exposes all folder lines; returning to another lens restores the user's previous visibility setting. Summary markers carry modification timestamps, so hydration uses the same data rules as distant markers. Missing timestamps have an explicit dim treatment. Time bands refresh when scene data changes or a lens is selected; no animation loop is introduced just to age the colors.

`lenses.ts` owns labels and transfer rules. `AtlasMap.tsx` supplies the scene treatment; `stellarVisual.ts` applies a shared color override to GPU/Canvas sprites and close-ups. The fixed sprite sheet includes each lens tint for ordinary stars and both favorite silhouettes; close-ups use those same colors. Existing sprite-cache budgets remain unchanged.

## Fullscreen

The expand control beside Map/List/Grid and `:fullscreen` enter the immersive atlas. The toolbar and panels are hidden, search appears on focus through `/` or `⌘/Ctrl K`, and Escape dismisses search before leaving fullscreen. Native dialogs retain their own Escape handling. Exiting restores the previous view, preview visibility, and reader expansion. Existing library/results preferences and camera coordinates remain intact. macOS/browser fullscreen is independent.

## Tutorials

**Tutorials** in the app header opens 17 feature guides with three short steps each and a clickable screenshot. History, updates, and active lenses also link to their guide. Images load only when the tutorial is open; all text and screenshots ship with the app and work offline.

- `src/renderer/src/atlas/tutorialCatalog.ts`: guide text and feature IDs.
- `src/renderer/src/atlas/Tutorials.tsx`: guide selection, contextual links, and full-size image access.
- `src/renderer/public/tutorials/`: actual UI screenshots using fictional files only.
- `scripts/capture-tutorials.mjs`: repeatable capture against the dedicated port-5178 demo. Displayed source paths are replaced with fictional `/Users/you/Star Palace Demo` paths.

Prepare the isolated demo with `STARPALACE_DEMO_DIR=.atlas-dev/features node --import tsx scripts/seed-atlas.ts`, then run `STARPALACE_DIR=.atlas-dev/features STARPALACE_PORT=7378 STARPALACE_WEB_PORT=5178 npm start`. Run `node scripts/capture-tutorials.mjs` to refresh the images. It modifies favorites and enables history only in that generated demo.

Use `npx playwright test --config playwright.features.config.mjs` for the feature checks, or add `STARPALACE_FULL_BROWSER=1` for the entire browser suite on that isolated library. Tests verify camera continuity, fullscreen restoration/search, history/diff/recovery controls, update errors, and every tutorial image. Screenshots and headless browser timing do not establish foreground frame rate.
