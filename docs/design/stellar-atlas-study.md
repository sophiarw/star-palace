# Stellar visual language review

[Open the interactive comparison](stellar-atlas-study.html). Companion reasoning: [three semantic proposals](stellar-semantics.md).

This review explores the user's updated permission to rethink file-type identities. The three systems share the same fictional file positions, byte sizes, seeds, and reference-derived blue/white/yellow/orange/red palette. Switching proposals changes presentation only. No production sprites, database, user metadata, or actual file positions are changed.

## The three proposals

| Proposal | What color means | What size means | What a cloud means | Main tradeoff |
| --- | --- | --- | --- | --- |
| Size-led galaxy | Fixed byte bands, small red through large blue | Bounded logarithmic bytes | A similar file series | Closest to the main-sequence inspiration; file-family recognition needs labels or preview |
| File families | Documents/code blue; data white; images gold; PDFs/presentations orange; archives red | Same byte mapping | A similar file series | Strongest everyday file recognition; color is no longer a main-sequence size metaphor |
| Clouds & landmarks | Decorative deterministic stellar variation | Same byte mapping | Primary group identity, more visible | Strong memory-palace places; requires trustworthy similarity groups and restrained cloud density |

Every proposal makes most files main-sequence stars. A file at or above **256 MiB** gets the selected large-file landmark: static pulsar jets (the initial choice) or a broader giant disk and halo. The selector preserves all byte thresholds and file coordinates. The giant retains the active proposal’s color and is labeled simply “Giant”; the color is not a claim about its physical spectral class. This is an illustrative threshold for review, not a committed product rule. Pulsars are physically compact; using one to mark a large file is an artistic landmark convention, not an astrophysical classification. The study deliberately does not animate flashes or twinkles.

## Byte mapping

The continuous magnitude is `clamp((log2(max(bytes, 1024)) - 10) / 20, 0, 1)`. Diameter varies from 0.85× to 1.35× between 1 KiB and 1 GiB. This limits the largest/smallest diameter ratio to about 1.59×; halos scale within the same bounded sprite. Labels do not inherit these multipliers. Missing, negative, or nonfinite sizes use the midpoint. A production guide should show exact bytes alongside any visual class.

Size-led color uses five bands sampled along that magnitude: red, orange, yellow, white, blue. These are stable absolute bands; indexing an unrelated large file does not recolor existing files. This preserves familiarity better than continuously recomputing library percentiles. Exact boundaries and the exceptional-file threshold should be reviewed against aggregate size counts before shipping.

## Similarity clouds

The three clouds in the prototype follow **explicit fictional memberships**: fixed sets of nearby sample files selected from the initial 180-file scene. Cloud particles are centered on the actual member positions; headings use their mean position. Increasing density adds surrounding files without moving these groups. This is an illustrative series assignment, not a similarity calculation or evidence about real files. Similarity must not be inferred merely from sharing a directory; folder connections and similarity clouds represent different relationships.

A production cloud must follow the existing world coordinates of its members, keep individual files accessible, show the reason for grouping, and remain stable across viewport hydration. Image sequences need appropriate image/perceptual or explicit-series evidence. Current text embedding availability does not establish image similarity. At wide zoom, show a small number of stable clouds; reveal detailed member structure on deliberate focus. Avoid recalculating cloud shapes from only the visible members.

## Artwork and performance boundaries

The core is pale with a saturated rim; the halo drops off quickly. Most objects have simple disk silhouettes. Pulsar jets and the original-type baseline use deterministic procedural geometry. The optional baseline table keeps all ten previous identities available for comparison and illustrates the conflict caused by recoloring a red giant blue.

The standalone review uses Canvas 2D, static seeded particles, and a 320-entry bounded cache of 256×256 canvases. The raw canvas pixel ceiling is approximately 80 MiB, excluding browser overhead. This is **not a proposed production cache budget**. The production renderer should retain its fixed overview sheet and bounded close-up cache, using a finite class/palette atlas or vertex tint instead of a new texture per file. Do not regenerate nebula particles or gradients on camera frames.

The prototype renders only on interactions/resizing, with a capped 2× backing resolution. Its synthetic 180/650/1,400-file controls expose crowding; they do not measure foreground performance. Production acceptance still requires smooth foreground zoom, label stability, dense-library readability, bounded cache generation, and no camera response to async data arrival.

## Review controls

- Select one of the three cards to compare semantic systems without changing positions.
- Compare **Large-file landmark → Pulsar / Giant** to choose narrow jets or a broad luminous disk.
- Turn glow and byte scaling off independently; increase object scale for ordinary-zoom detail inspection.
- Switch density while preserving the initial files and their positions.
- Drag or wheel within the atlas; Fit restores the initial camera.
- Click a star for a close-up. The collapsed original-type table also offers keyboard-focusable object buttons; Escape closes detail.

The artwork is a reviewable implementation sketch. The user should choose the semantic system before production integration.
