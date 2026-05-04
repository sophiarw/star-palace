# `/api/search` audit — 2026-05-03

Reproduced against the live audit daemon at `http://127.0.0.1:7373` (`STARPALACE_DIR=$HOME/.starpalace-audit`, 210 files, layout v2, 10 constellations). All probes are read-only HTTP calls + source review. No code modified.

## Top-level summary

Twelve distinct bugs found, ranked below. Headline issues:

- **B1 (serious): collection K-multiplier is too small.** A query with poor topical overlap for a collection's content can return zero or under-counted results — the daemon caps the candidate set at `limit*5` (≤150 by default), so members ranked deeper in KNN never reach the post-filter. Reproduces deterministically on the audit DB.
- **B2 (serious): pinning a star does not update its search-result coordinates.** `POST /api/file/:id/pin` writes pin coefficients but never rewrites `files.x/y`, so search still returns the pre-pin world coordinates. The renderer hides this via `usePcDial`, but only when the dial is ready — non-pcDial consumers (and the renderer on a cold load) pan to the wrong place.
- **B3 (serious): non-string `query` types crash with a `text.trim is not a function` 500.** The `if (!query)` gate misses arrays, numbers, booleans, and objects — they all reach `EmbeddingEngine.embed` which then throws.
- **B4 (serious): `limit:-1` (and any negative number) returns a 500 leaking the HNSW `maxElements` cap.** No upstream validation; the value is forwarded straight into `searchKnn`.

Severity buckets:

| Severity | Count | IDs |
|---|---|---|
| Blocker | 0 | — |
| Serious | 5 | B1, B2, B3, B4, B12 |
| Minor | 5 | B5, B6, B7, B8, B9 |
| Cosmetic | 2 | B10, B11 |

---

## B1 — Collection-filter K-multiplier truncates legitimate matches

**Severity.** Serious.

**Repro.**

```
# 1. Build a static collection of all 21 quasar files.
QUASARS=$(curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"quasar","limit":50}' \
  | python3 -c 'import sys,json,...print(... 21 ids ...)')

curl -s -X POST http://127.0.0.1:7373/api/collections \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"quasars\",\"kind\":\"static\",\"fileIds\":[<21 ids>]}"
# returns id=4

# 2. Search a topic that ranks the collection deep (binary/main-sequence content
#    out-ranks quasars on this query — quasar IDs first appear at unfiltered
#    position 51).
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"binary stars revolving","limit":4,"collectionId":4}'
# {"results":[]}                          <-- BUG: 0 of 21 members

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"binary stars revolving","limit":20,"collectionId":4}'
# 7 of 21 members

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"binary stars revolving","limit":30,"collectionId":4}'
# 18 of 21 members  (renderer's default limit is 30)

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"binary stars revolving","limit":100,"collectionId":4}'
# 21 of 21 members
```

**Expected.** A collection-scoped search should rank-and-return *that collection's* matches; if the collection has 21 members, asking for 4 should give the 4 most-similar members. At minimum, an `n` member collection should always yield up to `min(limit, n)` results when at least `min(limit, n)` members exist (which is "always" — every member is a candidate).

**Observed.** With `limit=4` against the 21-member quasars collection, the daemon does `k = limitN * 5 = 20` against the global HNSW. None of the top-20 unfiltered hits are quasars, so the post-filter returns `[]`. With `limit=20` (k=100) seven members slip through. With `limit=30` (k=150) eighteen do. With `limit=100` (k=500, capped at corpus 210) all 21 return.

**Suspect.** `src/daemon/index.ts:626` — `const k = memberSet ? limitN * 5 : limitN`. The 5× multiplier is a heuristic; it fails any time the user's query is topically orthogonal to the collection. Two cleaner fixes:

1. When a collection is scoped, fetch the embedding for the query, then run KNN over only that collection's vectors (build a per-collection HNSW, or score each member explicitly with `dot(queryVec, memberVec)` since N is bounded). The current `applyPinSignFlips` and `listPinned` patterns show direct-iteration is acceptable for member-scoped work.
2. If the global-HNSW path stays, replace `limit*5` with a much larger floor (e.g. `Math.max(limit*5, 200, count_in_collection*4)`) so small collections never under-recall, OR loop and grow `k` until either `count` results are yielded or `k` reaches the corpus size.

**Notes.** Stable across re-runs (Ollama embeddings are deterministic). Does *not* reproduce when the collection's members happen to top-rank for the query (e.g. searching `"main sequence"` against a main-sequence collection — those members are positions 0..N already). The bug only bites when collection content ≠ query topic.

---

## B2 — Search results return stale x/y after pinning a star

**Severity.** Serious.

**Repro.**

```
# Pin file 2ff264fc026217d9 (a main-sequence star) to (100, 100):
curl -s -X POST http://127.0.0.1:7373/api/file/2ff264fc026217d9/pin \
  -H 'Content-Type: application/json' \
  -d '{"x":100,"y":100,"axisA":0,"axisB":1}'
# {"ok":true,"alpha":100.20...,"beta":100.10...,"axisA":0,"axisB":1}

curl -s http://127.0.0.1:7373/api/file/2ff264fc026217d9 \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["x"],d["y"],d["isPinned"])'
# -444.6406... -100.9803... True

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"main sequence","limit":3}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);[print(r["id"],r["x"],r["y"]) for r in d["results"]]'
# 2ff264fc026217d9 -444.6406... -100.9803...   <-- pre-pin coordinates
```

**Expected.** Either:
- `/api/search` returns the post-pin world position (so the consumer pans to the visual location), or
- `/api/search` documents that x/y are "natural" PCA coords and pin offsets must be applied client-side using `applyPinOffset`.

Currently neither is true: the field name `x` is shared between the pre-pin natural coord (in `files.x`) and the post-pin display coord (computed only in the renderer's `usePcDial`). A non-renderer consumer (Postman / a future native client / an integration test) cannot reproduce the visual location from `/api/search`.

**Observed.** `db.setPin` in `src/daemon/db/FileIndex.ts:448-459` writes only `pin_alpha/pin_beta/pin_axis_a/pin_axis_b/pinned_at/is_pinned`. `files.x/y` are unchanged until the next PCA retrain (`POST /api/relayout`). The search response constructs `{x: file.x, y: file.y}` directly from those stale columns.

**Suspect.** `src/daemon/index.ts:634-641` — search payload builder. Either:
- Compute the post-pin position server-side via `projectOnAxis(file.embedding, model.components[axisA], model.mean) + pinAlpha` (and the same for axisB) when `file.isPinned`, or
- Add `pinAlpha/pinBeta/pinAxisA/pinAxisB/isPinned` to `SearchResult` so any client can compute the offset.

**Notes.** The renderer happens to mask this on a warm load because `usePcDial` (`src/renderer/src/hooks/usePcDial.ts:80-130`) re-projects every star including pinned offsets, and `App.tsx:255-266` overrides search-returned `x/y` with `pcDial.scaledById.get(id)`. But on a cold load (pcDial not yet ready, `pcDial.scaledById.size === 0`) the App falls through to `h.x/h.y` (`App.tsx:278-279`) and pans to the stale location. Try Cmd+F immediately after launch — first pan can land in the wrong spot.

---

## B3 — Non-string `query` types throw `text.trim is not a function`

**Severity.** Serious (info disclosure + 500).

**Repro.**

```
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":["hello","world"]}'
# HTTP 500: {"error":"TypeError: text.trim is not a function"}

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":42}'
# HTTP 500: {"error":"TypeError: text.trim is not a function"}

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":true}'
# HTTP 500: {"error":"TypeError: text.trim is not a function"}

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"nested":"object"}}'
# HTTP 500: {"error":"TypeError: text.trim is not a function"}
```

**Expected.** Validate `typeof query === 'string'` at the route entry; respond 400 with a descriptive error.

**Observed.** Endpoint only checks `if (!query) return res.status(400)`. Truthy non-strings (`[1]`, `42`, `true`, `{}`) fall through. `EmbeddingEngine.embed` calls `text.trim()` and crashes.

**Suspect.** `src/daemon/index.ts:608` — replace `if (!query)` with:

```ts
if (typeof query !== 'string' || !query.trim()) {
  return res.status(400).json({ error: 'query must be a non-empty string' })
}
```

This also subsumes B5 (whitespace-only).

**Notes.** Most clients won't hit this in practice, but it's an unhandled stack trace in user-visible output.

---

## B4 — Negative `limit` returns 500 leaking the internal HNSW cap

**Severity.** Serious.

**Repro.**

```
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"hello","limit":-1}'
# HTTP 500
# {"error":"Error: Invalid the number of k-nearest neighbors (cannot be given a value greater than `maxElements`: 200000)."}

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"hello","limit":-100,"collectionId":1}'
# HTTP 500 (same)
```

**Expected.** 400 — "limit must be a non-negative integer", or coerce to default. The internal `maxElements: 200000` cap should not leak.

**Observed.** `Math.min(-1, 210)` in `HnswIndex.searchKNN` returns `-1`; `searchKnn(arr, -1)` in hnswlib-node reinterprets the signed -1 as a huge unsigned int, so the lib reports "value greater than maxElements".

**Suspect.** `src/daemon/index.ts:625` — add validation:

```ts
const limitN = limit ?? 20
if (typeof limitN !== 'number' || !Number.isFinite(limitN) || limitN < 0 || !Number.isInteger(limitN)) {
  return res.status(400).json({ error: 'limit must be a non-negative integer' })
}
```

**Notes.** Same 500 surface as B6 (`limit: "abc"`) — those return empty silently because `Math.min(NaN, 210) = NaN` and HNSW's wrapper happens to early-out on NaN. Either way the validation belongs at the route entry.

---

## B5 — Whitespace-only `query` returns 500 instead of 400

**Severity.** Minor.

**Repro.**

```
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":" "}'
# HTTP 500: {"error":"Error: EmbeddingEngine.embed: refusing empty/whitespace prompt"}

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"\n\t"}'
# HTTP 500: {"error":"Error: EmbeddingEngine.embed: refusing empty/whitespace prompt"}

# BOM (U+FEFF):
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' --data-binary $'{"query":"﻿"}'
# HTTP 500: {"error":"Error: EmbeddingEngine.embed: refusing empty/whitespace prompt"}
```

**Expected.** 400 — whitespace queries are user error, not server error.

**Observed.** Route guard `if (!query)` only catches falsy values (empty string, null, undefined, 0, false). `"   "` is truthy → reaches EmbeddingEngine which throws → caught by outer `catch` → 500.

**Suspect.** Same fix as B3: validate `typeof query === 'string' && query.trim()` at the route entry. EmbeddingEngine's defensive throw at `src/daemon/embedding/EmbeddingEngine.ts:32-34` is correct as a backstop, but the route should never let whitespace through.

**Notes.** Zero-width-space `"​"` is *not* trimmed by `String.prototype.trim()` so it slips through to Ollama and gets embedded as content. That's harmless but worth documenting that "empty" is JS-trim-defined, not Unicode-whitespace-defined.

---

## B6 — Non-numeric / NaN `limit` silently returns empty results

**Severity.** Minor.

**Repro.**

```
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"hello","limit":"abc"}'
# {"results":[]}    HTTP 200

curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"hello","limit":[]}'
# {"results":[]}    HTTP 200
```

**Expected.** 400 with a "limit must be a number" error (or coerce silently).

**Observed.** `limit ?? 20` keeps the bad value. `Math.min("abc", 210) = NaN`, `searchKnn(emb, NaN)` returns nothing, the route happily ships `{results: []}`. The user can't distinguish "no matches" from "type error".

**Suspect.** Same fix slot as B4 (limit validation at `src/daemon/index.ts:625`).

**Notes.** `limit: 2.5` rounds *down* to 2 because `Math.min(2.5, count)` returns 2.5 and HNSW's `searchKnn` truncates; user requested 2.5, got 2. Probably fine but inconsistent — accept integers only.

---

## B7 — Pin endpoint contract / collection ID type leakage

**Severity.** Minor.

**Repro.**

```
# Boolean false reaches SQLite and 500s with a backend type error:
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"hello","collectionId":false}'
# HTTP 500: {"error":"TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null"}

# String coercion succeeds (SQLite type-affinity):
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"main sequence","limit":20,"collectionId":"1"}'
# 200 — returns the same 5 results as collectionId:1

# Object/array crash with a different error:
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"hello","collectionId":[1]}'
# HTTP 500 — TypeError binding [1] to SQLite
```

**Expected.** Validate `collectionId` is a non-negative integer; 400 otherwise.

**Observed.** Route does `if (collectionId !== undefined && collectionId !== null)` then immediately calls `db.getCollection(collectionId)` (a parameterised SELECT). SQLite coerces "1" → 1 (works), but `false`/`[1]`/`{}` reach better-sqlite3's binder which throws.

**Suspect.** `src/daemon/index.ts:618-621`. Add an integer guard:

```ts
if (collectionId !== undefined && collectionId !== null) {
  if (typeof collectionId !== 'number' || !Number.isInteger(collectionId) || collectionId < 0) {
    return res.status(400).json({ error: 'collectionId must be a non-negative integer' })
  }
  const coll = db.getCollection(collectionId)
  ...
}
```

**Notes.** `collectionId: 0` returns 404 (no collection with that id), which is technically correct under the current model but masks the fact that the renderer never sends 0 — `0` exists nowhere in the codebase as a valid collection id.

---

## B8 — Search mode swallows Enter; cheatsheet promises it selects hovered

**Severity.** Minor (UI).

**Repro (keyboard).**

1. Press `Cmd+F` to open search.
2. Type a query — results appear.
3. Press `Cmd+F` *again* to hide the bar but keep the highlights (cheatsheet says this is the design).
4. Mouse over a star (any star). Press `Enter`.

**Expected.** Per cheatsheet `Cheatsheet.tsx:26` — *"Enter: Select hovered star (or hide search bar when typing)"*. The hovered star should be selected.

**Observed.** Nothing happens. The mode is still `'search'`, and `useVimMode.ts:276-297` only handles `Escape` / `n` / `N` in search mode. `Enter` falls through.

**Suspect.** `src/renderer/src/hooks/useVimMode.ts:283-296`. The search-mode branch needs an additional case:

```ts
if (key === 'Enter') {
  e.preventDefault()
  if (getHoveredId() !== null) onSelectHovered()
  return
}
```

The normal-mode branch already implements this (`useVimMode.ts:207-212`), so the fix is to mirror it.

**Notes.** Pressing `Escape` first (mode → normal) and then `Enter` works. Most users won't notice — the cheatsheet says Cmd+F "keeps query + highlights" which implies the user might not Escape — and so they'll hit this dead key.

---

## B9 — Search returns un-galaxy-offset coordinates (renderer adds them; non-renderer callers won't)

**Severity.** Minor (contract / docs).

**Repro.**

```
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"main sequence","limit":1}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["results"][0])'
# {'id':..., 'x':-444.6, 'y':-100.9, ...}    <-- local-galaxy coords

curl -s http://127.0.0.1:7373/api/file/2ff264fc026217d9 \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["x"],d["y"],d["galaxyId"])'
# -444.6 -100.9 2

curl -s http://127.0.0.1:7373/api/galaxies \
  | python3 -m json.tool
# galaxy id=2 has originX/originY which the renderer adds via galaxyOffsetById
```

**Expected.** Either document that x/y are pre-galaxy-offset *or* add `galaxyId` to `SearchResult` so consumers can compute the offset themselves.

**Observed.** The `SearchResult` type (`src/shared/types.ts`) is `{id, x, y, score, name, path}` — no galaxyId, no offset hint. The renderer's `App.tsx:271-283` (`projectedHighlights`) handles the offset by joining via `rawStarsById.get(h.id)`, but the search payload alone is insufficient. A non-renderer client (or the renderer on first frame, before `stars` has loaded) would render hits in the wrong place.

**Suspect.** `src/daemon/index.ts:634-641`. Cheap fix: include `galaxyId` in the `SearchResult` (also benefits B2 if pin offsets stay client-side). Or apply the offset server-side and rename the field to make the contract clear.

**Notes.** Audit DB has 1 effective galaxy (`audit-corpus`, originX=originY=0), so this is invisible in the live env. To repro you'd need a multi-galaxy DB — the renderer would still hide it via `galaxyOffsetForStarId`, but the daemon API alone misleads.

---

## B10 — Malformed JSON body returns Express's default HTML stack-trace error page

**Severity.** Cosmetic / info disclosure.

**Repro.**

```
curl -s -X POST http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' \
  -d 'this is not json'
```

**Expected.** A small JSON `{ "error": "invalid JSON body" }` at HTTP 400.

**Observed.** HTTP 400 with a 10-line HTML page exposing a full stack trace including absolute filesystem paths:

```
<!DOCTYPE html>
...
<pre>SyntaxError: Unexpected token 't', "this is not json" is not valid JSON<br>
   at JSON.parse (<anonymous>)
   at createStrictSyntaxError (/Users/hailmary/star-palace/node_modules/body-parser/lib/types/json.js:165:10)
   ...
```

**Suspect.** No JSON-parse error handler installed. Add an Express middleware after `express.json()`:

```ts
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid JSON body' })
  next(err)
})
```

`src/daemon/index.ts:74-76`.

**Notes.** Daemon is bound to 127.0.0.1 so this isn't a remote-attacker concern, but the absolute path leak is still a code smell.

---

## B11 — `GET`/`PUT` to `/api/search` 404 with HTML; should be 405

**Severity.** Cosmetic.

**Repro.**

```
curl -s -X GET http://127.0.0.1:7373/api/search -w "%{http_code}\n"
# 404, body is HTML "Cannot GET /api/search"

curl -s -X PUT http://127.0.0.1:7373/api/search \
  -H 'Content-Type: application/json' -d '{"query":"x"}' -w "%{http_code}\n"
# 404, HTML
```

**Expected.** 405 Method Not Allowed with `Allow: POST` header, JSON body.

**Observed.** Express's default catchall — 404 + HTML.

**Suspect.** Add `app.all('/api/search', ...)` or a router-level 405 handler. Lowest priority of all the bugs here.

**Notes.** Same affects every other endpoint; not search-specific. Surfaced because the audit asked about `/api/search`.

---

## Coverage map — combinations that ran clean

These probes exercised the daemon and produced expected results. Listed so the next reviewer can avoid duplicate work.

### Edge query content

| Input | Result | Notes |
|---|---|---|
| `"a"` (one char) | 200, ranked results | OK |
| `"!!!???"` | 200, top hit `pulsar-09.md` | Punctuation alone embeds and ranks |
| `"<script>alert(1)</script>"` | 200, embeds as text | No XSS storage; results are JSON, no template injection |
| `"' OR 1=1; --"` | 200, treated as text | All SQL queries are parameterised (better-sqlite3) |
| `".*[hello]?"` | 200, treated as text | No regex interpretation |
| `"星座🌟こんにちは"` (CJK + emoji) | 200, top hit relevant | UTF-8 path through Ollama works |
| `"العالم 🌟"` (Arabic RTL + emoji) | 200, results returned | OK |
| `"a" * 1500` | 200, results | Long queries truncated at MAX_TEXT_BYTES (`OllamaClient.truncateText`) |
| `"a" * 1_000_000` | 500, Ollama "input length exceeds the context length" | Surfaced from Ollama, not the daemon |
| `"main sequence " * 500` (~7KB) | 200 in 230ms | Fine |
| `"​"` (zero-width space) | 200, embeds as content | `String.trim()` doesn't strip ZWSP |

### Limit values

| `limit` | Behaviour |
|---|---|
| `1` | 1 result (top hit matches `limit:20`'s top hit ✓) |
| `0` | `{"results":[]}` 200 |
| `1000` | 210 results (corpus cap) |
| `1e10` | 210 (HNSW caps to corpus size) |
| `200001` | 200 with full results — Math.min caps to count=210 first |
| `null` | defaults to 20 |
| (omitted) | defaults to 20 |

### Collection scoping

| Setup | Behaviour |
|---|---|
| `collectionId:1` (5 members) + topical query | Returns ≤5, all members ✓ |
| `collectionId:2` (1 member) + matching query | Returns 1 ✓ |
| `collectionId:3` (0 members) + any query | Returns `[]` ✓ |
| `collectionId:999999` (no such row) | 404 `collection not found` ✓ |
| `collectionId:null` | Treated as no filter ✓ |
| `collectionId:undefined` (omitted) | Same ✓ |
| `collectionId:0` | 404 (no collection has id=0; technically correct, see B7 note) |
| `collectionId:"1"` | Works via SQLite type coercion (see B7) |
| `collectionId:-1` | 404 ✓ |

### State / sequence

| Action | Result |
|---|---|
| Search → identical query → identical query | Stable ordering, identical IDs and scores ✓ |
| Search `limit:1` → search `limit:20` (same query) | Top hit matches ✓ |
| Search → `POST /api/file/:id/tags` → search same query | Identical ranking (tags don't affect query embedding; expected) ✓ |
| Search → `POST /api/file/:id/reindex { strategy: "content-plus-tags" }` → search the tagged terms | Re-ranking visible ✓ |
| Search → `POST /api/relayout` (sync) → 30 parallel searches | All 30 succeed; relayout serialises with searches ✓ |
| 50 parallel searches | All 200; no errors; total wall-time ≈ 670ms ✓ |
| 10 sequential same-query searches | ~25ms each — no internal cache, but no race issue either |

### Renderer / UI flow

These were verified by code review only (the audit instructed best-effort UI testing without browser tools loaded; no MCP browser tools were enabled in this run).

| Sequence | Verdict |
|---|---|
| `Cmd+F` open, type, see results auto-pan to top result | Works (`App.tsx:288-295`) |
| `Cmd+F` open, type, `Esc` | Clears selection + highlights + bar (`App.tsx:329-336`) |
| `Cmd+F` open, type, `Cmd+F` again | Bar hides, highlights persist, mode stays 'search' (`useVimMode.ts:105-111`) |
| `n` / `N` cycle highlights | **Broken in `search` mode — see B12.** Works in `normal` mode. |
| `Enter` while typing in search bar | `handleHideSearch` fires (per cheatsheet) |
| `Enter` after closing bar via `Cmd+F` (mode still `'search'`) | **Does nothing — see B8** |
| `c:audit-mainseq query` | Resolves prefix to `collectionId:1` and filters (`SearchBar.tsx:101-110`); wrong-name shows red `?: name` badge ✓ |

### Things that are intentional (not bugs)

- Tags don't affect rankings until a re-index. `Insert.insertOne` rebuilds the embedding from a strategy-built prompt; before that, the existing vector is stale.
- After pinning, `files.x/y` only changes after the next PCA retrain. This is the documented F4 "incremental drag without retrain" behaviour. The bug in B2 is that `/api/search` doesn't *expose* the pin offset, not that pinning didn't update the layout.
- New file inserts have `layout_version=0` and `x/y=NULL` until the relayouter projects them; search filters out NULL-position rows (`src/daemon/index.ts:633`). Files that show up in the renderer (`/api/map/projection` may include layout_version=0 rows) but not in search aren't broken — they're "still warming up".

### Coverage gaps (out of scope this run)

- **Full-DB testing (~8006 stars at `~/.starpalace/index.db`).** Did not spin up a second daemon — the audit instructions warned that `DAEMON_PORT=7374` may not be honoured, and a second daemon would have required reading more of `src/daemon/index.ts` for env handling. The 210-corpus already reproduces all the bugs above, so the additional run was deferred.
- **30-file maritime corpus (`scripts/build-tiny-corpus-2.mjs`).** Not exercised. The interesting search behaviours (B1, B2, B3, B4, B5, B6, B7) are corpus-size-independent.
- **Mid-relayout DB swap.** The audit suggested probing during relayout — done in a synchronous burst (kicked relayout + 30 searches). Daemon serialises both on the same event loop, so no concurrency bug surfaced. A truly large corpus where relayout takes seconds might expose more.
- **Browser-driven UI exercises.** No `mcp__claude-in-chrome__*` tools were loaded for this run; the keyboard-sequence findings (B8) come from source review of `useVimMode.ts` + `SearchBar.tsx` + `Cheatsheet.tsx`. Verifying B8 in the running app is recommended.
- **HNSW orphan after file deletion.** `HnswIndex` has no `removePoint`; deleted files leave their vectors in the index. Today no `DELETE /api/file/:id` route exists, so the orphan path is unreachable from HTTP. If/when delete lands, search will need to either skip-and-resize-k or learn to mark labels stale.

---

## B12 — `n` / `N` in search-mode types into the input AND pans (added post-agent, main-thread observation)

**Severity.** Serious. The primary keyboard shortcut for stepping through search results is unusable while the search bar has focus — and the cheatsheet documents it as the way to step results. The agent's UI table marked this "works"; live repro contradicts that.

**Repro (verified live in Lost theme on the audit DB):**

1. `gg` to fit-all.
2. `Cmd+F` to open the search bar (mode = `search`, input focused).
3. Type `spore` (≥2 hits).
4. Press `n`. Observe:
   - input becomes `sporen`
   - camera jumps to a hit (vim cycle ran)
   - DetailPanel opens for that hit
5. Press `n` three more times. Observe:
   - input becomes `sporennnn`
   - camera jumps once or twice, then stops updating DetailPanel because the debounced refetch swaps `searchHighlights` mid-cycle.

**Suspect.**

- `src/renderer/src/components/SearchBar/SearchBar.tsx:114-127` — `handleKeyDown` only `preventDefault`s on `Escape` and `Enter`. `n` falls through to the browser's default text-insert path.
- `src/renderer/src/hooks/useVimMode.ts:283-296` — window-level keydown handler. When mode is `'search'` and `searchHighlights.length > 0`, `n` / `N` cycle and `panTo`. `e.preventDefault()` is called here, but the React-controlled input has already accepted the keystroke via its own `onKeyDown` / `onChange` path on the same event.
- The cycle path also fights the SearchBar's debounced refetch (`SearchBar.handleChange`, ~300 ms). While the debounce is pending, the vim cycle reads stale `searchHighlights`; once the refetch resolves, `searchIndexRef.current` indexes a different array.

**Fix sketch.** Intercept `n` / `N` in `SearchBar.handleKeyDown` when there is at least one search hit: `e.preventDefault()` and emit a "step result" callback that the parent wires to the same vim action. Cleanest path — keeps focus on the input and behaves like Cmd-G in browsers.

**Adjacent observation (lower severity, not its own bug).** Query `spore` against the audit DB ranks `red-giant-*` ahead of `neutron-star-*` even though no audit-corpus body actually contains the word "spore" for any star type — the keyword only lives in the Bio drawer's function name (`drawSpores` for `neutron-star`). If the audit corpus is meant to test keyword ranking, the generator should mention "spore" explicitly in the neutron-star bodies.
