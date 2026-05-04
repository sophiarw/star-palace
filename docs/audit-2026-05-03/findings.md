# Graphics audit — 2026-05-03

Reproduced against:
- App: `http://localhost:5173/` running with `STARPALACE_DIR=$HOME/.starpalace-audit` (210 files, 10 star_types × 21 variants).
- Deck: `http://localhost:8181/three-new-themes/index.html` (slides 3–7 cover the 5 themes).

Screenshots from the diagnostic run live in this folder, one subdir per theme. Each entry below names a deck slide and a corresponding app screenshot ID from the Chrome MCP capture.

## 1 — Background: three giant unblended ellipses

**Symptom (reproduced).** Hard-edged grey ovals span the canvas under the star clusters. Visible in every theme to varying degrees, **glaring in Bioluminescent and Lost in space** (bright/light backgrounds pull them out). Each ellipse is a flat translucent grey wash with a sharp rim — no feather.

**Reference.** Deck slide 7 (Bio) shows soft overlapping bokeh circles in the BG, but they're feathered and dim; they read as ambient haze, not as hard cells. The deck does not show three giant rims at all.

**Suspect.**
- `src/renderer/src/components/StarMap/background.ts:99-122` — galaxy ellipses drawn with `ctx.scale(1, ry/rx); ctx.arc(0, 0, rx*2.2, 0, Math.PI*2)`. The radial gradient inside has no feather and the scaled arc has no `destination-out` mask. Hard rim.
- `src/renderer/src/themes/bio/background.ts:46` — bare `ctx.ellipse()` with the same problem.
- The pattern that does work: `src/renderer/src/components/StarMap/backgroundNebula.ts:99,213-219` uses `ctx.clip()` plus a feathered `destination-out` mask.

**Fix sketch.** Port the `backgroundNebula` feather pattern into `StarMap/background.ts` and `bio/background.ts`. Either add a `destination-out` rim pass with a soft inner-stop, or wrap the gradient in a clipped feather.

## 2 — Bioluminescent: cores transparent, no creature detail

**Symptom (reproduced).** At fit-all view (210 stars), creature sprites read as fluffy grey/cream popcorn — anemone, jellyfish, mantaray silhouettes are not legible. At deeper zoom the silhouettes emerge but cores are translucent, not the saturated yellow / green / pink of the deck.

**Reference.** Deck slide 7. Anemone has a bright opaque yellow core with hard tendrils. Jellyfish bell glows green and the bell rim is sharp. The deck's softness is *only* in the BG bokeh; subjects are crisp.

**Suspect.**
- `src/renderer/src/themes/bio/drawers.ts:68-70` — `softBlob` helper with α range 0.35–0.9. Outer-band α is fine; inner gradient stops never reach 1.0.
- `applyCircularFade` calls at lines 519, 524, 529, 534, 539, 544, 549, 554 with `innerStop=0.7` or `0.78` — fade kicks in too far into the sprite, eroding the core.

**Fix sketch.** Raise `softBlob`'s inner gradient stop to α=1.0 so the core is fully opaque. Bump `innerStop` to ≥0.82 on creature drawers so the opaque region holds out further before the fade.

## 3 — Lost in space: hazy halos, washed gamma, blurred

**Symptom (reproduced).** Every cluster sits inside a bloomed soft halo (warm/cool washes per cluster) that consumes much of the figure detail. Astronaut/ship/rocket figures within are tiny white pixel groups, not the crisp illustrated characters of the deck.

**Reference.** Deck slide 6. Astronaut, rusty ship, rocket, satellite, asteroid cluster, lighthouse, twin spacewalkers, jellyfish, wormhole, debris. Each character is a recognisable hard-edged figure on a clean star background — no per-figure halo at all.

**Suspect.**
- `src/renderer/src/themes/lost/index.ts:11-25` — no `smoothing: 'high'` set. Default smoothing makes raster sprite scaling fuzzy.
- `src/renderer/src/themes/lost/drawers.ts:440-480` — `applyCircularFade(..., 0.85)` across 11 calls. Combined with low DPR + soft-edge canvas smoothing this gives the halo halo.
- `themes/lost/background.ts:40-45` — sparkle alpha `0.3 + rng()*0.5`. Compounding background noise with foreground halos = washed gamma.
- Gradient α stops in figures (e.g. lighthouse beam `lost/drawers.ts:224-225` `rgba(255,180,90,0.9) → 0`, jellyfish bell `:253-256` `rgba(155,124,216,0.75) → 0`) — the deck uses similar α stops but bakes at higher DPR, which keeps subpixel edges crisp; here they go fuzzy.

**Fix sketch.** Set `smoothing: 'high'` on lost theme. Raise `applyCircularFade` `innerStop` to 0.9. Don't change figure gradients; the renderer DPR fix (issue #6) should do the work.

## 4 — Atari low-res: low contrast, halo bleed

**Symptom (reproduced).** Each cluster is wrapped in a soft white/grey halo that breaks the 8-bit no-transparency aesthetic. Sprites at the cluster centre are recognisable pixel-style "+" shapes but the rim around them is anti-aliased — and the saturated red/orange/cyan palette is muted.

**Reference.** Deck slide 5. Solid concentric red→orange→yellow bands on red-giant; hard-edged blue concentric on blue-supergiant; saturated palette throughout. Zero blur, zero transparency anywhere except the dithering inside neutron-star.

**Suspect.**
- `src/renderer/src/components/StarMap/proc.ts:233-250` — `applyCircularFade` mid-gradient stop at α=0.3 (line 245). For Atari this is the wrong shape: 8-bit wants a step-function alpha (1 inside, 0 outside), not a Gaussian.
- `themes/atari/index.ts:11-26` — `dprCap: 1.0` is correct (intentional pixel chunkiness). The fade is the hostile actor.

**Fix sketch.** Skip `applyCircularFade` entirely on Atari, *or* expose a `tightFade` flag that converts the gradient into a hard step. Atari should never composite a gradient over a sprite.

## 5 — Vapor: looks closest to deck

**Symptom (reproduced).** Sunset gradient + hot pink + X-spikes all present and roughly correct. Background reads OK. Tron grid faintly visible. Sprite cores are small dots at fit-all but the character is right.

**Reference.** Deck slide 4. Posterized concentric halos, scanlines visible inside each cell, chromatic offset on bright cores. The deck's "Nearest-neighbor through the whole pipeline" intent is more aggressive than what the app shows.

**Suspect (less urgent).**
- `themes/vapor/vaporCrt.ts:30-36` — scanline α=0.30 via `multiply` is correct.
- `themes/vapor/drawers.ts:57-80` — glitch displacement (`getImageData`/`putImageData`) is fine.
- The "blur" the user noted earlier may have been the same background-ellipse problem (issue #1) seen through the sunset gradient.

**Fix sketch.** Defer. Re-evaluate after issue #1 is resolved.

## 6 — Sprites lower-res than deck

**Symptom (reproduced).** At fit-all view the per-star detail is dot-sized. Deck cells are 250×250 single-star references; app fit-all packs 210 stars into the same area, so smaller is expected — but sprite character should still be crisp at any zoom level.

**Suspect.** Need to verify at deep-zoom on app whether sprites bake at full DPR. `src/renderer/src/components/StarMap/sprites.ts:65-80` `bucketDpr()` rounds to nearest 0.5; on retina (DPR=2.0) that should hit 2.0 exactly. Atari `dprCap:1.0` is intentional.

**Fix sketch.** At deep zoom, sample one creature in Bio and one figure in Lost; compare to deck cell at the same physical pixel size. If app sprite is < deck cell sharpness at matched zoom, walk back through `renderTypedSprite` (`sprites.ts:404+`) for theme inheritance bug.

## 7 — Labels theme-blind

**Symptom (not yet visually verified — found by code recon).** `src/renderer/src/components/DetailPanel/DetailPanel.tsx:13-24` defines a single global `STAR_TYPE_LABELS: Record<StarType, string>`. Bio renders a mantaray sprite for `star_type=quasar` (per `bio/drawers.ts:552-554` `drawQuasar → drawMantaray`), but the panel will read "Quasar" regardless of theme.

**Fix sketch.** Add `labels: Partial<Record<StarType, string>>` per theme in each `themes/*/index.ts`. `DetailPanel` reads the active theme's label, falls back to the astronomy global for unset keys. Bio's labels follow the creature names already in `bio/drawers.ts`.

## Out-of-band finding (not in original scope)

- The galaxy panel correctly shows `audit-corpus 210` and `default (legacy) 0` — the daemon is honoring `STARPALACE_DIR` and the audit DB is isolated. Proceed with confidence.
- Layout v2, 10 constellations, 210 stars in view, 210 in DB. PCA placed each of the 10 star_types into its own constellation cluster — embedding is non-degenerate. Good.

## Phase-3 ordering recommended

1. Issue #1 (background feather) — biggest visual win, isolated to two files.
2. Issue #4 (Atari fade off) — one-line knob, restores the contrast deck shows.
3. Issue #2 (Bio core opacity) + #3 (Lost smoothing high) — paired, both move opacity dials.
4. Issue #7 (per-theme labels) — independent, one PR.
5. Issue #5 (Vapor) and #6 (DPR) — re-evaluate after the rest, may auto-resolve.
