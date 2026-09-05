# Favorites

Favorites give files a deliberate landmark: a pulsar or a black hole. Use **Favorite** in the file reader, then choose **Favorite appearance**. Removing a favorite returns the file to the ordinary size-based star treatment and remembers its chosen favorite appearance. List cards and search results show a star badge. Vim command mode supports `:favorite` and `:unfavorite` for the selected file.

Favorite state is independent of positional pins, file type, legacy manual object overrides, and operating-system usage counts. Favoriting does not move files, pin them, rewrite originals, or alter legacy `star_type`. Pins still mean “hold this position.” Existing manual object choices remain stored for the advanced workspace; they do not override the current atlas visual language.

## Persistence and transport

`FileIndex` adds `files.is_favorite` (boolean integer, default 0) and `files.favorite_appearance` (`pulsar` or `black-hole`, default `pulsar`) through idempotent additive migrations. Upsert initializes them for new files and deliberately excludes both from the conflict update. Reindexing therefore preserves favorites, even when stale indexing inputs carry different values.

`POST /api/atlas/file/:id/favorite` accepts `{ "isFavorite": true, "favoriteAppearance": "black-hole" }`. Appearance is optional; omitting it preserves the prior value. The response includes the updated file and atlas revision. Invalid types/appearances return 400; absent or unplaced files return 404. Applying the existing state is idempotent and does not bump the revision. Changes invalidate rendering through an atlas revision trigger without queuing text extraction or changing layout.

Summary markers and full metadata both carry `size`, `isFavorite`, and `favoriteAppearance`. This lets the renderer use the same visual identity before and after viewport hydration. Search results immediately incorporate local metadata changes, including when a slower related-search response arrives afterward. Position snapshots restore positions and region labels; they do not roll back later favorite choices.

## Validation

- `tests/api/FileIndex.test.ts`: pre-favorite schema migration, reopening, defaults, appearance retention, and reindex preservation alongside legacy overrides/pins/tags.
- `tests/atlas/store.test.ts`: consistent summary/list/search/viewport metadata, immediate revision updates, idempotence, unchanged positions, and snapshot independence.
- `tests/atlas/service.test.ts`: favorite request validation and typed HTTP marker metadata.
- `tests/browser/favorites.spec.ts`: Reader controls, appearance choice, search/list badges, reload persistence, and Vim commands against fictional demo files; restores original demo favorite metadata afterward.

Tests use in-memory databases, temporary files, or the isolated demo database. The user's primary library is not used for validation.
