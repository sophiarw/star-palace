# Folder searches and indexing updates

The atlas's local search already indexed full file paths. A search such as `Incoming` matches files in `/Incoming/` and nested descendants, without an embedding model. The September 5 fix addresses two adjacent gaps:

- An unchanged query did not refresh when background indexing advanced. A zero-result search could remain empty after its files became searchable. Local matches now refresh on the atlas revision, with a 200 ms debounce, keeping current hits visible and preserving related results. Revision changes do not repeat semantic requests. Query, mode, or scope changes still cancel obsolete requests.
- Visible source, region, and neighborhood names could differ from physical paths and were not searchable. These labels now return their contained files. Label-only matches identify the reason in their snippet.

Exact filenames rank first, then filename fragments, physical path matches, visible labels, and other text matches. For equally scored path matches, shorter paths rank first. Source, collection, category, tag, region, and neighborhood filters are applied before candidate limits. The explicit Related meaning mode keeps its semantic-only behavior.

No schema migration or index rebuild was introduced: the existing trigram and text indexes already contain paths. A fixture test reopens an existing index and verifies nested folder matching, custom source/region labels, ranking, and source/category exclusion. Stored files, positions, favorites, pins, and extracted text remain unchanged.

The browser regression begins with an empty `Incoming` query, advances the summary revision, and checks that results appear without typing again. A later delayed refresh keeps those results visible, and semantic search is called only once. This demonstrates the indexing-refresh failure mode; it does not assert that every empty folder search had the same cause. Geographic scope can also exclude a folder elsewhere in the atlas.
