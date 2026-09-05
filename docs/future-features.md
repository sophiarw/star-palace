# Future ideas

These are recorded product ideas, not implemented features or commitments for the current website work.

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
