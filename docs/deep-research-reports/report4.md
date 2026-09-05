================================================================
STAR PALACE — SPRITE CACHE & PROCEDURAL DRAWER COST ANALYSIS
================================================================

Scope: src/renderer/src/components/StarMap/{sprites.ts, proc.ts},
       src/renderer/src/themes/{jwst,vapor}/drawers.ts, StarMap.tsx.
Target: macOS Apple Silicon, Chromium-class browser, 60 fps;
        floor 30 fps on 2018 MBP / Intel UHD at 50k corpus.
Constraint: no WebGL, no worker OffscreenCanvas, no rewrite.

================================================================
THESIS (read this first)
================================================================

1. The typed LRU at cap=500 thrashes on any session that touches
   more than ~1.5k–2k unique (theme, type, sizeBucket, idHash%4096,
   lod) tuples, which happens trivially at 50k corpus with normal
   pan/zoom. Bumping the cap to 2000–4000 is the single highest-
   ROI change in the file. Confidence: High.

2. The theme prefix on the typed key is the right design but the
   wrong eviction policy. On theme flip you stall on O(visible)
   drawer rebuilds. The fix is **don't evict the old theme on
   flip; let the LRU age it out naturally** while pre-warming the
   new theme during idle. Cost: a `themeId` field on entries, no
   new data structure. Confidence: High.

3. The default Map being unbounded is fine. Cardinality is hard-
   capped at ~2.7k entries; worst-case resident memory is single-
   digit MB. Converting it to LRU adds doubly-linked-list
   bookkeeping on every hit for zero benefit. Leave it alone.
   Confidence: High.

4. nebula is NOT the worst drawer in absolute time; **red-giant
   is**, because FBM there runs at sprite resolution rather than
   capped at NOISE_MAX². You fixed nebula's worst case with the
   cap but the same pattern reappears in red-giant. Confidence:
   Medium (depends on red-giant impl; you described the cost
   profile, I'm trusting that description).

5. Per-id rotation via save/translate/rotate/restore is in the
   noise relative to drawImage itself (~5–30µs each on Chromium-
   Skia for small sprites at default resolution). Don't bake 16
   rotation buckets — that 16× cardinality blow-up buys nothing
   measurable. If you want to clean it up, switch to a single
   `setTransform` round-trip, not bake-into-key. Confidence:
   Medium-High.

6. Pre-baked PNG atlases (option 3b) are a poor fit. The whole
   point of typed sprites is per-id procedural variation; lose
   that at the cheap-LOD tier and the visual signal degrades
   exactly where the human eye notices repetition (large blurry
   things in the periphery). Reject. Confidence: Medium.

================================================================
A. CARDINALITY + MISS-RATE ESTIMATES
================================================================

A.1 KEY-SPACE CARDINALITY (closed form)
----------------------------------------

Default cache (sprites.ts → `cache: Map<string, HTMLCanvasElement>`)
Key tuple: (colorIndex, tempBucket, sizeBucket, spikeVariant, lod)
  |K_default| = 24 × 4 × 7 × 2 × 2
              = 2688
Confidence: High (matches user-supplied math).

Typed cache (sprites.ts → `typedCache: LRUSpriteCache<string>` cap=500)
Key tuple: (themeId, type, sizeBucket, idHash & 0xfff, lod)
  |K_typed| = 2 × 9 × 7 × 4096 × 2
            = 1,032,192   (~1.03 M)
Per-theme slice: 9 × 7 × 4096 × 2 = 516,096 (~516 k).

Note: the hash bucket count (4096) dominates everything. Each
unique (theme, type, sizeBucket, lod) class has 4096 stylistic
variants keyed by idHash. The cache is effectively keyed by star
identity at full resolution, modulo collisions.

A.2 REALISTIC SESSION FOOTPRINT
--------------------------------

Working-set assumptions:
  - V = visible stars per frame ∈ [500, 2000].
  - Corpus N ∈ [5k, 50k]; stretch = 50k.
  - Moderate pan/zoom: over a session, user grazes some
    fraction f of the corpus. Empirical heuristic for map UIs:
    f ∈ [0.05, 0.5] depending on session length. Assume f=0.2
    for a "typical" 5-minute session at 50k → 10k unique stars
    touched.
  - Each unique star contributes 1–3 sizeBuckets across zoom
    transitions and 1–2 lod tiers, so unique typed keys ≈
    touched_stars × 2 (sizeBucket transition factor) × 1.5
    (lod transition factor) ≈ touched_stars × 3.

Session unique-key counts per theme:
  Light pan, V=500, f=0.05, N=50k:  500 × 1 × 3 = ~1.5 k keys.
  Moderate, V=1k,  f=0.2,  N=50k:  10000 × 3   = ~30 k keys.
  Heavy,    V=2k,  f=0.5,  N=50k:  25000 × 3   = ~75 k keys.

Cap-per-theme = 500.

Confidence on the f heuristic: Low to Medium. You don't have
telemetry on this; the right number is whatever your existing
frameMetrics ring buffer would yield if you added a touched-id
set. That's actionable: instrument it before tuning cap.

A.3 LRU MISS-RATE BOUND UNDER ZIPFIAN ACCESS
---------------------------------------------

Under IRM (independent reference model) with Zipf(α), Fagin's /
Che's approximation gives miss rate as a function of cache size C:

  P_miss(C) ≈ Σ_{i=1..N} p_i · exp(-p_i · T(C))

where T(C) is the characteristic time satisfying Σ(1−exp(−p_i·T)) = C.

For α≈1 (which is what spatial visibility typically yields when
you weight by viewport-residence time — recently-visible stars
get touched again on backtrack), the asymptotic miss rate scales
as ~ 1/C for C ≪ N, i.e. you need C on the order of the working
set, not the corpus.

Concrete numbers with α=1, N=30 k unique keys touched per session:

  C=500   → hit rate ≈ ln(500)/ln(30000) ≈ 60%   (40% miss)
  C=1000  → ~67% hit                              (33% miss)
  C=2000  → ~74% hit                              (26% miss)
  C=4000  → ~80% hit                              (20% miss)
  C=8000  → ~87% hit                              (13% miss)

For α=0.7 (less skewed, more "scan-like" — overview pans):
  C=500  → ~25% hit (terrible)
  C=2000 → ~50% hit
  C=4000 → ~65% hit

For α=1.5 (highly skewed — user fixates on a region):
  C=500  → ~85% hit (cap=500 actually fine)
  C=2000 → ~95% hit

Translation: cap=500 is acceptable IF your access pattern is
strongly fixate-and-zoom (high α). It thrashes on overview pans
across a 50k corpus. Confidence: Medium — the constants depend
heavily on actual α, which is unmeasured.

ARC vs. LRU is unlikely to help here. ARC's win is on workloads
mixing scan + frequency (e.g., DB buffer pools with scans of
cold tables). Sprite caches see (a) recency-skewed reuse from
panning and (b) frequency-skewed reuse from common (type,
sizeBucket) classes that tons of stars share. Plain LRU with
adequate capacity captures both because the dominant cost is
cardinality, not policy. Don't introduce ARC; it costs 2x
metadata and 3x code complexity for ~5–15% hit-rate
improvement in this regime. Confidence: Medium-High.

A.4 DEFAULT-CACHE FOOTPRINT
----------------------------

Cardinality ≤ 2688. Sprite sizes by bucket (your spec): smallest
~5² (sb=0), largest ~91² (sb=6). 4 bytes/px (RGBA).

  worst-case (all sb=6):  2688 × 91² × 4 ≈ 88 MB
  realistic distribution: peak cardinality lives in mid-buckets
    (sb=2–3, ~15²). Avg sprite ≈ 15² × 4 = 900 B.
    Steady state ≈ 2688 × 1 KB ≈ 2.6 MB.

The default cache will never evict. Eviction code is dead code.
Adding LRU bookkeeping costs ~30–80 ns per `get()` (Map.delete +
Map.set to re-insert at tail) × ~1k draws/frame ≈ 30–80 µs/frame
of pure overhead, ≈ 0.2–0.5% of a 16.6 ms budget. Small but
non-zero, and zero upside. **Leave the default cache as a plain
Map.** Confidence: High.

The "what if cardinality grows" argument is real but addressable
with a single dev-build assertion, not a structural change:

  if (import.meta.env.DEV && cache.size > 4096) {
    console.warn(`Default sprite cache exceeded expected upper
                  bound: ${cache.size} entries`);
  }

A.5 DOES THE DEFAULT CACHE NEED A THEME PREFIX?
------------------------------------------------

Per your description, the default path is the "cluster-hue
sprite path" used when typed dispatch falls through. It draws
halo + diffraction spikes + core gradient — purely color-driven,
no theme-specific palette logic.

Audit point (you should verify in code, I can only reason from
your description): does either theme override or replace the
default-path drawer? If `theme.drawers` has no entry for some
StarType and falls back to `renderSprite`, AND `renderSprite`
itself reads no theme-scoped state (palette, blendMode, alpha
curve), THEN no theme prefix is needed. **If a theme could ever
pass theme-scoped tunables into renderSprite (e.g., a different
spike length per theme), you have a latent correctness bug**:
two themes will mutually overwrite each other's default-path
sprites without invalidation. Add the theme prefix preemptively
if there's any chance of that, or document the invariant
explicitly.

Confidence: cannot resolve from description alone; flagging as
under-specified. The conservative move is to add `themeId` to
the default key now and accept the 2× cardinality (5376 entries,
still fine).

================================================================
B. ONE CONCRETE CHANGE — RAISE CAP + STOP CROSS-THEME EVICTION
================================================================

The single highest-impact change. Two coupled edits to
LRUSpriteCache and its construction in sprites.ts.

B.1 Before (functional sketch matching your description)
---------------------------------------------------------

// proc.ts (functional reproduction)
export class LRUSpriteCache<K> {
  private map = new Map<K, HTMLCanvasElement>();
  constructor(private cap: number) {}
  get(k: K): HTMLCanvasElement | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v); // recency bump
    return v;
  }
  set(k: K, v: HTMLCanvasElement): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

// sprites.ts
const typedCache = new LRUSpriteCache<string>(500);

B.2 After
----------

// proc.ts — add per-entry metadata + 2-segment eviction
type Entry = { canvas: HTMLCanvasElement; themeId: string; bytes: number };

export class LRUSpriteCache<K> {
  private map = new Map<K, Entry>();
  private bytes = 0;
  constructor(
    private capCount: number,
    private capBytes: number,           // hard memory ceiling
    private activeTheme: () => string,  // injected getter
  ) {}

  get(k: K): HTMLCanvasElement | undefined {
    const e = this.map.get(k);
    if (e === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, e);
    return e.canvas;
  }

  set(k: K, canvas: HTMLCanvasElement, themeId: string): void {
    const bytes = canvas.width * canvas.height * 4;
    const old = this.map.get(k);
    if (old) { this.map.delete(k); this.bytes -= old.bytes; }
    this.map.set(k, { canvas, themeId, bytes });
    this.bytes += bytes;

    // Eviction with theme-aware preference: when over cap,
    // prefer to evict entries whose themeId !== activeTheme(),
    // ONLY among the LRU tail. We never scan the whole map.
    const active = this.activeTheme();
    while (this.map.size > this.capCount || this.bytes > this.capBytes) {
      // Walk from the LRU end, evict first non-active-theme,
      // bounded scan budget = 8 to keep amortized cost O(1).
      let evicted = false;
      let scanned = 0;
      for (const [key, entry] of this.map) {
        if (scanned++ >= 8) break;
        if (entry.themeId !== active) {
          this.map.delete(key);
          this.bytes -= entry.bytes;
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        // No old-theme entry in the first 8 LRU slots;
        // fall back to plain LRU eviction.
        const oldestKey = this.map.keys().next().value as K | undefined;
        if (oldestKey === undefined) break;
        const e = this.map.get(oldestKey)!;
        this.map.delete(oldestKey);
        this.bytes -= e.bytes;
      }
    }
  }
}

// sprites.ts
// 4× count cap, 96 MB byte cap. typed-sprite avg ~24 KB → ~4k
// entries fit under the byte cap in worst observed mix.
const typedCache = new LRUSpriteCache<string>(
  /*capCount*/ 4000,
  /*capBytes*/ 96 * 1024 * 1024,
  () => currentThemeId,    // module-scope ref or React ref
);

// Update the call site that does:
//   typedCache.set(key, canvas);
// to:
//   typedCache.set(key, canvas, themeId);

B.3 Why this shape
-------------------

- capCount=4000 covers the moderate-session working set (~30k
  unique keys touched but Zipfian-skewed; ~80% hit at C=4000
  per A.3). Steady-state memory bounded by capBytes.

- capBytes=96 MB is the safety net. Worst-case nebula sb=6 at
  91² × 4 = 33 KB; 4000 entries × 33 KB worst = 132 MB. Realistic
  mix with mostly small sprites is ~30–60 MB. The byte cap
  prevents pathological growth on a 50k+sb=6-heavy session.

- Theme-aware eviction: on theme flip, the LRU tail is full of
  old-theme entries (because new-theme renders just happened
  and are at the head). The bounded-scan rule (max 8) preserves
  amortized O(1) eviction while strongly biasing toward old-
  theme victims. If the user flips back, those old-theme
  entries are still there and the second flip is free.

- The bounded-scan budget (8) is chosen because the LRU tail in
  practice is contiguous-by-theme right after a flip. You don't
  need a separate ghost list (ARC-style); the active-theme bias
  emerges naturally from "render order = MRU order".

B.4 Expected impact
--------------------

First-paint impact:
  Neutral to slightly negative (~+5–15 ms). The byte-tracking
  arithmetic per set() is ~5 extra ns; the bounded scan only
  triggers when over cap, which doesn't happen during first
  paint. Net: imperceptible.
  Confidence: High.

Steady-state hit rate:
  At V=1k, f=0.2, ~30k unique keys: 60% → ~80% (per A.3).
  Frame-time win = (0.20 hit-rate delta) × (avg drawer cost
  per miss). Avg drawer cost weighted by type prevalence ≈
  0.3–1.5 ms (most main-sequence at <0.1 ms, occasional
  nebula/giant at 3–10 ms). For 1k draws with ~80–200 misses
  vs. 200–400 misses: savings ≈ 200 misses × 0.5 ms avg ≈
  100 ms over a session, distributed as fewer ~1–5 ms hitches
  during pan rather than constant overhead. p99 frame time
  improvement: estimate 2–6 ms in heavy-pan sequences.
  Confidence: Medium.

Theme-flip impact for 1k visible stars on M1 Chromium:
  Before: 1k drawer rebuilds. Avg 0.5–1.5 ms each → 500–1500
    ms total, blocking. With ~10–20% nebula/red-giant share,
    a single flip triggers 100–200 expensive builds → hard
    stutter, multi-frame freeze.
  After (first flip, never visited new theme):
    If new-theme entries have been pre-warmed during idle
    (existing prebuild path, just plumbed for both themes),
    near-zero rebuild cost — under 10 ms.
    If no pre-warm: cost is the same as before, BUT the old
    theme survives, so the SECOND flip (back) is free.
  After (second flip onward, both themes warm):
    ~0–5 ms (just cache lookups + drawImage).
  Confidence: High on direction, Medium on magnitudes.

B.5 What this change does NOT do
---------------------------------

Does not change the default Map (correctly — see A.4).
Does not add a per-id rotation bucket (see E).
Does not add ARC/LRU-K bookkeeping.
Does not change drawer code at all.

================================================================
C. BENCHMARK SPECIFICATIONS
================================================================

C.1 NODE-CANVAS WALL-CLOCK MICROBENCH
--------------------------------------

File: benches/sprite-cost.bench.ts
Run: npx tsx benches/sprite-cost.bench.ts

Assumptions:
- node-canvas (Cairo) is NOT pixel-accurate vs. Chromium-Skia,
  but absolute timings for createRadialGradient, putImageData,
  and drawImage are within ~1.5–3× of Chromium on the same CPU.
  Use it for RELATIVE comparison and order-of-magnitude
  budgeting, not for matching browser numbers exactly. Cross-
  check the highest-impact deltas in a real browser via the
  vitest-browser path before shipping changes.
- This bench imports the drawer functions directly. To do that
  without pulling React, the drawers must be importable as
  pure functions taking a (ctx, params) signature. If they
  currently close over React/theme state, factor that out
  first or use a thin shim file.

------------------------- file content -------------------------

// benches/sprite-cost.bench.ts
import { performance } from 'node:perf_hooks';
import { createCanvas } from 'canvas';
import { LRUSpriteCache } from '../src/renderer/src/components/StarMap/proc';
// Adjust paths if your drawers don't expose pure builders;
// you may need a small shim that calls drawers[type](ctx, opts).
import { jwstDrawers } from '../src/renderer/src/themes/jwst/drawers';

type Stats = { median: number; p99: number; mean: number; n: number };

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const median = sorted[Math.floor(n * 0.5)];
  const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.99))];
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return { median, p99, mean, n };
}

function runBench(name: string, fn: () => void, iters = 1000, warmup = 50) {
  for (let i = 0; i < warmup; i++) fn();
  const samples: number[] = new Array(iters);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples[i] = performance.now() - t0;
  }
  const s = stats(samples);
  console.log(
    `${name.padEnd(48)}  median=${s.median.toFixed(3)}ms  ` +
    `p99=${s.p99.toFixed(3)}ms  mean=${s.mean.toFixed(3)}ms  n=${s.n}`,
  );
  return s;
}

// ---------- Drawer builds ----------
// Fixed seed via your seedFromId(id) — pick deterministic ids.
const DRAWER_CASES: Array<{ name: string; type: string; sizeBucket: number }> = [
  { name: 'nebula      sb=6', type: 'nebula',         sizeBucket: 6 },
  { name: 'red-giant   sb=6', type: 'red-giant',      sizeBucket: 6 },
  { name: 'black-hole  sb=5', type: 'black-hole',     sizeBucket: 5 },
  { name: 'quasar      sb=5', type: 'quasar',         sizeBucket: 5 },
  { name: 'pulsar      sb=4', type: 'pulsar',         sizeBucket: 4 },
  { name: 'main-seq    sb=2', type: 'main-sequence',  sizeBucket: 2 },
];

function buildOne(type: string, sizeBucket: number) {
  // Mirror the size derivation from sprites.ts:
  // ceil(coreRadius * TYPED_SCALE[type] * haloFactor) * 2.
  // For the bench, hard-code the resulting canvas size from
  // your real constants. Here we approximate with a max table.
  const sizeFor: Record<string, number[]> = {
    'nebula':         [11, 17, 25, 37, 55, 75, 91],
    'red-giant':      [9,  13, 19, 29, 43, 65, 91],
    'black-hole':     [9,  13, 19, 27, 39, 57, 81],
    'quasar':         [9,  13, 19, 27, 39, 57, 81],
    'pulsar':         [7,  11, 15, 21, 31, 45, 63],
    'main-sequence':  [5,  7,  9,  13, 19, 27, 39],
  };
  const dim = (sizeFor[type] ?? [5,7,9,13,19,27,39])[sizeBucket];
  const canvas = createCanvas(dim, dim);
  const ctx = canvas.getContext('2d');
  // Call your real drawer. It must accept (ctx, { sizeBucket, seed, ... }).
  const seed = 0xDEADBEEF; // fixed for FBM determinism
  jwstDrawers[type as keyof typeof jwstDrawers](
    ctx as unknown as CanvasRenderingContext2D,
    { sizeBucket, seed, dim },
  );
  return canvas;
}

console.log('--- DRAWER BUILDS (single sprite, full LOD) ---');
for (const c of DRAWER_CASES) {
  runBench(`build ${c.name}`, () => buildOne(c.type, c.sizeBucket));
}

// ---------- LRU get/set throughput ----------
console.log('\n--- LRU THROUGHPUT ---');
const dummyCanvas = createCanvas(32, 32);
const lru = new LRUSpriteCache<string>(500); // adjust signature if you adopt B.2
const KEYS = Array.from({ length: 2000 }, (_, i) => `k${i}`);

// Pre-fill to capacity.
for (let i = 0; i < 500; i++) (lru as any).set(KEYS[i], dummyCanvas);

runBench('LRU get hit  (n=1000 keys, cap=500)', () => {
  for (let i = 0; i < 1000; i++) (lru as any).get(KEYS[i % 500]);
});
runBench('LRU set evict (n=1000 keys, cap=500)', () => {
  for (let i = 0; i < 1000; i++) (lru as any).set(KEYS[500 + (i % 1500)], dummyCanvas);
});

// ---------- drawImage rotated paths ----------
console.log('\n--- DRAW-TIME ROTATION COSTS ---');
const dest = createCanvas(2048, 2048);
const dctx = dest.getContext('2d');
const sprite = createCanvas(32, 32);
{
  const sctx = sprite.getContext('2d');
  sctx.fillStyle = '#fff';
  sctx.beginPath(); sctx.arc(16, 16, 14, 0, Math.PI * 2); sctx.fill();
}

const N = 1000;
const angles = new Float32Array(N);
for (let i = 0; i < N; i++) angles[i] = (i * 0.137) % (Math.PI * 2);

runBench('drawImage no transform x1000', () => {
  for (let i = 0; i < N; i++) dctx.drawImage(sprite, (i * 7) & 1023, (i * 11) & 1023);
});

runBench('save/translate/rotate/draw/restore x1000', () => {
  for (let i = 0; i < N; i++) {
    dctx.save();
    dctx.translate((i * 7) & 1023, (i * 11) & 1023);
    dctx.rotate(angles[i]);
    dctx.drawImage(sprite, -16, -16);
    dctx.restore();
  }
});

runBench('setTransform/draw/setTransform x1000', () => {
  for (let i = 0; i < N; i++) {
    const x = (i * 7) & 1023;
    const y = (i * 11) & 1023;
    const c = Math.cos(angles[i]);
    const s = Math.sin(angles[i]);
    dctx.setTransform(c, s, -s, c, x, y);
    dctx.drawImage(sprite, -16, -16);
  }
  dctx.setTransform(1, 0, 0, 1, 0, 0);
});

runBench('drawImage no rotation, with translate x1000', () => {
  for (let i = 0; i < N; i++) {
    dctx.setTransform(1, 0, 0, 1, (i * 7) & 1023, (i * 11) & 1023);
    dctx.drawImage(sprite, -16, -16);
  }
  dctx.setTransform(1, 0, 0, 1, 0, 0);
});

----------------------- end file content -----------------------

Expected output shape (illustrative; you'll get real numbers):

  build nebula      sb=6           median=2.8ms   p99=4.5ms
  build red-giant   sb=6           median=4.6ms   p99=7.1ms   <- worst
  build black-hole  sb=5           median=0.9ms   p99=1.4ms
  build quasar      sb=5           median=0.7ms   p99=1.1ms
  build pulsar      sb=4           median=0.2ms   p99=0.4ms
  build main-seq    sb=2           median=0.05ms  p99=0.1ms
  LRU get hit ...                  median=0.04ms  (40ns/op)
  drawImage no transform x1000     median=0.6ms
  save/translate/rotate.. x1000    median=1.3ms   (delta ~700µs)
  setTransform/draw       x1000    median=0.9ms   (delta ~300µs)

These are estimates based on Cairo / Skia rotated-blit cost
literature and standard Chromium drawImage benchmarks. Actual
numbers may differ ±2× — the point of the bench is that you run
it and paste back, not that you trust my predictions.

Caveat: node-canvas (Cairo CPU) is generally SLOWER than
Chromium-Skia (especially GPU-accelerated Skia) for gradient-
heavy work. createRadialGradient + fillRect can be 1.5–4×
faster in Chromium. For nebula/red-giant the FBM/JS portion is
backend-independent, so node-canvas results are a reasonable
upper bound on browser cost for those drawers. For pure-
gradient drawers (black-hole, quasar, pulsar, main-sequence),
multiply node-canvas results by ~0.4–0.7 to estimate Chromium.

C.2 VITEST + JSDOM CACHE-BEHAVIOR SPEC
---------------------------------------

File: benches/sprite-cache.test.ts
Run: npx vitest run benches/sprite-cache.test.ts
(vitest config: environment 'jsdom' or 'node' — no Cairo needed.)

------------------------- file content -------------------------

// benches/sprite-cache.test.ts
import { describe, it, expect } from 'vitest';
import { LRUSpriteCache } from '../src/renderer/src/components/StarMap/proc';

// Stub canvas-shaped object; the cache only stores references.
function fakeCanvas(w = 16, h = 16): HTMLCanvasElement {
  return { width: w, height: h } as unknown as HTMLCanvasElement;
}

// --- 1. LRU eviction order under simple access pattern ---
describe('LRUSpriteCache eviction order', () => {
  it('evicts least-recently-used on overflow', () => {
    const c: any = new LRUSpriteCache<string>(3);
    c.set('a', fakeCanvas());
    c.set('b', fakeCanvas());
    c.set('c', fakeCanvas());
    expect(c.get('a')).toBeDefined();   // bumps 'a' to MRU
    c.set('d', fakeCanvas());           // should evict 'b'
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeDefined();
    expect(c.get('c')).toBeDefined();
    expect(c.get('d')).toBeDefined();
  });

  it('treats set on existing key as recency bump, not duplicate', () => {
    const c: any = new LRUSpriteCache<string>(2);
    c.set('a', fakeCanvas());
    c.set('b', fakeCanvas());
    c.set('a', fakeCanvas());            // re-set
    c.set('c', fakeCanvas());            // evicts LRU
    expect(c.get('b')).toBeUndefined();   // 'b' was LRU
    expect(c.get('a')).toBeDefined();
  });
});

// --- 2. Hit rate over a Zipfian working-set trace ---
function zipf(rng: () => number, n: number, alpha: number): number {
  // Inverse-CDF sampling; not the fastest but fine for a test.
  // Returns 0..n-1.
  const r = rng();
  // Approximate via rejection: sample i = floor(n * r^(1/(alpha)))
  const i = Math.floor(n * Math.pow(r, 1 / alpha));
  return Math.min(n - 1, Math.max(0, i));
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe('LRUSpriteCache hit rate (Zipfian synthetic trace)', () => {
  function runTrace(cap: number, uniqueKeys: number, framesV: number, frames: number, alpha: number) {
    const rng = mulberry32(0xBADCAFE);
    const cache: any = new LRUSpriteCache<string>(cap);
    let hits = 0, total = 0;
    for (let f = 0; f < frames; f++) {
      // Each frame, draw V keys sampled from Zipf over uniqueKeys.
      // Simulate locality: shift the Zipf head every 50 frames.
      const offset = Math.floor(f / 50) * 200; // pan emulation
      for (let i = 0; i < framesV; i++) {
        const k = String((zipf(rng, uniqueKeys, alpha) + offset) % uniqueKeys);
        if (cache.get(k) !== undefined) hits++;
        else cache.set(k, fakeCanvas());
        total++;
      }
    }
    return hits / total;
  }

  it('cap=500 hit rate is poor on broad working set', () => {
    const hr = runTrace(500, 30000, 1000, 200, 1.0);
    expect(hr).toBeLessThan(0.7);
  });

  it('cap=4000 substantially improves hit rate', () => {
    const hr = runTrace(4000, 30000, 1000, 200, 1.0);
    expect(hr).toBeGreaterThan(0.75);
  });

  it('cap=4000 narrow working set saturates above 95%', () => {
    const hr = runTrace(4000, 5000, 500, 100, 1.3);
    expect(hr).toBeGreaterThan(0.95);
  });
});

// --- 3. Theme-flip behavior ---
// This test assumes the cache shape from B.2 (themeId on entries,
// theme-aware eviction). If you keep the simple shape, change the
// `set` signature accordingly and assert plain LRU eviction.
describe('LRUSpriteCache theme behavior', () => {
  it('theme flip preserves old entries until capacity forces eviction', () => {
    let active = 'jwst';
    const c: any = new LRUSpriteCache<string>(4, 1 << 30, () => active);
    c.set('jwst:a', fakeCanvas(), 'jwst');
    c.set('jwst:b', fakeCanvas(), 'jwst');
    c.set('jwst:c', fakeCanvas(), 'jwst');
    c.set('jwst:d', fakeCanvas(), 'jwst');
    active = 'vapor';
    // Insert vapor entries; old jwst should be evicted preferentially.
    c.set('vapor:a', fakeCanvas(), 'vapor');
    c.set('vapor:b', fakeCanvas(), 'vapor');
    expect(c.get('vapor:a')).toBeDefined();
    expect(c.get('vapor:b')).toBeDefined();
    // Two of the four jwst entries must have been evicted.
    const surviving = ['jwst:a','jwst:b','jwst:c','jwst:d']
      .filter(k => c.get(k) !== undefined).length;
    expect(surviving).toBe(2);
  });

  it('flipping back makes old entries hit (no rebuild stutter)', () => {
    let active = 'jwst';
    const c: any = new LRUSpriteCache<string>(8, 1 << 30, () => active);
    for (let i = 0; i < 4; i++) c.set(`jwst:${i}`, fakeCanvas(), 'jwst');
    active = 'vapor';
    for (let i = 0; i < 4; i++) c.set(`vapor:${i}`, fakeCanvas(), 'vapor');
    active = 'jwst';
    let hits = 0;
    for (let i = 0; i < 4; i++) if (c.get(`jwst:${i}`)) hits++;
    expect(hits).toBe(4);
  });
});

----------------------- end file content -----------------------

================================================================
D. RECOMMENDATIONS, RANKED BY (RENDER DELTA × IMPL COST)
================================================================

Each item: what to change, expected delta, confidence,
falsifiable target the bench above will validate.

----------------------------------------------------------------
RANK 1 — Raise typed-cache cap to ~4000 with byte ceiling
----------------------------------------------------------------
File: src/renderer/src/components/StarMap/sprites.ts (typedCache
  construction); src/renderer/src/components/StarMap/proc.ts
  (LRUSpriteCache).
Change: cap 500 → 4000, add capBytes=96MB safety net (B.2).
Impl cost: ~30 LOC.
Expected delta: p99 frame time during pan -2 to -6 ms; hitch
  count during long pans roughly halved on 50k corpus.
  Memory: +20–60 MB resident, well under any reasonable budget.
Confidence: High on direction, Medium on magnitude.
Falsifiable: vitest spec asserts hit rate goes from <0.7 to
  >0.75 at the new cap on a Zipf trace; if you instrument
  frameMetrics to log cache hit rate + p99, you should see
  hit rate jump and p99 drop on heavy-pan sessions.

----------------------------------------------------------------
RANK 2 — Theme-aware eviction (don't nuke old theme on flip)
----------------------------------------------------------------
File: same as Rank 1 (LRUSpriteCache.set + StarMap.tsx call site).
Change: B.2 — entries carry themeId; bounded-scan eviction
  prefers non-active theme; theme flip becomes O(visible) drawer
  rebuilds for FIRST flip only, ~0 ms for subsequent flips.
Impl cost: ~40 LOC (mostly already in the Rank 1 diff).
Expected delta: theme-flip stutter from ~500–1500 ms (full
  rebuild of 1k visible) to ~0–10 ms after first warm-up.
Confidence: High.
Falsifiable: instrument theme-flip and observe time-to-first-
  paint after flip drop by ~1 order of magnitude on second flip.
  vitest spec asserts old-theme entries survive the flip and hit
  on flip-back.

----------------------------------------------------------------
RANK 3 — Idle-prebuild BOTH themes during ric
----------------------------------------------------------------
File: StarMap.tsx (existing requestIdleCallback prebuild path).
Change: extend prebuild to enumerate (themeId, type, sizeBucket,
  hashBucket) tuples for BOTH themes, weighted by prevalence.
  Keep 40-star chunk size. Stop when budget exceeds ~50 ms idle
  per ric, or when typedCache reaches ~80% of capCount.
Impl cost: ~20 LOC + a small priority queue keyed by
  estimated-build-cost.
Expected delta: first theme-flip stutter (the one Rank 2 doesn't
  cover) drops from ~500–1500 ms to <50 ms IF the idle window
  ever fires before user flips. On a fast machine after first
  paint, ric typically yields 5–50 ms of idle per frame; you'll
  prebuild a few hundred sprites within the first second.
Confidence: Medium. Depends on user's actual flip latency vs.
  idle-callback timing.
Falsifiable: time the FIRST theme flip with prebuild on vs.
  off; should differ by 100ms+ on M1 Chromium.

----------------------------------------------------------------
RANK 4 — Investigate red-giant FBM-at-sprite-resolution
----------------------------------------------------------------
File: src/renderer/src/themes/{jwst,vapor}/drawers.ts (red-giant).
Change: cap red-giant FBM the same way nebula does — sample
  FBM on a fixed grid (e.g., 48² or 64²) and bilinear-upsample
  to sprite size. Apply prominences as a separate pass.
Impl cost: ~40–80 LOC per theme; medium difficulty (need to
  verify the visual doesn't degrade on the largest sb).
Expected delta: red-giant build cost drops from ~3–7 ms (your
  description) to <1 ms at sb=6. Net frame-budget win on a
  giant-heavy region: 5–20 ms when you cache-miss N giants in
  a single frame.
Confidence: Medium. Visual trade-off is non-trivial; bilinear
  upsample of high-frequency mottling can look blurry. Do an
  A/B before committing.
Falsifiable: bench in C.1 should show red-giant median build
  time fall to within 1.5× of nebula median.

----------------------------------------------------------------
RANK 5 — FBM tile cache keyed by (seedBucket, frequency)
----------------------------------------------------------------
File: proc.ts (add fbmTileCache); drawers.ts (consume it).
Change: when a drawer evaluates fbm2D at (seed, freq), hash
  seed into ~256 buckets and frequency into ~8 octave levels;
  cache the resulting Float32Array tile. Tile size = NOISE_MAX
  (56). Cache cap = 256 × 8 = 2048 entries × 56² × 4 bytes ≈
  25 MB worst.
Impl cost: ~80–120 LOC; refactor of fbm2D entry point.
Expected delta: nebula and (post-Rank-4) red-giant builds drop
  another 30–60% on cache hit (seed bucket shared by ~N/256
  stars; in a 50k corpus the same bucket recurs frequently).
  Frame-budget win on heavy nebula/giant regions: 2–5 ms.
Confidence: Low-Medium. Hit rate depends entirely on whether
  your seed bucketing produces visually-acceptable repetition.
  256 buckets means up to 200 stars share the same FBM tile —
  noticeable if they cluster, invisible if they don't. Visual
  A/B required.
Falsifiable: bench drawer build time with cache cold vs. hot;
  should show 2–3× speedup on hot hits.

----------------------------------------------------------------
RANK 6 — Replace save/translate/rotate/restore with setTransform
----------------------------------------------------------------
File: StarMap.tsx (default-path draw site, commit c49dc36).
Change: precompute (cos, sin) per id once; per-frame use
  ctx.setTransform(c*scale, s*scale, -s*scale, c*scale, x, y)
  then drawImage(sprite, -hw, -hh); restore once at end of pass
  with ctx.setTransform(1,0,0,1,0,0).
Impl cost: ~15 LOC.
Expected delta: 0.3–0.7 ms saved per 1k draws. ~2–4% of frame
  budget on heavy frames.
Confidence: Medium-High on direction, Medium on magnitude.
  save/restore overhead on Chromium-Skia is real but small;
  drawImage itself dominates.
Falsifiable: bench in C.1 directly compares the three paths;
  diff between save/restore and setTransform per 1k = expected
  win.

----------------------------------------------------------------
RANK 7 (REJECT) — Bake rotation into key (16 rotation buckets)
----------------------------------------------------------------
Reasoning: 16× cardinality on default cache (2688→43k) for a
  win that's already covered by Rank 6 at 1/1000th the cost.
  And it doesn't help typed cache at all (typed sprites don't
  get rotation jitter per your description). Memory cost ~50
  MB for ~0 ms saved over Rank 6.
Confidence: High in rejection.

----------------------------------------------------------------
RANK 8 (REJECT) — Pre-baked PNG atlases for cheap-LOD tier
----------------------------------------------------------------
Reasoning: defeats the entire point of per-id procedural
  variation, which is the stated aesthetic. Decoded memory for
  9 types × 7 sizeBuckets × 2 themes × ~16 variants × ~5 KB
  PNG ≈ 5 MB on disk, ~25 MB decoded. Saves at most a few ms
  on theme switch, less than Rank 2+3 already provide. Worse,
  it bifurcates the rendering path: the cheap-LOD looks
  visibly different from the full-LOD on the same star, which
  is exactly the kind of pop the user has been avoiding.
Confidence: High in rejection. Reconsider only if Rank 3 fails
  to mask first-flip stutter AND you can afford visual pop.

----------------------------------------------------------------
RANK 9 (REJECT) — Convert default cache to LRU
----------------------------------------------------------------
Reasoning: see A.4. Bounded cardinality (2.7k), bounded memory
  (single-digit MB), zero eviction firing. LRU bookkeeping is
  pure overhead. Add a dev-only assert on map.size if you're
  worried about future bucket growth.
Confidence: High in rejection.

================================================================
CAVEATS AND THINGS I AM NOT SURE ABOUT
================================================================

1. Access-pattern α (Zipf exponent) is unmeasured. The hit-rate
   numbers in A.3 swing by ±20 percentage points between α=0.7
   and α=1.5. Before tuning capCount precisely, instrument
   touched-id distribution in frameMetrics. cap=4000 is a
   reasonable default that handles a wide range of α; tune
   from telemetry.

2. The "default cache has no theme prefix" claim is your
   description, not something I verified. If any drawer in the
   default path consults theme state, cap=4000 won't save you
   from incorrect output on theme flip — you'll get vapor-styled
   default sprites under jwst until you repaint everything. Add
   the theme prefix preemptively if there's any doubt; the
   cardinality cost is trivial.

3. red-giant being "worse than nebula" is inferred from your
   description that its FBM runs at sprite resolution. If that's
   wrong (e.g., red-giant actually caps at NOISE_MAX too), Rank
   4's expected delta is much smaller. Verify in code before
   committing the refactor.

4. Idle-prebuild for BOTH themes assumes ric fires often enough.
   On a contended main thread (e.g., user is interacting
   continuously with no idle frames), ric never resolves and
   pre-warm doesn't happen. In that case Rank 2 alone covers
   you (post-flip-back is fast); only the FIRST flip during
   sustained interaction stutters.

5. node-canvas / Cairo wall-clock numbers are an UPPER BOUND on
   browser cost for FBM-bound drawers and a poor proxy (likely
   over-estimate by 1.5–3×) for gradient-bound drawers. Don't
   make ship/no-ship decisions on Cairo numbers alone for
   black-hole / quasar / pulsar / main-sequence. For those,
   add a vitest-browser/playwright equivalent of the same bench
   running in headless Chromium and cross-check.

6. The bounded-scan-budget-of-8 in B.2's eviction is a
   heuristic. If render order is NOT theme-clustered (e.g.,
   you interleave default-path and typed-path draws so the
   typed cache's MRU end is interleaved), the scan may fail to
   find a same-theme victim and fall back to LRU. That's still
   correct, just not optimal. Confidence in "8 is enough":
   Medium. Make it a tunable.

7. ARC, LRU-K, or 2Q would all give 5–15% better hit rates
   than LRU at the same capacity for this access pattern, but
   they're not worth the code complexity until you've exhausted
   the easier wins (capacity + theme awareness). If after Rank
   1+2 you still see thrash, revisit. I'd put the probability
   that you ever need to revisit at <30%.

8. The rotation-overhead numbers (Rank 6) are particularly
   uncertain. Chromium-Skia save/restore is reportedly fast
   (~50–200 ns per pair) but data is older than 5 years for
   the most-cited benchmarks. Run C.1's drawImage rotated
   bench in a real Chromium tab (via vitest-browser or
   playwright) to get current numbers. The 0.3–0.7 ms estimate
   for 1k draws could easily be off by 2× in either direction.

================================================================
END
================================================================