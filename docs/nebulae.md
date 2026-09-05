# Similarity nebulae

The default atlas draws faint blue, rose, or amber haze around evidence-led groups at their existing positions. Folder lines and similarity haze are separate: being in one directory does not establish similar content.

Groups require at least three files with either the same nonempty content hash and byte size, or indexed embedding edges with weight at least 0.92. Distant islands remain separate. This is not a perceptual image-similarity model. Without embeddings, exact duplicates still qualify.

`nebulaGroups.ts` derives at most 128 groups, each containing at most 48 files and spanning at most 2400 world units per axis. Duplicate evidence takes priority over semantic links. Sorting and tie-breaking make results deterministic for the same evidence; changing memberships can change derived group identities. File positions and user metadata are never rewritten.

`NebulaStore.ts` caches derived groups until content, embedding edges, or geometry changes. Favorite changes and extracted text do not invalidate this cache. An independent epoch lets the UI receive changes to edges even when the ordinary file revision stays unchanged. Summary scopes and the existing 4096-marker overview budget filter visible group members; groups with fewer than three displayed members are omitted. The cold SQL edge query is capped at 100,000 strong edges.

`galaxyHaze.ts` bakes member-centered colored kernels into one bounded 1024-pixel texture when summary geometry/membership changes. Viewport hydration does not change grouping. Per-frame drawing uses that cached texture with a continuous zoom fade.

## Validation

Five regression tests cover evidence requirements, ordering, distance/member/group budgets, source filtering, cache invalidation, edge-only refreshes, and unchanged positions/document state. A synthetic helper-only run with 100,000 points and 99,999 strong edges took 85.7ms on this Mac; this excludes SQLite reads and is not foreground rendering performance. Foreground results against the isolated 1,748-file library are recorded in `revamp-progress.md`.
