# Website: observing atlas

September 6, 2026. Rollback baseline: `6817b1b`.

References: the user's [stellar palette](stellar-cluster-palette-reference.png), [calligraphy](palace-stellar-calligraphy-reference.jpg), the approved [Clouds & landmarks study](stellar-atlas-study.html), and the shipped app artwork/tutorial screenshots. Process reference: [Unpromptable design guidance](https://unpromptable.substack.com/p/5-ai-website-design-tips-for-websites): establish identity, sketch, reuse project assets, and inspect the result.

## Layout sketch

```text
宮 Star Palace                          Atlas / Tutorial / Installation / GitHub
──────────────────────────────────────────────────────────────────────────────
MAC · FILE BROWSER                       EXAMPLE LIBRARY                 12 FILES
                                        Search _____________________________
A memory palace                         .         *          .
for constellations                       .     constellation lines     *
of files.                                  *      colored clouds
                                        .           .         *
[user's description]                    Selected file / extension / folder
[Mac installation] [Atlas ↓]             File passage
──────────────────────────────────────────────────────────────────────────────
The idea                                Humans are visual creatures.
                   stellar objects / size / favorites / similarity captions
──────────────────────────────────────────────────────────────────────────────
A tutorial        folder / search / reader / places
                  screenshot                         numbered instructions
──────────────────────────────────────────────────────────────────────────────
Mac installation  prerequisites                       terminal / copy
──────────────────────────────────────────────────────────────────────────────
Feedback                                             email form
──────────────────────────────────────────────────────────────────────────────
宮 Star Palace                                       source / license
```

Mobile: source order becomes headline, sky, selected-file passage, legend, tutorial, installation, feedback. Navigation remains accessible. No continuous animation or scroll interception. Search preserves star positions. Faint white folder connections and colored fictional similarity clouds retain distinct meanings.

Copy constraint added by the user: labels, descriptive nouns, and captions; no new promotional prose or decorative adjectives. Retain the user's exact headline and stargazing/SharePoint description. Instructional sentences only where needed for operation and feedback privacy. The calligraphy stays decorative at 10% opacity.

Implementation: reuse canonical procedural sprites and palette; draw static seeded dust on interaction/resize only. Reuse guarded fictional app screenshots via Vite asset imports. Use system serif typography for the title, system sans for controls and captions, monospace for metadata. No external fonts or UI framework. Test keyboard interaction, small screens, no-JavaScript content and intercepted feedback delivery. Inspect screenshots before committing.

Final copy direction supersedes the initial preservation plan: the user requested replacing all copy. The headline is “A constellation of files.” Other text is labels, captions, and necessary instructions. The old headline and stargazing/SharePoint prose are retired.

Logo refinement: retain the approved brush geometry, with a reduced-opacity silhouette beneath sparse bright cores, asymmetric rays, colored radial halos, and deterministic clipped points. Inspected at 32, 48, 128, and 240 CSS pixels. The assets remain vectors, with no raster enlargement.
