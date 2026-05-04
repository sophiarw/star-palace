# Graphics test bed

Lightweight scaffold for visually auditing the StarMap renderer against the
original pitch deck (`docs/three-new-themes/`). It materialises a small
deterministic corpus, points an isolated daemon at it, and lets you cycle
the five themes side-by-side with the deck without touching your main DB.

This was built during the F-NEXT graphics-rework follow-up audit
(`docs/audit-2026-05-03/findings.md`) and promoted to a permanent test bed
so future regressions can be caught the same way.

## What it gives you

- 10 star types × 21 variants = 210 files (over the `LAYOUT_THRESHOLD`, so PCA
  trains on first index and every star gets a position).
- Each file is named `<star_type>-<NN>.md`, so the seed script can deterministically
  assign types from the filename — no manual mapping.
- A throwaway DB at `~/.starpalace-audit/` so your real corpus is untouched.
- The deck served at `http://localhost:8181/three-new-themes/index.html`
  for an A/B compare.

## Pieces

| File | Role |
|---|---|
| `scripts/build-audit-corpus.mjs` | Writes `audit-corpus/` (210 .md files). Idempotent. |
| `scripts/seed-audit.ts` | Indexes `audit-corpus/` via `/api/index`, forces a relayout, assigns star types from filenames. Polls `/api/map/stats` since indexing is async. |
| `scripts/dev-audit.sh` | One-shot wrapper: kills any daemon on :7373, sets `STARPALACE_DIR=$HOME/.starpalace-audit`, builds corpus, starts daemon, runs seed. |
| `src/shared/auditCorpus.ts` | Single source of truth for `AUDIT_PER_TYPE`, `AUDIT_TOTAL`, and `parseAuditCorpusType()`. |
| `tests/graphics/auditCorpus.test.ts` | Vitest spec validating the parser + constants + (when present) the corpus directory. |

## Workflow

```bash
# Bring up the audit DB (kills any existing daemon on :7373)
bash scripts/dev-audit.sh

# In another shell — renderer talks to the audit daemon on :7373
npm run dev:web

# Reference deck served separately so you can A/B compare
( cd docs && python3 -m http.server 8181 )
# → open http://localhost:8181/three-new-themes/index.html
# → open http://localhost:5173/
```

Cycle themes from the StatsBar dropdown in the renderer; cycle deck slides
with the digit keys (`3`–`7` map to the five theme slides).

## Re-pointing the renderer at the real DB

`dev-audit.sh` only changes the *daemon's* `STARPALACE_DIR`. To return to
your main DB:

```bash
# Kill the audit daemon
lsof -ti :7373 | xargs kill

# Start a normal daemon (no env override = ~/.starpalace/)
npm run dev:daemon
```

The renderer doesn't care which daemon is on :7373; it picks up the new one
on the next request.

## Extending it

- **More star variants per type** — bump `AUDIT_PER_TYPE` in
  `src/shared/auditCorpus.ts` and in `scripts/build-audit-corpus.mjs`.
  The test enforces they stay in sync.
- **Different content per type** — edit the `TYPES` table in
  `scripts/build-audit-corpus.mjs`. Embedding non-degeneracy is what makes
  PCA produce 10 distinct constellations; keep the keyword + summary lines
  type-specific.
- **Visual regression snapshots** — not yet wired in. Candidate path:
  drive the renderer via `mcp__claude-in-chrome__*` or Playwright,
  screenshot each theme at a fixed zoom + center, diff against
  `docs/audit-2026-05-03/<theme>/app.png` baselines. Feed the daemon
  via `STARPALACE_DIR=$HOME/.starpalace-audit` so the layout is
  deterministic.
- **Search stress-test** — independent track tracked separately
  (`docs/audit-2026-05-03/search-bugs.md` once it lands).

## Why 210 and not 10

A "minimal" 10-file corpus would be cleaner conceptually, but
`LAYOUT_THRESHOLD = 200` (`src/shared/types.ts`) means PCA refuses to train
on fewer than 200 embeddings. Without a layout, every star has
`x = y = NULL` and the renderer skips them. 21 variants per type is the
smallest multiple that crosses the threshold with margin.

If we ever lower the threshold for testing, drop `AUDIT_PER_TYPE` to match
and update the constants test.
