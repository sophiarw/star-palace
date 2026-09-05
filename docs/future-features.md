# Future ideas

These are recorded product ideas, not implemented features or commitments for the current website work.

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
