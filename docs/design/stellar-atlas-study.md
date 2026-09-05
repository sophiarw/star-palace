# Stellar visual language review

[Open the interactive comparison](stellar-atlas-study.html). Companion reasoning: [three semantic proposals](stellar-semantics.md).

This review explores the user's updated permission to rethink file-type identities. The three systems share the same fictional file positions, byte sizes, seeds, and reference-derived blue/white/yellow/orange/red palette. Switching proposals changes presentation only. No production sprites, database, user metadata, or actual file positions are changed.

## Selected direction and latest refinement

The user selected **Clouds & landmarks** and supplied a [star-cluster reference](stellar-cluster-palette-reference.png) to replace the overly saturated calligraphy palette for atlas objects. The image is saved unchanged from the user's attachment; its original astronomical source was not identified in the conversation. The calligraphy remains the brand reference.

The study now starts in this direction: predominantly ivory and warm white stars, with pale gold, blue, and peach variation. Halos are quieter and ordinary files have a wider, mostly-small size distribution. This is an art-directed skew inspired by the reference, not a simulation or fit to an observed stellar population.

The next refinement adds a **bounded Lorentzian saturation tail**: most stars retain the pale palette, while a few larger ordinary stars acquire moderately richer red or blue tints. A deterministic truncated Cauchy sample (center 0.08, width 0.035, bounds 0.03–0.50) drives a quantized tint strength; only the larger end of the existing size distribution uses that richer tint. In the 650-file fixture, 13 ordinary stars receive it. This is an artistic saturation control, not an empirical stellar distribution or an exact HSL saturation measurement. The tint is capped below the earlier vivid palette, and the pale cores remain unchanged. It never creates additional favorite objects or changes positions/bytes. Group haze is now softly blue, rose, and amber at low opacity.

The user also chose **favorites as special celestial objects**. Pulsars/black holes are not automatically assigned by file size. The study starts with three explicitly marked favorites, independent of density, byte size, or indexing. Click a file and toggle **Favorite file**; use **Favorite appearance** to compare pulsar and black-hole treatments. Changes live only in the review page's memory and Reset/reload restores the three demo favorites. The production app does not yet have this favorite state.

A production implementation must persist favorite state separately from positional pins and automatic stellar classes, preserve it through re-indexing, and offer a discoverable favorite/unfavorite action. A star can be spatially pinned without being a favorite, and vice versa. Similarity nebulae remain a group treatment.

## Earlier proposals (retained for comparison)

| Proposal | What color means | What size means | What a cloud means | Main tradeoff |
| --- | --- | --- | --- | --- |
| Size-led galaxy | Fixed byte bands, small red through large blue | Bounded logarithmic bytes | A similar file series | Closest to the main-sequence inspiration; file-family recognition needs labels or preview |
| File families | Documents/code blue; data white; images gold; PDFs/presentations orange; archives red | Same byte mapping | A similar file series | Strongest everyday file recognition; color is no longer a main-sequence size metaphor |
| Clouds & landmarks | Decorative deterministic stellar variation | Same byte mapping | Primary group identity, more visible | Strong memory-palace places; requires trustworthy similarity groups and restrained cloud density |

Every proposal makes ordinary files main-sequence stars. Only user-marked favorites receive a pulsar or black-hole silhouette. Their presence is bounded independently of bytes, so even a small favorite is recognizable; marking one does not alter its file coordinates. The earlier automatic 256 MiB landmark threshold has been removed. No flashing, twinkling, or automatic favorites are introduced.

## Byte mapping

The continuous magnitude is `clamp((log2(max(bytes, 1024)) - 10) / 20, 0, 1)`. The ordinary-star multiplier is `0.38 + 1.72 * magnitude ** 3.4`. This makes most stars smaller, with a sparse upper tail and a bounded maximum of 2.1×. In the 650-file fixture the median is 0.557×, p90 is 1.550×, and the maximum is 2.074×, compared with the previous median near 1.1×. Halos scale within the same bounded sprite; favorites use a separate 1.8× multiplier so their identity is recognizable even for tiny files. Labels do not inherit these multipliers. Missing, negative, or nonfinite sizes use the midpoint. A production guide should show exact bytes alongside any visual class.

Size-led color uses five bands sampled along that magnitude: red, orange, yellow, white, blue. These are stable absolute bands; indexing an unrelated large file does not recolor existing files. This preserves familiarity better than continuously recomputing library percentiles. Exact byte boundaries and the size curve should be reviewed against aggregate library size counts before shipping. No byte threshold controls favorites.

## Similarity clouds

The three clouds in the prototype follow **explicit fictional memberships**: fixed sets of nearby sample files selected from the initial 180-file scene. Cloud particles are centered on the actual member positions; headings use their mean position. Increasing density adds surrounding files without moving these groups. This is an illustrative series assignment, not a similarity calculation or evidence about real files. Similarity must not be inferred merely from sharing a directory; folder connections and similarity clouds represent different relationships.

A production cloud must follow the existing world coordinates of its members, keep individual files accessible, show the reason for grouping, and remain stable across viewport hydration. Image sequences need appropriate image/perceptual or explicit-series evidence. Current text embedding availability does not establish image similarity. At wide zoom, show a small number of stable clouds; reveal detailed member structure on deliberate focus. Avoid recalculating cloud shapes from only the visible members.

## Artwork and performance boundaries

The core is pale, with restrained warm/cool color and a quickly diminishing halo. Most objects have simple disk silhouettes. Pulsar jets and the original-type baseline use deterministic procedural geometry. The optional baseline table keeps all ten previous identities available for comparison and illustrates the conflict caused by recoloring a red giant blue.

The standalone review uses Canvas 2D, static seeded particles, and a 320-entry bounded cache of 256×256 canvases. The raw canvas pixel ceiling is approximately 80 MiB, excluding browser overhead. This is **not a proposed production cache budget**. The production renderer should retain its fixed overview sheet and bounded close-up cache, using a finite class/palette atlas or vertex tint instead of a new texture per file. Do not regenerate nebula particles or gradients on camera frames.

The prototype renders only on interactions/resizing, with a capped 2× backing resolution. Its synthetic 180/650/1,400-file controls expose crowding; they do not measure foreground performance. Production acceptance still requires smooth foreground zoom, label stability, dense-library readability, bounded cache generation, and no camera response to async data arrival.

## Review controls

- Select one of the three cards to compare semantic systems without changing positions.
- Compare **Favorite appearance → Pulsar / Black hole**, then click any file and toggle **Favorite file**. The initial scene has only three special objects, even at higher densities.
- Turn glow and byte scaling off independently; increase object scale for ordinary-zoom detail inspection.
- Switch density while preserving the initial files and their positions.
- Drag or wheel within the atlas; Fit restores the initial camera.
- Click a star for a close-up. The collapsed original-type table also offers keyboard-focusable object buttons; Escape closes detail.

The artwork is a reviewable implementation sketch. Clouds & landmarks is selected; the refined palette, size balance, and favorite treatment remain in this review before production integration.
