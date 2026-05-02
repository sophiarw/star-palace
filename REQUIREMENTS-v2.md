# Star Palace v2 — Feature Requirements

Status: **draft, not yet implemented**. Companion to `REQUIREMENTS.md`. Each
section is independently buildable; recommended sequence at the bottom.

Decisions already locked:
- Pin policy: **pin in embedding-delta** (offset stored in embedding space,
  reprojected onto whichever PC pair is active). Survives PC switch.
- Hover bug + DetailPanel + JWST visuals + 9 manual star types are already
  shipped on `main` (commits `4b03f06`, `ae50d6a`, `cf3999d`).

---

## Summary

| ID | Feature | Effort | Notes |
|---|---|---|---|
| F1 | Search pop + extended zoom + zoom-exposure | XS | Visual only; same-day. | **DONE** |
| F2 | Auto-schema (extension → star type) | S | Renderer fallback only; no DB migration. | **IN PROGRESS** |
| F3 | PC dial (pick X/Y from top-8 components) | M | Layout meta change; no schema for files. |
| F4 | Manual reposition + pin | M | New columns; embedding-delta math. |
| F5 | Virtual collections | M-L | New tables + endpoints + render hull. |
| F6 | Vim mode | M | Pure UI; no backend. | **DONE** |
| F7 | Hierarchical k-means / LOD tree | L | Re-architecture; biggest blast radius. |
| F8 | Procedural per-file graphics | L | Bigger graphics push: every file's visual is hash-derived. |

---

## F1 — Search pop + extended zoom + zoom-exposure

Three trivial renderer-only changes; bundle in one branch.

### F1a — Search pop

When the user runs a search, matched stars must dominate the canvas. Today
non-matches dim to 0.25 alpha and matches keep their normal size — too
subtle on a sky of 18,800 dots.

#### Acceptance

- Non-matches dim to ≤ 0.08 alpha.
- Matches scale to 1.5–1.8× their default sprite size with a brief eased
  pulse (200 ms ease-out) on result arrival.
- Pulse animation triggers once per new search; static state thereafter.
- The existing gold ring (`HIGHLIGHT_COLOR = '#ffe066'`) stays.

#### Implementation surface

- `src/renderer/src/components/StarMap/StarMap.tsx`
  - `DIM_ALPHA` constant: `0.25 → 0.08`.
  - Highlighted-star branch in main pass: scale `drawImage` to
    `sprite × (1.5 + 0.3 * easeOut(pulseT))` for ~200 ms after
    `searchHighlights` changes.
  - Track `searchAnimationStart` ref; reset on each new highlight set.
- No daemon / schema work.

#### Edge cases

- No-results search: behaves as no-search (no dim).
- Selected star that is also a match: scale only once (don't compound with
  hover scale).

#### Out of scope

- Camera zoom-to-fit on search results — already done via existing animation.

### F1b — Extended zoom range

Today `handleWheel` clamps zoom to `[0.05, 10]`. At max zoom the user can
barely read individual filenames in dense regions. Bump the upper bound so
the user can keep zooming until single stars fill the screen.

#### Acceptance

- Wheel-zoom max raised to **100** (was 10). User can scroll into a single
  cluster until each star occupies ~50–100 px on screen.
- Wheel-zoom min stays at 0.05 (already comfortably wider than fit-all).
- Sprite quality stays acceptable at high zoom: bump `MAX_STAR_RADIUS`
  proxy in sprite size buckets so the largest cached sprite is sharp at
  zoom = 100. Concretely: a sixth `SIZE_RADII` entry of ~22 px and a
  zoom-aware draw-time scale that uses larger sprites when `cam.zoom > 4`.
- Label visibility kicks in earlier (currently `cam.zoom > 1.5`); leave as
  is, just confirm labels still read at high zoom (they do — `font-size`
  formula already scales with zoom).

#### Implementation surface

- `src/renderer/src/components/StarMap/StarMap.tsx`
  - `handleWheel`: change `Math.min(10, ...)` to `Math.min(100, ...)`.
  - Optionally add a `cam.zoom > 4` branch in the main pass that picks a
    larger size bucket for crisper rendering. (Cheap: just one extra
    bucket entry; sprite cache absorbs it.)
- `src/renderer/src/components/StarMap/sprites.ts`
  - Append `22` to `SIZE_RADII`.
  - Bump `SIZE_BUCKET_COUNT` constant accordingly.

#### Edge cases

- Pin (F4): drag-to-reposition uses world coords; high zoom should make
  pins more accurate, not break them.
- Backdrop (`background.ts`): renders at 1× viewport size; doesn't pan with
  the camera, so it stays correct at any zoom.

### F1c — Zoom-aware exposure

Today the main star pass uses `globalCompositeOperation = 'lighter'`
(additive). When zoomed out, hundreds of stars project onto each pixel and
their halos sum to pure white — the sky blows out. When zoomed in, the
same stars are spread across many pixels and look dim. Real telescopes
behave the opposite way: zooming in *gains* light (longer exposure per
pixel of subject), zooming out *attenuates* (smaller subject, less light).

Add a single global exposure scalar driven by camera zoom: dim when
zoomed out, brighten when zoomed in. One number, applied as `globalAlpha`
multiplier on the main star pass and the constellation-nebula pass.

#### Math

Map `cam.zoom` (range `[0.05, 100]` after F1b) to an exposure multiplier
in `[0.3, 1.6]`. Logarithmic so it feels even across the wide range:

```ts
const ZOOM_REF = 1.0           // exposure = 1.0 at this zoom
const EXP_MIN = 0.3
const EXP_MAX = 1.6
const exposure = clamp(
  Math.pow(cam.zoom / ZOOM_REF, 0.55),
  EXP_MIN,
  EXP_MAX
)
```

`pow(x, 0.55)` is roughly `sqrt(x)` and gives a perceptually even ramp:
zoom 0.1 → exposure 0.30 (clamped), zoom 1 → 1.0, zoom 10 → 1.6
(clamped), zoom 100 → 1.6. Tunable via the constants.

#### Acceptance

- Zoom out to fit-all: sky no longer blows out; individual cluster blobs
  read distinctly. White isn't pure 255,255,255 in dense regions.
- Zoom in to ~10: brightness comparable to today's "looks right" zoom.
- Zoom in to 100: stars stay readable, halos don't get washed out (sprite
  cache still fine; this is alpha math, not sprite scale).
- Backdrop, edges, decoration (gold rings, white selected core) all
  modulate with the same exposure so the scene stays balanced.

#### Implementation surface

- `src/renderer/src/components/StarMap/StarMap.tsx`
  - Compute `exposure` once per frame from `cam.zoom`.
  - Multiply into `ctx.globalAlpha` for: main star pass, animation overlay
    (pulsar/quasar), nebula pass, edges pass.
  - Skip applying to backdrop image (already pre-baked) — though we may
    want a separate fade-out at extreme zoom-out (constants reserved,
    tune in QA).

#### Edge cases

- Search active: the dim-non-match logic and exposure compose naturally —
  `alpha = matchAlpha * exposure`; no special-case.
- Selected white-core overlay: also multiplied so it doesn't pop unnaturally.
- F4 drag: live-preview drawing uses the same exposure value so the
  dragged star matches its peers.

#### Tuning hooks

Expose `ZOOM_REF`, `EXP_MIN`, `EXP_MAX`, and the `pow(..., 0.55)` exponent
as named constants at the top of `StarMap.tsx` so we can tune without
diving into the draw loop.

#### Out of scope

- HDR / tone-mapping (real Reinhard / ACES). Single linear scalar is
  enough for now.
- Per-cluster exposure (some constellations dimmer than others).
- User-facing exposure slider (could ship as a follow-up if the auto curve
  feels wrong).

---

## F2 — Auto-schema (extension → star type)

### Goal

Without manual tagging, certain file types should still look distinct.
Powerpoints feel like pulsars; CSVs feel like white dwarfs; etc.

### Behavior

- Default star type is computed from `mimeType` + filename extension at
  render time (no DB write). Manual `star_type` (set via DetailPanel /
  daemon endpoint) overrides.
- Table (initial; tweak before ship):

  | Match | Default type |
  |---|---|
  | `.pptx` `.ppt` `.key` | `pulsar` |
  | `.pdf` (mimeType startsWith `application/pdf`) | `quasar` |
  | `.csv` `.tsv` | `white-dwarf` |
  | `.json` `.yaml` `.yml` | `neutron-star` |
  | `.zip` `.tar` `.gz` | `black-hole` |
  | Image media (`mimeType` startsWith `image/`) | `nebula` |
  | `.md` `.markdown` | (none — uses cluster hue) |
  | code (`category === 'code'`) | (none — cluster hue) |
  | else | (none) |

### Implementation surface

- New helper: `src/renderer/src/components/StarMap/autoStarType.ts`
  - `defaultStarType(name, mimeType, category): StarType | null`
- StarMap main pass: `const effective = star.starType ?? defaultStarType(...)`.
- DetailPanel star-type chip should label "Default → Pulsar (from .pptx)" so
  the user understands what they'd be overriding.

### Acceptance

- Open a PowerPoint — sees pulsar visuals without tagging.
- User overrides to `red-giant` via dropdown — visuals change, persists.
- User clears override — reverts to pulsar (the auto-default), not plain
  cluster hue.

### Out of scope

- DB backfill / `star_type` column writes.
- User-editable rules (could be F2.1 later).

---

## F3 — PC dial

### Goal

Today the layout uses PC1 × PC2. Different PC pairs surface different
structure. Let the user flip axes.

### Behavior

- PCA training computes top **8** components (was 2). Top-2 stays the
  default for back-compat.
- New UI control (top-right corner, near search): two dropdowns "X = PC1"
  "Y = PC2"; on change, all stars reproject and the canvas re-fits.
- Choice persists in `localStorage` — comes back on reload.
- Reprojection is client-side: daemon ships all 8 PCs once; client computes
  `x = embedding · pcX, y = embedding · pcY` for each star on selection.

### Data model

- `clusters` and per-file `cluster_id` are PC-pair-independent — they cluster
  on the full embedding, not the projection. No change.
- `layout_meta.projection_model` JSON grows `components: number[][]` (8 ×
  768) and `mean: number[]` (768). Bump `LAYOUT_VERSION` constant; existing
  `pca_v1` rows ignored (or auto-upgraded by re-running training once).
- `files.x`, `files.y` are the **default** projection (PC1×PC2). For F3
  alone we don't need to change them per-axis; the renderer recomputes on
  the fly when the dial is moved.

### Pca.ts changes

- `StarPca.train(embeddings)` — keep top-K (K=8).
- `pca.project(embedding, axisX, axisY)` — dot with selected components.
- `pca.serialize()` — include `componentCount` + 8×D matrix.

### API changes

- `GET /api/map/all` payload grows: include the projection matrix or expose
  it via `GET /api/map/projection`. Renderer caches it.
- The current `Star.x` / `Star.y` stay (default projection).

### Conflict with F4 (pin)

- Pin stores embedding-delta (see F4); reprojected onto whatever axes are
  active. F3 alone is safe; F3 + F4 needs the delta math from F4.

### Acceptance

- Dial both axes to PC3, PC5 → see different structure.
- Refresh page → comes back at PC3, PC5 (localStorage).
- Search results still highlight correctly post-reproject.
- `npm run dev:daemon` doesn't break for users on the old PCA model — auto
  upgrade or a one-time `relayouter.train()` migration.

### Effort

- Pca.ts + Relayouter wire-up: medium.
- UI dial + caching projection client-side: small.
- Migration: small (one extra `train()` call on startup if `componentCount < 8`).

---

## F4 — Manual reposition + pin (embedding-delta policy)

### Goal

User drags a star to a new spot in the sky. That position is permanent
(survives daemon restart, layout retrains, PC switches). The embedding
remains unchanged so semantic search still works.

### Pin policy (locked)

**Embedding-delta**: a pin records `Δembedding ∈ R^768` such that when
projected, it produces the user's desired offset from the file's natural
projected position. On any PC pair (X, Y):

```
displayed_x = (embedding + Δ) · pcX = (embedding · pcX) + (Δ · pcX)
displayed_y = (embedding + Δ) · pcY = (embedding · pcY) + (Δ · pcY)
```

So we don't store `Δ` directly; we store `(targetX, targetY, axisX, axisY)`
at the time of pinning, then **solve for Δ** in the 2-component subspace at
pin time and persist the 2 scalar coefficients.

Concretely: at pin time, the user wants `(targetX, targetY)` while axes
`pcA`, `pcB` are active. We need `Δ = α·pcA + β·pcB` such that
`Δ·pcA = targetX − naturalX` and `Δ·pcB = targetY − naturalY`. Since
PC vectors are orthonormal, `α = (targetX − naturalX)`, `β = (targetY − naturalY)`.

Persist `(α, β, axisA_idx, axisB_idx)`. On any future PC pair (X, Y):

```
Δ·pcX = α(pcA · pcX) + β(pcB · pcX) = α[A==X] + β[B==X]
```

That is, the offset only manifests on axes that were active at pin time. On
unrelated PC axes the displayed position equals the natural projection (no
offset). User-visible meaning: "I pinned this in the PC1×PC2 view; on
PC3×PC4 the file is back where the math says it should be."

This is the cleanest interpretation and avoids fabricating offsets in
unrelated dimensions.

### Schema

```sql
ALTER TABLE files ADD COLUMN pin_alpha   REAL;     -- offset coef on pin_axis_a
ALTER TABLE files ADD COLUMN pin_beta    REAL;     -- offset coef on pin_axis_b
ALTER TABLE files ADD COLUMN pin_axis_a  INTEGER;  -- 0..7, PC index
ALTER TABLE files ADD COLUMN pin_axis_b  INTEGER;
ALTER TABLE files ADD COLUMN pinned_at   INTEGER;  -- unix ms; null = not pinned
```

Reuses the existing `is_pinned` (boolean) for the user-visible "pinned"
toggle, but the offset math lives in the new columns.

### Behavior

- Drag a star (mousedown on hovered star + drag): live preview updates as
  the user moves the cursor.
- Release → POST `/api/file/:id/pin` with `{ targetX, targetY, axisA, axisB }`.
- Daemon computes `α, β`, stores, and `is_pinned = 1`.
- Unpin via DetailPanel button → POST `/api/file/:id/unpin`; clears all 5
  columns.
- Relayouter: on retrain, **does not** overwrite `x, y` for pinned files —
  reads pin coefficients and applies the offset to the natural projection.
- The `Star.x, Star.y` returned to the renderer is always the *displayed*
  position (natural + offset). Renderer doesn't need to know about pin
  internals; it just gets correct coordinates.

### Daemon endpoints

- `POST /api/file/:id/pin` — body `{ x, y, axisA, axisB }`. Returns
  `{ ok: true, alpha, beta }`.
- `POST /api/file/:id/unpin` — clears.

### Renderer changes

- `StarMap.tsx`: long-press or shift+drag on a star initiates a drag; on
  release, calls the pin API + optimistically updates `star.x, star.y`.
- DetailPanel: "Pinned" badge; "Unpin" button when pinned.

### Edge cases

- Drag while no PCA model trained → reject (not enough embeddings yet).
- Pin a file whose embedding is null (binary/media without text) — allow;
  `naturalX = naturalY = 0` so `α = targetX`, `β = targetY`.
- F3 axis switch: verify the pin only manifests on its `(axisA, axisB)`.
- Re-pin: overwrite previous pin atomically.

### Search

Embedding is unchanged. ANN search results are unchanged. Pin only affects
*display* — pinned files still appear at their pin position when displayed
in the relevant PC pair.

### Acceptance

- Drag star A to coordinate (200, 200). Restart daemon. Star A still at
  (200, 200).
- Switch to PC3×PC4. Star A appears at its natural PC3×PC4 position (no
  pin offset).
- Switch back to PC1×PC2. Star A back at (200, 200).
- Search for content matching star A — it appears in results, ranked the
  same as if unpinned.

---

## F5 — Virtual collections

### Goal

User says "everything about magnets" or "all my pitch decks". Result is a
named, persistent group of files visible in the sky as its own constellation,
listed in a sidebar, and searchable by name.

### Two flavors (both supported)

1. **Static collection** — explicit list of file IDs. Add/remove members
   manually or "save current search results as collection".
2. **Dynamic collection** — saved query string + optional similarity floor.
   Membership re-evaluated on demand (button) and cached. The user sees a
   "stale (last evaluated 3h ago)" badge if embeddings have changed since.

### Schema

```sql
CREATE TABLE collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL CHECK (kind IN ('static','dynamic')),
  query       TEXT,            -- non-null for dynamic
  similarity_floor REAL,       -- non-null for dynamic; default 0.6
  color_index INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  evaluated_at INTEGER         -- last time membership was computed (dynamic)
);

CREATE TABLE collection_members (
  collection_id INTEGER NOT NULL,
  file_id       TEXT NOT NULL,
  added_at      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, file_id)
);
CREATE INDEX idx_cm_file ON collection_members(file_id);
```

### Behavior

- Search bar gains a "Save as collection" button on results screen.
- New "Collections" sidebar (toggle via `c`/leader-c if F6 lands; otherwise
  a small button bottom-left). Lists collections with member count and
  color chip. Click → highlights members in the canvas (treat like search
  results: dim non-members, bright members, gold edge ring per F1).
- Right-click member → "Remove from collection".
- Dynamic collections show "Refresh" button → re-runs the query, diff
  against current members (additions in green, removals in red for 5 s,
  then settled).

### Hull rendering

- Each collection gets a constellation-style outline (convex hull of member
  positions) drawn in its `color_index`-derived hue, with the name centered.
- Static and dynamic visually identical; dynamic gets a tiny "↻" glyph
  next to the name.

### Daemon endpoints

- `GET /api/collections` — list all.
- `POST /api/collections` — body `{ name, kind, query?, similarityFloor?, fileIds?, colorIndex? }`.
- `GET /api/collections/:id` — detail with member ids.
- `POST /api/collections/:id/members` — body `{ fileIds: string[] }` (static add).
- `DELETE /api/collections/:id/members/:fileId`
- `POST /api/collections/:id/refresh` — for dynamic; re-runs query, replaces
  members. Returns `{ added: string[], removed: string[] }`.
- `DELETE /api/collections/:id`

### Search integration

- Free-text search box already returns nearest neighbors. Add a second
  axis: typing `c:foo` (or `#foo` if we want hashtag) filters to members of
  collection `foo` *first*, then ranks by embedding similarity.
- Renderer treats collection-active state the same way as a search active
  state for the F1 dim/scale logic.

### Acceptance

- Save 5 search results as a collection named "magnets". Reload page.
  Collection still in list, members highlighted on click.
- Create dynamic collection from query "investor pitch deck", refresh in a
  week — picks up newly indexed pitch decks.
- Delete collection — files unaffected (only the membership rows go).

### Edge cases

- Dynamic refresh while query embedding API down: return 503; UI shows
  "refresh failed".
- Renaming: `UNIQUE(name)`; reject conflicts with 409.
- Collection of size 1 or 0: hull renders as a circle around the single
  point or a label-only marker.

---

## F6 — Vim mode

### Goal

User wants to drive the entire app from the keyboard.

### Modes

- **Normal** (default): navigation + commands.
- **Search**: typing in the search box.
- **Visual**: rectangle selection (drag without releasing or `v` + hjkl).
- **Command**: `:` opens a command palette (rename collection, set type, etc).

### Bindings (initial)

| Key | Mode | Action |
|---|---|---|
| `h` `j` `k` `l` | normal | Pan camera (1 viewport step / multi-press for momentum) |
| `H` `J` `K` `L` | normal | Pan 4× |
| `+` `-` (or `=` `_`) | normal | Zoom in/out |
| `gg` | normal | Fit all stars |
| `gh` | normal | Fit current cluster |
| `gc` | normal | Fit current collection (if active) |
| `/` | normal → search | Focus search bar |
| `Esc` | any | Back to normal / close panel |
| `n` `N` | normal | Next / prev search result (cam pan) |
| `Enter` (on hovered star) | normal | Select (open DetailPanel) |
| `o` (on selected) | normal | Open in default app |
| `t` | normal | Open star-type dropdown for selected |
| `T` (capital) | normal | Cycle through types forward |
| `p` | normal | Pin the selected star at current screen position |
| `u` | normal | Unpin |
| `c` | normal | Toggle collections sidebar |
| `:` | normal → command | Command palette |
| `?` | normal | Show keymap cheatsheet (overlay) |

Visual mode (after F4 / F5 land):
- `v` start rect select; `hjkl` extend; `y` "yank" → save selection as
  collection (prompt for name); `t<type>` set star_type for all selected.

### Implementation

- `src/renderer/src/hooks/useVimMode.ts` — single keydown listener, mode
  state machine, dispatches to actions.
- `src/renderer/src/components/Cheatsheet/Cheatsheet.tsx` — **persistent
  side panel** (left or right edge), NOT a transient overlay. Required
  because F6 departs from vim orthodoxy in places (notably `y` =
  save-as-collection rather than yank-paths). Keep the cheatsheet visible
  by default so the user doesn't have to memorize the deltas. Toggle hide
  via `?`. Compact, mono font, two-column.
- Existing `<input>` elements (search bar) need to suppress global key
  handling; use `e.target instanceof HTMLInputElement` guard.

### Acceptance

- Disable mouse, drive the entire flow: search → fit results → next/prev →
  open detail → set type → open file. Smooth.

### Out of scope

- Multi-keystroke recording / macros.
- Custom keybinding config (lands later).
- Modal indicator UI element (just status text in `StatsBar`).

---

## F7 — Hierarchical k-means / LOD tree

### Goal

Currently the cluster set is flat: a few dozen disks. With 18,800 files, a
single level isn't enough — the user needs to drill in. Hierarchical
clustering gives a tree (root: 4–8 mega-clusters; each splits into child
clusters; leaves are individual files).

### Algorithm

- **Recursive bisection** on embeddings using k-means with k=2 (or k=4 for
  shallower tree). Stop when subtree size < `LEAF_THRESHOLD` (default 30).
- Tree depth typically 6–10 for 18,800 files.

### Render LOD

- World-space radius of a cluster scales with `sqrt(memberCount)`.
- At a given camera zoom, a cluster is *expanded* if its radius on screen
  exceeds `EXPANSION_PX` (default 80 px); otherwise it renders as a single
  blob with member count.
- Zoom in → top-level mega-clusters expand into their child clusters; child
  clusters expand into grandchildren; eventually individual stars.

### Schema

```sql
CREATE TABLE cluster_tree (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id     INTEGER REFERENCES cluster_tree(id),
  depth         INTEGER NOT NULL,
  member_count  INTEGER NOT NULL,
  centroid_x    REAL,
  centroid_y    REAL,
  centroid_emb  BLOB,         -- 768-float32, for label-on-demand search
  color_index   INTEGER NOT NULL,
  label         TEXT          -- LLM-generated or null
);

ALTER TABLE files ADD COLUMN tree_node_id INTEGER REFERENCES cluster_tree(id);
```

The current flat `clusters` table can stay for compatibility; `tree_node_id`
is the leaf assignment. Top-level mega-clusters can be reconstructed by
walking up from a file's `tree_node_id`.

### API

- `GET /api/tree` — returns the full tree (all nodes; ~few thousand at
  worst). Renderer caches.
- `GET /api/tree/:nodeId/members` — paginated.
- `POST /api/tree/relabel` — kick off label generation (LLM, async; out of
  v1 scope).

### Renderer

- `StarMap.tsx` traverses tree top-down each frame. For each node, decide
  expand-or-blob based on screen radius. Drawing budget: ≤ 200 visible
  blobs/clusters at any time (cull rest).
- Cluster blobs animate (smooth interp) when they expand/collapse on zoom.

### Migration

- One-shot `relayouter.trainHierarchy()` after deployment. Runs k-means
  recursively. ~30 s for 18,800 × 768 embeddings.
- Old `clusters` table preserved; the renderer toggles flat-vs-tree via a
  query string `?clusters=tree` until tree is the default.

### Out of scope (v1)

- Auto-labels via LLM.
- User-editable tree (drag a file to a different node).
- Cross-PC-pair tree consistency (tree is computed in embedding space, so
  it's automatically PC-pair-invariant — but visual layout of nodes
  depends on the active PC pair via centroid projection).

### Acceptance

- Zoom out to fit-all → see ~6 mega-clusters, named or numbered.
- Zoom in on one → smoothly expands into child clusters.
- At max zoom, individual stars visible.
- Switching PC pair (F3) re-projects tree nodes; structure unchanged.

### Effort

- Largest of the seven. Estimate: 1–2 weeks.

---

## F8 — Procedural per-file graphics

### Goal

Every file in the sky should look genuinely unique. Today the visual
identity comes from cluster hue + temperature jitter + size bucket — about
120 distinct sprites for 18,800 files. F8 layers procedurally-generated
detail on top so that two files in the same cluster + same size still look
different. The procedural variation derives from a deterministic hash so
the same file always looks the same.

### Decisions locked

- **Seed source**: `Star.id` (FNV-1a 32-bit hash already exists as
  `hashStr` in `sprites.ts`). Same id → same look forever; renames /
  content edits don't reroll.
- **Cache strategy**: LRU per-file sprites, cap **500 entries**. On
  eviction the next render rebuilds. Bucket sprites continue to handle
  the common case (off-screen / tiny on-screen stars).
- **Scope**: applies to all four surfaces — typed-star sprites
  (F8a), default cluster-hue stars (F8b), cluster nebulae (F8c), and a
  brand-new deep-zoom planet view (F8d).

### Seed plumbing

A small RNG helper, deterministic and cheap:

```ts
// src/renderer/src/components/StarMap/proc.ts
export function seedFromId(id: string): () => number {
  let s = hashStr(id) >>> 0
  return () => {                          // mulberry32
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

All procedural draws sample from `rng()` so the visual is purely a function
of `id`.

### F8a — Typed-star instance variation

Each typed sprite (red giant, blue supergiant, …, nebula) currently has a
single canonical look. Add a per-id seed so that two red giants don't look
identical:

- Rotation: `rng() * 2π` for the dominant axis (jets, spikes, halo squish).
- Halo squish: `0.7 + rng() * 0.6` for the elliptical eccentricity.
- Spike count for "spiky" types (blue supergiant, neutron star): pick from
  `[6, 8]` weighted by `rng()`. Pulsar's beam tilt also rng-seeded.
- Color jitter: ±8% hue shift inside the type's palette so deep reds vs
  more orange reds, etc.
- Nebula type: 2–4 filament arms, lengths and hues seeded.
- Black hole: accretion ring tilt and ring-thickness seeded.
- Binary: separation distance and core size ratio seeded.

#### Implementation surface

- `sprites.ts`: extend `getTypedStarSprite(type, sizeBucket)` →
  `getTypedStarSprite(type, sizeBucket, starId)`. Cache key adds a 12-bit
  hash of the id (so we don't get one entry per file but one per ~4096
  variants per type). At ~9 types × 7 sizes × 4096 hashes that's an
  intentionally-bounded space — but the LRU cap controls the working set.
- StarMap callers pass `star.id` through.

### F8b — Default cluster-hue micro-jitter

Today default stars vary on (cluster_color, temp_bucket, size_bucket) →
~120 sprites. Layer micro-detail on top:

- Per-id rotation: 0–2π applied at draw time via `ctx.rotate`. No new
  sprite needed; just rotate the cached sprite.
- Per-id alpha jitter: ±10% on the global brightness. Some stars
  brighter than others within the same bucket.
- Per-id micro-spike-count: half of stars get the 6-spike variant, half a
  4-spike variant (where the second is a new sprite generation path —
  cached on `(colorIndex, tempBucket, sizeBucket, spikeVariant)`,
  doubling the bucket count from 120 → 240, still small).

The drawn sprite stays bucket-keyed; the variation comes from runtime
rotation + alpha multiplied per id. This avoids expanding the sprite cache.

### F8c — Procedural cluster nebulae

Today each cluster's blob is a 4-stop radial gradient with deterministic
elliptical squish from `cluster.id`. Replace with a procedural shape:

- Worley/voronoi noise for filament structure.
- 2–3 internal hot spots (smaller bright cores embedded in the blob).
- 1–3 dark dust lanes carved with negative-blend strokes.
- Color: cluster's palette hue + a complementary accent at the rim.
- Per-cluster seed = `cluster.id` (not file id); blob is fixed per
  cluster.

#### Render strategy

Pre-render each cluster's nebula to an offscreen canvas keyed on
`(cluster.id, nebulaResolution)`. Re-render only when memberCount changes
substantially (every 20% delta). Drawn at world-space size (scales with
zoom) like today.

### F8d — Deep-zoom planet view (NEW)

When a single star occupies more than ~80 px on screen (i.e. user zoomed
in tight), switch from "star sprite" to "planet disc" rendering. Each
file becomes a unique procedurally-rendered planet.

#### Threshold

`screenRadius = spriteCoreRadius(sb) * scale > 80` → planet mode.
At `cam.zoom = 100` (the F1b max) this triggers for any file.

#### Planet generation

Per-id seeded:

- **Disc color palette**: 3–5 colors. Half the time pull from the
  cluster's hue family; half the time roll randomly within "habitable"
  visual ranges (terrestrial blues/greens/browns, gas-giant bands,
  ice whites, lava reds).
- **Surface pattern** (one per id, seeded):
  - *Terrestrial*: voronoi continents over base ocean color.
  - *Gas giant*: horizontal banded perlin noise; Jupiter-style.
  - *Ice*: low-saturation marble pattern.
  - *Lava*: cracks via reaction-diffusion (cheap pre-baked variant).
  - *Cratered moon*: random circles via Poisson disc sampling.
- **Atmosphere ring**: faint glow on the limb, color-complementary to
  surface.
- **Optional** (post-MVP): rings (à la Saturn), small moons orbiting.

#### Render surface

- New `src/renderer/src/components/StarMap/planet.ts` with
  `renderPlanet(starId, radiusPx): HTMLCanvasElement`.
- LRU cache, cap 500. Sized by current screen radius rounded to a few
  steps (e.g. 64, 128, 256 px) so we don't generate one canvas per pixel.
- StarMap main pass: when planet mode triggers, swap `getStarSprite` →
  `renderPlanet`.

#### Rotation

Planet appears to spin slowly. Per-frame `ctx.rotate` at draw time;
angular velocity seeded per id (some planets faster, some retrograde).
Only animates when in planet mode (cardinality is small at deep zoom).

### LRU cache (cross-cutting)

Single shared LRU at the top of `sprites.ts` (or a new
`spriteCache.ts`):

```ts
class LRUSpriteCache<K> {
  constructor(public cap: number) { ... }
  get(key: K): HTMLCanvasElement | null { ... }
  set(key: K, sprite: HTMLCanvasElement): void { ... }
}
```

- F8a: 500-entry cap shared across all typed-star variants.
- F8c: separate cluster-nebula cache, cap = cluster count (~40), no
  eviction needed.
- F8d: 500-entry cap, separate (planet sprites are bigger memory).
- F8b: NO cache (rotation/alpha applied at draw time on existing buckets).

Total max memory: ~500 × 64 KB (typed) + ~500 × 256 KB (planets) +
~40 × 64 KB (nebulae) ≈ 160 MB. Tunable.

### Acceptance

- Two red giants in different files visibly different (rotation, halo
  squish, hue jitter).
- Cluster nebulae look like real nebulae — wisps and dust lanes — not
  perfect ellipses.
- Same file, opened twice with daemon restart: identical visuals.
- Zoom in past `cam.zoom > ~30` on a single star → smooth transition
  into a unique planet disc with surface pattern.
- Steady 60 fps at default zoom (cache stays warm).
- Memory steady-state under ~200 MB renderer-side.

### Edge cases

- Star with no cluster (`clusterId === null`): use the random-roll path
  for planet palette.
- Files with no embedding (binary/media): same procedural path applies;
  visual still derived from `id`.
- Cache thrash on rapid zoom oscillation: LRU should absorb; if not, add
  a "warm zone" of sticky entries.

### Out of scope (v1 of F8)

- Animated cloud bands on planets (just rotation for now).
- Per-cluster "galactic" rendering (spiral arms vs elliptical galaxy
  morphology) — could be a follow-up.
- WebGL shader path. F8d via canvas2d should be tractable; if perf
  fails, revisit on the 3D branch.
- User-customisable seed override (e.g. "let me re-roll this file's
  look"). Keep deterministic.

### Effort

Largest visual feature in v2 — comparable to F7 in scope. Recommend
splitting into commits:

1. F8a — typed-star variants (1 day)
2. F8b — default-star jitter (½ day)
3. F8c — procedural cluster nebulae (1 day)
4. F8d — deep-zoom planet view (2–3 days; the surface shaders carry
   most of the work)

---

## Cross-cutting concerns

### Backwards compatibility

- All schema changes additive (no drops). Daemon migration runs idempotently
  on startup. Existing 18,800-row DB upgrades in place.
- Renderer feature flags via query string (`?renderer=`, `?clusters=`,
  `?vim=`) so each feature can be enabled independently for testing.

### Tests

Each feature ships:
- daemon-side endpoint test in `tests/api/contract.test.ts` (note: this
  file currently SIGSEGVs under vitest — pre-existing — so tests must run
  cleanly under `npm run test` despite that limitation).
- DB-side round-trip in `tests/api/FileIndex.test.ts`.
- Renderer logic tested via unit tests on extracted helpers
  (`autoStarType.ts`, `pinMath.ts`, `useVimMode.ts`).

### CLAUDE.md compliance

Every commit gates on `npm run typecheck && npm run lint && npm run test`.
Conventional Commits (`feat`, `fix`, `refactor`, `chore`).

---

## Recommended sequencing

1. **F1 + F2** (one branch, one PR) — small, immediate user-visible gain.
2. **F3** — unlocks F4. Self-contained.
3. **F4** — depends on F3 for the multi-PC-aware embedding-delta math.
4. **F5** — depends on nothing else; can also slot in parallel to F3/F4.
5. **F6** — independent; nice once F1–F5 land so there's enough surface to
   bind keys to.
6. **F7** — last; biggest scope; benefits from the tree visualization
   making the rest of the UI more useful.

Each phase = its own feature branch off `main`, merged on green CI.

---

## Open questions

- **F2 schema**: defaults are opinionated. User should review the table and
  swap any types they dislike before we ship.
- **F5**: dynamic collections refresh policy — manual button only (current
  spec) or automatic on every layout retrain?
- **F6**: clipboard yank/paste analog? (`y` already used for "save
  selection as collection".)
- **F7**: leaf threshold — 30 feels right but might need tuning at scale.
