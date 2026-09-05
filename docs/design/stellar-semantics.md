# Stellar visual language: three proposals

September 5, 2026. Design proposals for review, not a new production classification. The user has explicitly allowed rethinking the old extension-to-celestial-object mapping.

**Review decision:** the user selected proposal 3, Clouds & landmarks, with a less saturated star-cluster palette and a wider, mostly-small size distribution. Pulsars and black holes should mark explicit favorites, not automatically large files. The current [interactive study](stellar-atlas-study.html) implements that revised review direction. The proposals and recommendation below record the earlier comparison; the user's decision supersedes the size-led recommendation and automatic exceptional-file silhouettes.

The common reference is [the user's stellar calligraphy](palace-stellar-calligraphy-reference.jpg): saturated blue, white, gold, orange, and red cores with luminous halos, a dark field, and organic concentrations of stars. The [interactive comparison](stellar-atlas-study.html) uses the same fictional files and positions across alternatives.

## 1. Size-led galaxy

Most files are main-sequence stars. A stable, logarithmic byte scale controls a limited range of core sizes and luminosity. Color runs from warm red/orange for small files through gold and white to blue for large ones. Exceptionally large files get a rare, recognizable landmark silhouette: a giant envelope or a compact pulsar with long, static jets.

File extension and family appear in the label, inspector, and a small close-up cue, rather than determining the whole object. Similarity groups add a faint nebula behind their stars. Every member remains independently selectable at its original position.

This gives the main-sequence palette an immediately learnable meaning. Its weakness is that a library of mostly small notes will be warm and visually uniform, while one of large photographs will be predominantly cool. Differences within such a library need enough variation in the scale, without making a 2 KB note and a 2 GB video look equivalent.

Example: a short note is a small amber star; a substantial PDF is white; a large image is blue-white; a multi-gigabyte video is a rare jet-shaped landmark. A related image sequence has one soft nebular envelope around all its distinct stars.

## 2. File families

Most files are stars, but their hue identifies a broad family. The comparison uses blue for documents/code, white for structured data, gold for images, orange for PDFs/presentations, and red for archives. Core size and the extent of the halo convey bytes independently of color. Exceptionally large files become giant or pulsar versions of their family star.

Nebulae still represent similarity groups, and thin constellation lines still represent shared folders. File labels provide the same type information without requiring color discrimination. Small, restrained shape cues can supplement color at browsing distances.

This is the easiest system for answering “where are the pictures?” or recognizing a mixed project at a glance. It also keeps a diverse palette within many ordinary folders. The tradeoff is that the spectrum is a learned legend rather than a main-sequence progression, and people may still mistake bright blue for larger unless the size cues are clear.

Example: a note and a long text report are both blue, with the report having a fuller core and halo. A tiny and a large image are gold stars of visibly different magnitude. A related set of documents is a blue-white cloud containing individual stars.

## 3. Clouds and landmarks

The most distinctive artwork describes groups. A coherent image series or close family of documents forms a textured nebula, following its existing spatial footprint. Ordinary members have modest star cores; distinct files and unusually large files stand out as brighter individual landmarks. Hue belongs primarily to the group's stable identity, with restrained per-file variation.

At wide zoom, clouds help someone recognize a project as a place. At close zoom, the cloud recedes smoothly and individual stars, filenames, and byte-size cues become prominent. No scope switch, substituted group center, or repositioning occurs during that transition.

This is the strongest memory-palace direction, but it depends most on reliable grouping. A vague “related” cluster is not enough: otherwise the nebula claims a connection the person cannot understand. Sparse or spatially separated members should remain separate patches, never be joined by a huge fog bank across unrelated files.

Example: a coherent contact sheet reads as one pale-blue nebula at a distance; closer in, each photograph remains a distinct star. Its unusually large source panorama is an obvious landmark within that cloud. An unrelated video in the same folder gets folder lines but does not automatically join the nebula.

## Recommendation for the next prototype

Start with **1 plus a restrained version of 3**: main-sequence stars for ordinary files, byte size as the principal individual-file signal, and nebulae reserved for groups whose similarity we can explain. It is a larger departure from conventional iconography and closer to the user's new reference. Keep proposal 2 available for comparison; its file-family recognition may prove more useful in actual browsing.

Compare giant envelopes and static pulsar jets as two treatments for extreme files. Giants are the more intuitive size analogy; pulsars offer a distinctive, narrow silhouette without covering nearby files. Do not animate an entire library of pulsars. A name such as “large file” in the object guide should explain the behavior without requiring astronomy knowledge.

## Rules shared by all three

- **Stable meaning:** use absolute byte scales by default. Recomputing percentiles on every indexing pass would recolor existing files when unrelated files arrive. If library-relative outliers are offered later, calibrate explicitly and retain that calibration.
- **Bounded magnitude:** use logarithmic scaling, a visible minimum core, a maximum halo footprint, and the existing gentle screen-size/zoom curve. A large file must not cover its neighbors. Exact bytes remain in the inspector.
- **Honest groups:** same folder, exact duplicates, near-duplicate images, and semantic similarity are distinct facts. Folder lines can ship from existing metadata. Similar-image nebulae require image-aware evidence; ordinary text embeddings or matching filenames are insufficient. Model-free files stay fully accessible.
- **Stable places:** preserve world coordinates. A nebula is a background treatment following members, not a replacement icon that moves the camera or hides its constituent files.
- **A separate interaction language:** selection uses an outline or ring, search uses match accents, and pins retain their own cue. These should not redefine a star's size, class, or spectral color.
- **Persistence:** manual stellar classifications survive any new automatic scheme. A future implementation needs an explicit migration/override policy before changing how those choices are shown.
- **Bounded rendering:** reuse cached halo/core artwork; generate detailed variation deterministically for nearby files; cache group envelopes; avoid per-file blur filters and continuous twinkling. Evaluate readability and foreground frame timing with a dense library.

## Astronomical reference

NASA describes main-sequence spectral classes from blue O/B stars through white and yellow to orange/red K/M stars; color relates to temperature. Pulsars are compact rotating neutron stars, not simply very large stars. These proposals borrow that visual vocabulary for file bytes and relationships, rather than claiming a literal astronomical model. Sources: [NASA: Stars in an Exoplanet World](https://science.nasa.gov/exoplanets/stars/), [NASA: Types of Stars](https://science.nasa.gov/universe/stars/types/).
