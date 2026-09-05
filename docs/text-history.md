# Text history

Enable a source in **Settings → Text history**. Select a file and open **History** to read a saved version, inspect its changes since the previous save, or restore a copy beside the original. Pausing capture retains existing versions. The in-app tutorial includes screenshots from the fictional library.

## First-release scope

- Indexed UTF-8 Markdown, plain text, common source/configuration formats, and CSV/TSV; maximum 1 MiB per file. Filename eligibility and actual content are checked. Binary control bytes, unsupported encodings, symlinks, and non-regular files are excluded.
- Capture follows settled saves while the daemon is running, including atomic editor replacements. Restarting catches the current state of tracked files; intermediate changes while the app was closed cannot be recovered.
- The scanner handles 16 indexed files per batch, yields between batches, and waits two seconds between complete scans. Baseline capture can take longer because each first version creates Git objects. It does not traverse folders to discover new files: reindex to add new or recovered files.
- Changed captured text updates lexical search and previews without moving files or changing favorites, pins, tags, or collections. Semantic embeddings are refreshed by reindexing.
- The latest 100 versions per file are listed. Older Git objects are retained. The private archive has an approximately 512 MiB Git-object storage budget; capture stops accepting new contents at the budget while existing versions stay readable. No automatic pruning or deletion is performed. Pause capture in Settings if storage is a concern. Retention controls and archive management remain future work.
- File identity is still path-derived. Renames/moves do not join histories automatically. Full historical-sky reconstruction, named milestones, and replacing originals are not part of this first slice.

## Persistence and recovery

`src/daemon/history/TextHistory.ts` stores versions in `text-history.git` beside the selected SQLite database. It is a bare local Git archive, with one ref per hashed file ID and immutable content/tree/commit objects. Original directories and any existing source repositories are untouched. Nothing is pushed to a remote. `text_history_sources` is the only added SQLite table; it records opt-in source capture.

Writes are serialized. Reads are bounded, verified before/after capture, and use literal Git arguments without a shell. Updating a ref uses its expected prior value; an interruption before ref update leaves the previous history intact. Unreachable objects can remain after an interrupted capture. Reading historical contents validates that the requested commit belongs to that file's ref.

**Restore a copy** creates an exclusive, uniquely named sibling with the original extension. It never replaces an existing path. Reindex to discover that copy. Back up both the SQLite database and `text-history.git` to preserve the library and its versions; this local history is not an independent-device backup.

API composition: `/api/atlas/history`, `/source/:id`, `/file/:id`, `/file/:id/:version`, and `/file/:id/:version/copy`. New archive endpoints require a loopback host/origin; mutations require JSON. Tests use disposable SQLite libraries and actual Git archives, never the primary library.
