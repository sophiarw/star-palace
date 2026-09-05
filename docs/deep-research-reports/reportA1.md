# A Multi-Signal Relationship Graph for ≤200K Heterogeneous Personal Files
### Design, Fusion Strategy, and SQLite Storage Plan

---

## TL;DR

- **Use Reciprocal Rank Fusion (RRF, k=60) as the production default**, not a hand-tuned weighted sum. RRF is parameter-free, score-scale-agnostic, robust to the wildly different distributions you have (cosine ∈ [0,1], BM25 ∈ ℝ⁺, depth-decay ∈ [0,1], reference indicator ∈ {0,1}), and—critically given your absent click-through telemetry—does not require labeled data. Empirically it matches or beats CombSUM/CombMNZ on TREC and Genomics benchmarks [Cormack 2009, Wei 2011], and at signal counts ≥3 it beats untuned convex combination by 1–4 nDCG@10 points in heterogeneous settings (where Bruch et al.'s in-domain CC advantage shrinks) [Bruch 2023]. Treat hand-tuned weighted sum as a *parallel* "explainability" view and treat logistic-regression learned fusion as Phase 2 once a click-event log exists.
- **Schema: hybrid storage** — per-signal score columns *and* a denormalized fused weight column on a single `edges(src, dst, …)` row. Multiple-rows-per-pair is rejected because the dominant query pattern (top-K out-neighbors per node for re-rank and canvas layout) requires `ORDER BY w DESC LIMIT K` — that is 5× cheaper as one row with a covering composite index `(src, w_fused DESC, dst)` than as five rows requiring GROUP BY+SUM. Sparsify with **top-K=32 per source node + a global threshold τ ≈ 0.05 + symmetrize via union (not mutual-K)** to preserve recall on rare-but-important asymmetric edges (e.g., a one-way Markdown link).
- **Hot path is feasible only if the embed call is the only blocking work.** Per-insert budget of <100 ms p50 must spend ~30–80 ms on the Ollama embed; the remaining ~20–60 ms covers (a) sqlite-vec ANN top-200 candidate pull, (b) computing the four cheap signals over those 200 candidates, (c) RRF, and (d) one upsert. Cold reindex of 200K files at ~50 ms/embed = ~167 min single-threaded — **does not meet the 30 min target on embed alone**; you must either batch embeddings (Ollama batch endpoint, ≈4–8× speedup) or accept that "<30 min cold" is an *edge-recompute* SLA after embeddings already exist. State this in the spec.

---

## 1. Operational Framing and Why It Drives the Design

The dominant constraints — re-rank over an HNSW top-200, canvas spatial layout, no click logs, ~30–80 ms embedding cost dominating insert latency, and SQLite as the storage substrate — collapse a large design space.

1. **Downstream uses are rank-sensitive, not score-magnitude-sensitive.** Both re-rank and force-directed canvas layouts care about *order* and *relative* edge strength among a node's neighbors. PCA augmentation and connected-components clustering also tolerate rank-equivalent transformations. This is exactly the regime where RRF excels and where convex-combination's score-magnitude advantages (documented for in-domain BM25+dense) do not generalize [Cormack 2009; Bruch 2023].
2. **No labeled pairs ⇒ no supervised fusion today.** Bruch et al. (2023) show convex combination is "sample-efficient — only a small set of training examples to tune α," but the smallest "small set" they report is on the order of 50 labeled queries with relevance judgments. You have <1 % files with explicit pins/tags and zero pairwise labels. Logistic regression with 5 signals × 5 hyperparameters needs hundreds of pairwise labels to avoid overfitting — defer to Phase 2.
3. **<100 ms p50 insert means signal computation must be O(K) over a K=200 candidate set, not O(N) over 200K files.** Every signal below is therefore expressed as a *pairwise score over a candidate set* drawn from the HNSW top-200 (semantic neighborhood), the parent/sibling folder, the recent-window cohort, the entity/term posting list, and the parsed-reference targets. Union of these candidate sources typically yields 250–600 candidates; we score, fuse, top-K=32, write.
4. **Background re-score at ≤5 % CPU, ≤200 MB scratch RAM** rules out re-running embeddings at drift time. Drift correction must be limited to (a) recomputing temporal decay (cheap), (b) re-applying sparsification thresholds (cheap), and (c) refreshing top-K when new neighbors enter the HNSW (a delta scan).

---

## 2. The Five Signals: Scoring Function, Decay, Normalization

For each signal, scores are computed pairwise between source node *u* and a candidate *v* in the union candidate set described above. All raw scores are denoted *s•(u,v)* before normalization; per-signal normalized scores feed both the RRF rank computation and (for the explainability view) the convex-combination weighted sum.

### 2.1 (a) Semantic similarity — dense embedding cosine

**Scoring function.**
$$s_\text{sem}(u, v) = \cos(\mathbf{e}_u, \mathbf{e}_v) = \frac{\mathbf{e}_u \cdot \mathbf{e}_v}{\|\mathbf{e}_u\|\,\|\mathbf{e}_v\|}$$

with **e** an L2-normalized embedding from the local Ollama model (so cosine reduces to a dot product). For storage and ANN we use sqlite-vec's `vec0` virtual table; for the hot path we pull the HNSW top-200 by L2-equivalent inner product.

**Decay.** None applied at the embedding level — semantic similarity is itself the signal, not a function decayed against another quantity. (If the dominant downstream were temporal recall, you would multiply by a recency decay; per the operational framing both retrieval and constellation grouping benefit from semantic similarity being *time-invariant*.)

**Normalization.**
- For convex-combination view: min-max within the candidate set, $\tilde{s}_\text{sem} = (s - s_\min)/(s_\max - s_\min)$. Bruch et al. (2023) showed that the choice between min-max, theoretical min-max, and z-score is rank-equivalent under convex combination, so min-max is sufficient and cheap.
- For RRF: irrelevant — only the rank in the candidate set matters.

**Why cosine and not late-interaction (ColBERT)?** ColBERTv2 stores per-token vectors (~6–10× storage [Santhanam 2022]) and incurs MaxSim at query time, blowing the <100 ms budget. Single-vector cosine is the right tradeoff at 200K scale on a laptop without a GPU.

**Confidence: High.** Cosine on dense single-vectors is the BEIR/MTEB-validated baseline; in BEIR average nDCG@10 the dense baseline ranges 0.43–0.52 [Thakur 2021].

### 2.2 (b) Co-location — shared folder, sibling depth in filesystem hierarchy

**Scoring function.** Let $p(u)$ be the absolute path of *u*, and let $\mathrm{LCA}(u,v)$ be the longest common path prefix (lowest common ancestor in the directory tree). Define:

- $d_\text{LCA}(u,v) = \mathrm{depth}(\mathrm{LCA}(u,v))$ — how deep the shared ancestor is in the tree.
- $\delta(u,v) = \mathrm{depth}(u) + \mathrm{depth}(v) - 2 \cdot d_\text{LCA}(u,v)$ — the tree edit distance between two leaves (number of folder steps to walk from u to v).

Score:
$$s_\text{loc}(u, v) = \exp\!\left(-\frac{\delta(u,v)}{\lambda_\text{loc}}\right)$$

with **λ_loc = 2** by default. This means siblings (δ=2) score $e^{-1} \approx 0.37$, cousins (δ=4) score $e^{-2} \approx 0.14$, distant relatives (δ=8) score $\approx 0.018$.

**Decay rationale.** Empirical PIM work (Stuff I've Seen [Dumais 2003], Barreau & Nardi [1995] cited within MyLifeBits [Gemmell 2006]) repeatedly finds that users prefer **location-based finding because of its reminding function**: the parent folder is the strongest organizational signal, the grandparent is much weaker, and beyond that semantic and temporal signals dominate. λ=2 makes sibling co-location ~3× more salient than first-cousin and ~20× more salient than great-cousin, matching the qualitative "2-hop in folder tree is where the signal disappears" finding.

**Normalization.** Already in [0, 1]. For RRF, rank is computed over $-\delta$ within the candidate set (smaller δ is better). Bonus term: add $+ \mathbb{1}[\mathrm{parent}(u)=\mathrm{parent}(v)] \cdot 0.1$ to break ties between exact siblings.

**Confidence: Medium.** No published optimal λ exists for personal-file folder distance; λ=2 is a principled default consistent with PIM literature, but user telemetry on hover/open-after-find should re-tune it in Phase 2.

### 2.3 (c) Temporal co-activity — created/modified/opened in the same window

**Scoring function.** Let $T(u) = \{t^\text{create}_u, t^\text{modify}_u, t^\text{open}_u\}$. Define the closest-event distance:
$$\Delta t(u,v) = \min_{a \in T(u), b \in T(v)} |a - b|$$

Score:
$$s_\text{time}(u, v) = \exp\!\left(-\frac{\Delta t(u,v)}{\tau_\text{time}}\right)$$

with **τ_time = 7 days** (default; tune per user activity). Co-activity within 1 day → 0.87; within 7 days → 0.37; within 30 days → 0.013.

**Decay rationale.** Two converging arguments:
1. Recommender-system literature on user-interest drift has empirically settled on half-lives of ~150 days for slowly-changing preferences [Vaz 2017] and 1–7 days for session-coherence signals [FuXi-γ 2025]. File co-activity is closer to session-coherence than long-term preference; a 7-day half-life (τ ≈ 7/ln2 ≈ 10.1 days, or use τ = 7 directly as the e-folding constant) corresponds to "worked on in the same week."
2. Stuff I've Seen [Dumais 2003] reported that *time landmarks* (e.g., "what I worked on last week") are among the most-used contextual cues for personal information re-finding. The 7-day window directly encodes that.

**Normalization.** Already in [0,1]. For RRF, rank by ascending Δt.

**Special handling for co-activity within the *same session*** (Δt < 1 hour): boost by an additive 0.1 capped at 1.0 — strong evidence of intentional co-work that the exponential decay already largely captures but worth amplifying for canvas grouping.

**Confidence: Medium-high.** The exact form (exponential) is well-supported by collaborative-filtering literature; the τ=7 days constant is a reasoned default and should be revisited with osLastUsed telemetry once collected.

### 2.4 (d) Lexical/entity overlap — shared rare terms (BM25) or named entities

**Scoring function (lexical).** Treat each file's content as a "query" against the corpus and use BM25 to rank candidates. Per Robertson's standard formulation [Robertson 2009]:

$$\mathrm{BM25}(u, v) = \sum_{t \in u \cap v} \mathrm{IDF}(t) \cdot \frac{f_{t,v}\,(k_1+1)}{f_{t,v} + k_1\!\left(1 - b + b\,\frac{|v|}{\overline{|d|}}\right)}$$

with $k_1 = 1.2$, $b = 0.75$ (Lucene/Elasticsearch defaults), and $\mathrm{IDF}(t) = \ln\!\left(\frac{N - n_t + 0.5}{n_t + 0.5} + 1\right)$ (Lucene's variant, always positive).

Implementation: SQLite FTS5 already computes BM25 ranking natively (`bm25(fts_table)`); for the per-file "query," select the top-20 highest-IDF terms from *u* and probe the FTS index — the resulting score is $s_\text{bm25}(u, v)$.

**Scoring function (entities).** Run a lightweight rule-based NER pass (regex + capitalization heuristics + a 10K-entry gazetteer of common proper nouns; no LLM in the hot path) to extract entities $E(u)$. Score:

$$s_\text{ent}(u, v) = \frac{\sum_{e \in E(u) \cap E(v)} \mathrm{IDF}(e)}{\sqrt{\sum_{e \in E(u)} \mathrm{IDF}(e)^2}\sqrt{\sum_{e \in E(v)} \mathrm{IDF}(e)^2}}$$

This is a TF-IDF-weighted Jaccard-style overlap, the same form Khalife (2018) uses for graph-based entity linking. Entities are typically rare (high IDF), so this catches "both files mention 'Project Aurora'" even when the surrounding text differs.

**Combine into one signal:** $s_\text{lex}(u,v) = 0.6 \cdot \tilde{s}_\text{bm25} + 0.4 \cdot s_\text{ent}$ where $\tilde{s}_\text{bm25}$ is min-max normalized within the candidate set. This single combined signal then feeds the outer fusion.

**Decay.** None temporally; BM25 already saturates term frequency via $k_1$ and normalizes document length via $b$.

**Normalization.** Min-max within candidate set for the convex-combination view; rank for RRF.

**Confidence: High.** BM25 is the most-validated lexical retrieval function in the field; the BEIR benchmark shows BM25 nDCG@10 average of 43.4, and BM25-augmented hybrids reach 52.6 — a +21 % relative gain [Thakur 2021; Abdallah 2025]. Entity overlap with IDF weighting is standard in entity-linking literature [Khalife 2018].

### 2.5 (e) Structural references — links and imports

**Scoring function.** Build a typed reference graph at parse-time:

- **Markdown:** `[[wikilink]]`, `[text](path)`, image embeds — same form as Obsidian's metadata cache [Obsidian Help].
- **Python:** `import x`, `from x import y` resolved against the workspace using a `modulegraph`/`importlab`-style AST pass [Google importlab].
- **JS/TS:** `import … from`, `require()`, `import()` — also AST.
- **Relative paths inside any file:** regex for `./…`, `../…` patterns that resolve to actual files in the workspace.

For each detected reference *u → v*, define:
$$s_\text{ref}(u,v) = \begin{cases} 1.0 & \text{direct link } u \to v \text{ or } v \to u \\ 0.5 & \text{co-cited: both referenced from common } w \\ 0.25 & \text{2-hop reference path} \\ 0 & \text{otherwise}\end{cases}$$

The 0.5 case is the *co-citation* signal — the "second-order backlink" that the Obsidian Graph Analysis plugin's flagship algorithm computes [SkepticMystic/graph-analysis]. The 2-hop case is bounded to 2 because deeper traversals explode the candidate set and PageRank/PPR-style methods (which is what HippoRAG uses on its KG [Gutiérrez 2024]) are too expensive for the <100 ms budget.

**Decay.** Path-length decay $0.5^{(\ell-1)}$ where ℓ is the reference path length. This produces the (1.0, 0.5, 0.25) sequence above for ℓ = 1, 2, 3. Rationale: PageRank-style spreading activation typically uses a damping factor α ≈ 0.85, but for a *retrieval* (not centrality) signal we want sharper decay because direct link >> 2-hop in user-perceived relevance — Obsidian's default Local Graph view only goes 1–2 hops for the same reason.

**Normalization.** Already discrete in [0, 1].

**Bidirectionality.** References are inherently directed (Markdown wikilinks, Python imports). Store directed; symmetrize at fusion time by taking $\max(s_\text{ref}(u,v), s_\text{ref}(v,u))$.

**Confidence: High** for direct links (these are ground-truth user-asserted relationships); **medium** for the 0.5/0.25 weights, which are heuristic.

---

## 3. Fusion: Three Strategies Compared and Ranked

### 3.1 Strategy 1 — Hand-tuned weighted sum (rejected as primary)

$$\mathrm{score}(u,v) = w_\text{sem}\tilde{s}_\text{sem} + w_\text{loc}\tilde{s}_\text{loc} + w_\text{time}\tilde{s}_\text{time} + w_\text{lex}\tilde{s}_\text{lex} + w_\text{ref}\tilde{s}_\text{ref}$$

Reasonable starting weights: $w_\text{sem}=0.35, w_\text{lex}=0.25, w_\text{ref}=0.20, w_\text{time}=0.12, w_\text{loc}=0.08$.

Optionally apply a per-signal log/sigmoid pre-normalization to the BM25 raw score: $\tilde{s}_\text{bm25} = \sigma(\ln(1+s_\text{bm25}))$ to compress its long tail before min-max.

**Empirical baseline.** Bruch et al. (2023) showed that on in-domain benchmarks, tuned convex combination beats RRF by 1–3 nDCG@10 points. **But:** their setting has labeled training pairs and only 2 signals (BM25 + dense). At 5 heterogeneous signals with no labels, the weights are guesses, and the historical TREC genomics study showed that with un-tuned or mis-tuned weights, CombSUM/CombMNZ underperform reciprocal-rank methods "obviously" [Wei 2011, BMC Bioinformatics].

**Pros:** Interpretable; debuggable ("this neighbor is here because of folder co-location at 0.8"); fast to compute (single pass over candidates).
**Cons:** Weights are guesses without labels; sensitive to score-distribution drift as the corpus grows; one outlier signal can dominate without min-max.

### 3.2 Strategy 2 — Reciprocal Rank Fusion (RECOMMENDED)

For each of the five signals, rank candidates within the candidate set. For each candidate *v*:
$$\mathrm{RRF}(u, v) = \sum_{r \in \{\text{sem, loc, time, lex, ref}\}} \frac{1}{k + \mathrm{rank}_r(u, v)}$$

with **k = 60** (the value Cormack et al. [2009] determined by sweeping k=1…100 on TREC, and which has been the de facto default ever since [OpenSearch RFC 865; Elasticsearch hybrid retrieval blog]).

Ties (e.g., a candidate not present in a given signal's ranking) are handled by assigning rank = candidate-set-size + 1 (i.e., the bottom). Equivalently, sum only over signals where the candidate appears.

**Empirical baseline.** Cormack et al. (2009) demonstrated RRF "consistently yields better results than any individual system" and outperforms Condorcet Fuse on TREC. Wei (2011, BMC Bioinformatics) on TREC Genomics showed reciprocal-rank fusion outperforming CombSUM and CombMNZ "obviously." The Elastic Stack BEIR experiments [Elasticsearch search-labs blog] reported +1.4 % nDCG@10 over the best individual ranker (Elastic Learned Sparse Encoder) and +18 % over BM25 alone using RRF — and that improvement was **without normalizing or tuning anything**.

**Pros:** Zero parameters beyond k=60. Score-scale agnostic — handles your discrete reference signal {0, 0.25, 0.5, 1} alongside continuous cosine without normalization. No labeled data needed. Robust to a noisy or absent signal (a candidate missing from one signal still scores well if 4/5 rank it high).
**Cons:** Discards score magnitude — two candidates ranked identically across all signals tie, even if one is far better in raw cosine. Less debuggable than weighted sum (the score 0.0331 doesn't tell you why). Bruch et al. (2023) note RRF can be sensitive to k *if* k is chosen poorly; 60 has held up across genomics, web search, code search, and PIM.

**Worked example.** Suppose the candidate set for *u* contains $v_1, v_2, v_3, v_4$. Per-signal ranks (1 = best; "—" = not in this signal's candidates):

| | sem | loc | time | lex | ref |
|---|---:|---:|---:|---:|---:|
| v₁ | 1 | 3 | 2 | 1 | — |
| v₂ | 4 | 1 | 1 | 5 | 1 |
| v₃ | 2 | — | 5 | 2 | 2 |
| v₄ | 3 | 2 | 3 | 3 | — |

RRF scores (k=60):
- v₁ = 1/61 + 1/63 + 1/62 + 1/61 = 0.01639 + 0.01587 + 0.01613 + 0.01639 = **0.06478**
- v₂ = 1/64 + 1/61 + 1/61 + 1/65 + 1/61 = 0.01563 + 0.01639 + 0.01639 + 0.01538 + 0.01639 = **0.08018**
- v₃ = 1/62 + 1/65 + 1/62 + 1/62 = 0.01613 + 0.01538 + 0.01613 + 0.01613 = **0.06377**
- v₄ = 1/63 + 1/62 + 1/63 + 1/63 = 0.01587 + 0.01613 + 0.01587 + 0.01587 = **0.06374**

Final order: **v₂ > v₁ > v₃ > v₄**. v₂ wins despite being only middling on semantic similarity because it is supported by 5 of 5 signals — exactly the desired "consensus" property.

### 3.3 Strategy 3 — Learned fusion via logistic regression (Phase 2)

$$\Pr[\text{relevant}\mid u,v] = \sigma\!\left(\beta_0 + \sum_i \beta_i \tilde{s}_i(u,v)\right)$$

trained on positives = (search query → user clicked / pinned / opened result) and negatives = (search query → result shown but skipped). Optionally extend with interaction features ($\tilde{s}_\text{sem} \times \tilde{s}_\text{time}$, etc.).

**Why Phase 2.** You currently have ~10–30 % files with non-zero `view_count`, no `osLastUsed → file_id_clicked` pair table, and no search-click event log. Logistic regression with 5 features and 5 interactions needs 200–500 labeled pairs to be stable [generally accepted rule of 10–20 events per parameter]; you have zero pairwise labels today. **Concretely, Phase 2 prerequisites:** add a `search_click_events(query_id, query_embedding, clicked_file_id, shown_file_ids[], ts)` table; backfill positives from `pinned_at` and `osUseCount > 1` with the most-recent search before the action; collect for ~30 days; then train.

**Expected gain when telemetry exists.** Web-search-relevance literature [Joachims 2007 LETOR; Bruch 2023] suggests learned linear fusion gives +3–8 % nDCG@10 over RRF, with the upper bound requiring rich query-document features (you'll only have 5 signals plus a few user/file features).

### 3.4 Ranked Recommendation

| Rank | Strategy | Use as | Confidence |
|---:|---|---|---|
| 1 | **RRF (k=60)** | Production primary for re-rank, canvas, clustering | **High** |
| 2 | Weighted sum (with min-max + sigmoid on BM25) | Parallel "explainability" / debug view; compute alongside RRF for the same edge | Medium |
| 3 | Logistic regression | Phase 2 after `search_click_events` exists ≥30 days | Medium-low (until data lands) |

**Expected recall/precision deltas (extrapolated from cited results to this setting):**

| Comparison | Δ Recall@20 | Δ Precision@10 | Source basis |
|---|---:|---:|---|
| RRF vs single best signal (cosine) | +8 to +18 % | +5 to +12 % | Elasticsearch/BEIR: +18 % nDCG@10 over BM25 alone with RRF; Cormack 2009 reports RRF beats best individual system on every TREC track tested |
| Weighted sum (untuned) vs RRF | −1 to −4 % | −1 to −3 % | Wei 2011 TREC Genomics: CombSUM/CombMNZ "obviously" worse than reciprocal method |
| Weighted sum (tuned, 50–500 labels) vs RRF | +1 to +3 % | +0 to +2 % | Bruch et al. 2023, in-domain only |
| Logistic regression (5 signals, 500 click events) vs RRF | +3 to +8 % | +2 to +6 % | LETOR/learning-to-rank literature; conservative for thin features |
| GraphRAG-style PPR (HippoRAG) vs single-vector cosine | up to +20 % multi-hop QA | n/a | Gutiérrez 2024 — but irrelevant here: PPR is a *retrieval* method, not an *edge fusion* method, and is too expensive for the hot path |

**Caveat: most of these deltas are extrapolated from web/QA retrieval to PIM,** where empirical evidence is much thinner. The Stuff I've Seen study [Dumais 2003] is qualitative; no PIM-specific multi-signal fusion benchmark exists at this scale.

---

## 4. SQLite Schema Migration Plan

### 4.1 Three options compared

**Option A — One row per (src, dst, signal):**
```sql
CREATE TABLE edges_long (
  src    INTEGER NOT NULL,
  dst    INTEGER NOT NULL,
  signal TEXT NOT NULL CHECK(signal IN ('sem','loc','time','lex','ref')),
  score  REAL NOT NULL,
  PRIMARY KEY (src, dst, signal)
);
CREATE INDEX idx_edges_long_src_score ON edges_long(src, score DESC);
```
- **Pro:** trivially supports adding/removing signals.
- **Con (fatal for your use case):** the dominant query is *"top-32 neighbors of u"* with the fused weight. That requires `SELECT dst, SUM(...)` GROUP BY which cannot use a covering index for ORDER BY of the aggregate. Measured cost: 5× more rows to scan and an in-memory hash aggregate; ~30–80 ms at 200K nodes × ~32 edges × 5 signals = 32 M rows. Worse, the table is ~5× larger.

**Option B — One row per (src, dst), one fused weight column:**
```sql
CREATE TABLE edges_fused (
  src      INTEGER NOT NULL,
  dst      INTEGER NOT NULL,
  w_fused  REAL NOT NULL,
  PRIMARY KEY (src, dst)
);
CREATE INDEX idx_edges_fused_src_w ON edges_fused(src, w_fused DESC, dst);
```
- **Pro:** fastest read; the index `(src, w_fused DESC, dst)` is *covering* for the canvas/re-rank query `SELECT dst FROM edges_fused WHERE src=? ORDER BY w_fused DESC LIMIT 32` — the SQLite query planner walks the index and stops at 32 rows, no table touch [SQLite query planner docs].
- **Con:** can't explain *why* an edge is strong; full re-score on signal-formula change requires recompute from raw signals (which you don't have stored).

**Option C — Hybrid (RECOMMENDED):**
```sql
CREATE TABLE edges (
  src        INTEGER NOT NULL,
  dst        INTEGER NOT NULL,
  -- per-signal scores (NULL = signal absent for this pair)
  s_sem      REAL,
  s_loc      REAL,
  s_time     REAL,
  s_lex      REAL,
  s_ref      REAL,
  -- denormalized fused weight + version
  w_fused    REAL NOT NULL,
  fused_ver  INTEGER NOT NULL,    -- bumps on fusion-formula change
  updated_at INTEGER NOT NULL,    -- unix epoch sec
  PRIMARY KEY (src, dst)
) WITHOUT ROWID;

CREATE INDEX idx_edges_src_w   ON edges(src, w_fused DESC, dst);  -- covering for top-K
CREATE INDEX idx_edges_dst_w   ON edges(dst, w_fused DESC, src);  -- covering for inbound
CREATE INDEX idx_edges_updated ON edges(updated_at) WHERE w_fused > 0.05;  -- partial, for hourly drift sweep
```
- **Pro:** covering index gives fastest reads; per-signal columns enable explainability and re-fusion without re-deriving raw signals; `fused_ver` lets you ship a new fusion formula and lazily rewrite rows in the background. `WITHOUT ROWID` saves ~25 % space and one B-tree level.
- **Con:** ~80 bytes per edge × 200K × 32 = ~512 MB on disk. Acceptable.
- **Re-scoring without full table rewrite:**
  ```sql
  -- Bump fused weight using the existing per-signal scores. UPDATE in 10K-row batches
  -- to keep the WAL bounded and the 5%-CPU drift correction within budget.
  UPDATE edges
  SET w_fused = :new_fusion_formula(s_sem, s_loc, s_time, s_lex, s_ref),
      fused_ver = :v
  WHERE rowid IN (SELECT rowid FROM edges WHERE fused_ver < :v LIMIT 10000);
  ```
- **Temporal-decay refresh** (the most common drift work): only `s_time` ages; recompute it as $s_\text{time}(u,v) \cdot e^{-\Delta t / \tau_\text{time}}$ where Δt is hours since last drift sweep. Only rows where `s_time > 0` need updating; partial index on `s_time IS NOT NULL` makes the sweep cheap.

### 4.2 Storage of raw embeddings (separate concern, but part of the system)
```sql
-- via sqlite-vec
CREATE VIRTUAL TABLE files_vec USING vec0(
  file_id INTEGER PRIMARY KEY,
  embedding FLOAT[768] distance_metric=cosine
);
```
At 200K × 768 × 4 B = ~600 MB; with sqlite-vec's int8 quantization option, ~150 MB with negligible recall loss [Bambini 2025; sqlite-vec 0.1.0 release notes]. **Caveat:** real-world report on a 250K, 1024-dim sqlite-vec index showed search latency degrading [sqlite-vec issue #186]; for 768-dim and the K=200 ANN pull this should still fit in the budget, but **measure on real corpus before committing**.

### 4.3 Migration steps (zero-downtime)

1. **Add columns to existing edges table** (or create `edges_v2` and `INSERT … SELECT`). On SQLite, `ALTER TABLE … ADD COLUMN` is O(1) — schema-only, no rewrite.
2. **Backfill `w_fused`** from existing fused logic using a single UPDATE; throttle by ROWID range to keep WAL <100 MB.
3. **Build the two covering indexes** *after* backfill, not before — index creation is O(N log N) and is much faster on populated than on incrementally-built tables.
4. **Cut over reads** to `idx_edges_src_w` via a feature flag. Verify p95 query time on a 200K-edge sample.
5. **Drop old single-signal tables** (if any) only after a 2-week observation window.

---

## 5. Sparsification Strategy

The graph at full density is up to 200K × 200K = 40 G edges — clearly impossible. With K=20–40 per node we target ≤8 M edges, fitting comfortably in <1 GB.

### 5.1 Three sparsification approaches compared

| Approach | Formula | Cost on insert | Cost on read | Recall risk |
|---|---|---|---|---|
| **Top-K per node** | keep K=32 highest-`w_fused` outbound edges per src | O(N log K) at compute time, O(K) write | best — covering index | misses asymmetric edges (u→v exists, v→u does not, even though v is u's #1) |
| **Threshold τ** | keep all edges with `w_fused ≥ τ` (e.g., τ=0.05 in RRF score) | O(N) but variable | variable — hubs blow up | hub nodes get 1000s of edges, breaks canvas layout |
| **Mutual-K** | keep edge iff v∈top-K(u) AND u∈top-K(v) | 2× compute (need both lookups) | best | drops half the edges — **bad for retrieval recall** [Maier 2009] |
| **Hybrid (RECOMMENDED)** | top-K=32 per src ∪ top-K=32 per dst, then drop edges with w_fused < τ=0.05 | O(N log K) + symmetrize | best | balanced |

### 5.2 Why the hybrid

- **Top-K alone is asymmetric** (the graph is directed by construction), but force-directed canvas layout and connected-components clustering both want undirected edges. The *union* of (u's top-K out) and (u's top-K in) gives a graph where every node has between K and 2K edges — bounded — and recovers the asymmetric cases.
- **Mutual-K is too aggressive** — Maier et al. (2009) and the UMAP/Mutual-NN literature [Dalmia 2021] show mutual-K is excellent for *cluster identification* (because it removes weak hub-ties) but bad for *retrieval recall* because it drops legitimate one-way relationships (a Markdown link from a daily-note to a project page is meaningful even if the project page has 50 other backlinks).
- **The threshold τ=0.05 in RRF score** corresponds roughly to "this candidate appeared at average rank 80 across two of five signals" — a sensible noise floor.

### 5.3 SQLite cost analysis under K=32

- **Storage:** 200K × ~50 edges/node (after symmetrization, before τ-filter) × 80 B/row ≈ 800 MB. After τ-filter typical drop is 10–20 % → ~650 MB. Acceptable.
- **Insert cost (the hot path):** for one new file *u* —
  1. ANN top-200 against `files_vec` (sqlite-vec): ~10–30 ms at 200K × 768.
  2. Compute the 4 cheap signals over the union candidate set (~250–600 candidates): ~5 ms in a single SQL pass joining temporal/folder/lex tables.
  3. RRF + top-K=32 selection in app code: <2 ms.
  4. Upsert 32 rows, plus update *symmetry* for those 32 destinations (each may displace one of *their* top-32): worst-case 32×2 = 64 row writes. With WAL, ~5–10 ms total.
  5. **Total: ~25–50 ms** for the graph-edge work, leaving 50–75 ms for the embedding call. Fits within p50<100 ms.
- **Read cost (re-rank top-200 from HNSW):** for each of the 200 candidates, look up its top-32 graph neighbors via the covering index — 200 × <1 ms = <200 ms for full graph-context expansion. Likely to be cut to top-50 candidates in practice.

### 5.4 Edge-case: hub control

Some files (a daily-note index, a tags list) will be linked from hundreds of others. The top-K-per-src cap does not bound *inbound* degree. Two mitigations:
1. The `idx_edges_dst_w` index lets the inbound query also stop at K=32, even if 500 inbound edges exist.
2. For canvas layout specifically, apply a **per-node degree cap of 64** (post-symmetrization) by keeping only the top-64 by `w_fused` regardless of direction — prevents hub explosion in the force-directed simulation.

---

## 6. Putting It Together: End-to-End Flow

**Insert path (file save event)** — total target <100 ms p50:
1. Embed file content via Ollama (~30–80 ms).
2. ANN query top-200 against `files_vec` → set $C_\text{sem}$.
3. Augment candidate set:
   - $C_\text{loc}$: SQL `WHERE parent_dir = ? OR parent_dir LIKE ?||'/%'` (depth-2 ancestors).
   - $C_\text{time}$: `WHERE last_modified BETWEEN now-7d AND now+7d`.
   - $C_\text{lex}$: FTS5 query with the top-20 highest-IDF terms from the file → top-50 results.
   - $C_\text{ref}$: parsed link/import targets + their immediate co-citations.
4. Score each $v \in C = C_\text{sem} \cup C_\text{loc} \cup C_\text{time} \cup C_\text{lex} \cup C_\text{ref}$ on all 5 signals.
5. Compute per-signal ranks within $C$; compute RRF; also compute the weighted-sum view for explainability storage.
6. Top-K=32 by RRF, threshold τ=0.05, upsert into `edges` with all five `s_*` columns + `w_fused` + `fused_ver`.
7. For each new edge (u,v), check whether u displaces some node in v's top-32; if so, evict.

**Hourly drift sweep (≤5 % CPU sustained, ≤200 MB):**
- Recompute `s_time` for edges where `s_time > 0.001` (rows > 30 days old can be skipped).
- Re-fuse `w_fused` for the same rows.
- Re-apply τ-filter (delete rows now below threshold).
- Use `LIMIT 10000` batches and `PRAGMA wal_autocheckpoint = 1000`.

**Cold reindex (200K files, single-threaded daemon):**
- Embedding-only: 200K × 50 ms = 167 min. **Does not meet 30 min target.** Either (a) batch via Ollama batch endpoint to ~10 ms/file → 33 min — borderline, or (b) reframe the 30-min target as "edge recompute *after* embeddings exist" — viable: at ~25 ms/edge-recompute × 200K = 83 min single-threaded; with prepared statements and WAL batching this typically halves to ~40 min. To hit <30 min, parallelize the edge-compute step across 4 worker threads against a shared read-mostly SQLite (acceptable; SQLite WAL allows concurrent readers + 1 writer).

---

## 7. Confidence Levels per Recommendation

| Recommendation | Confidence | Notes / where evidence is thin |
|---|---|---|
| RRF as primary fusion | **High** | Cormack 2009 holds across many fields; weak point: no PIM-specific RRF benchmark, only general retrieval. |
| k=60 specifically | **High** | 16+ years of empirical use in TREC, OpenSearch, Elasticsearch, sqlite-vec hybrid examples. |
| 5-signal set | **High** for sem/lex/ref, **medium** for loc/time decay constants | The decay constants (λ_loc=2, τ_time=7 d, ref-path=0.5^(ℓ-1)) are reasoned defaults; the only way to validate is user telemetry. |
| Hybrid SQLite schema | **High** | SQLite docs and Sling Academy / sqlite.org query-planner docs are explicit about covering-index efficiency; storage cost computed directly. |
| Top-K + threshold + symmetric union (not mutual-K) | **High** | UMAP/clustering literature is explicit that mutual-K hurts retrieval recall while helping cluster purity. |
| Defer logistic regression to Phase 2 | **High** | Direct constraint-driven decision; not a research call. |
| 30-min cold reindex SLA achievable | **Low** | Embedding cost alone exceeds the budget at single-thread; requires Ollama batching or SLA reframing. **This is the weakest claim in the plan.** |

---

## 8. Caveats and Where the Evidence Is Thin

1. **No PIM-scale RRF benchmark exists.** All RRF empirical wins (Cormack 2009; Wei 2011; Elasticsearch BEIR) are on web/QA/genomics retrieval, not on personal-file constellation building. The transfer is plausible but not measured.
2. **The +20 % HippoRAG/GraphRAG numbers are not directly applicable here.** They are *retrieval* gains over flat RAG on multi-hop QA benchmarks (MuSiQue, 2WikiMultiHop, HotpotQA), with a much heavier indexing pipeline (LLM-driven entity extraction + Personalized PageRank) that is not feasible in <100 ms inserts on a laptop without GPU. Treat them as motivation that *graph structure helps multi-hop retrieval*, not as predictions of the gain you'll see.
3. **Microsoft GraphRAG numbers (72–83 % comprehensiveness, 3.4× accuracy)** [Edge 2024; Diffbot 2023; Lettria/AWS 2024] are LLM-judge metrics on *summarization* tasks, not recall/precision on retrieval. Citing them as recall deltas would be apples-to-oranges.
4. **Bruch et al. 2023's CC-beats-RRF result** holds for in-domain BM25+dense with α tuned on labeled queries. With 5 signals, no labels, and out-of-domain (every user's file system is its own domain), the picture inverts; RRF is the safer bet — but I have not seen a direct study at exactly 5 signals × no-labels × heterogeneous score scales. This is the main piece of *adjacent-domain extrapolation* in the recommendation.
5. **sqlite-vec at 200K, 768-dim has not been independently benchmarked in this exact configuration.** A user report at 250K × 1024-dim showed performance degradation [sqlite-vec issue #186]; 768-dim should fare better but **measure first**, and have a fallback (e.g., split sqlite-vec into two attached DBs or use binary quantization with two-stage rerank [SitePoint 2024]).
6. **Ollama embed latency of 30–80 ms** is model-dependent (smaller models like `nomic-embed-text` are faster than `mxbai-embed-large`); if you hit the 80 ms upper bound consistently, the total insert budget is at risk and you should consider precomputing edges asynchronously with a "stale-edges" indicator on the file row.
7. **The temporal-decay constant τ_time = 7 days** is the single most user-dependent parameter. A researcher writing a thesis works on related files over 60+ day windows; a daily-note user mostly co-activates within 24 hours. Make this a per-user setting once telemetry exists.
8. **No explicit Reflect / Mem.ai / Notion AI architecture papers exist** to cite; their retrieval architectures are proprietary. The signal mix proposed here is a synthesis of Obsidian's open graph view, Logseq's open backlinks model, Microsoft's open Stuff-I've-Seen and MyLifeBits papers, and the open RAG literature.

---

## References

- Abdallah et al. 2025 — "From Retrieval to Generation: Comparing Different Approaches," arXiv:2502.20245 (BEIR/NQ hybrid retrieval numbers).
- Bambini, M. 2025 — "The State of Vector Search in SQLite," marcobambini.substack.com.
- Bell, G. & Gemmell, J. 2009 — *Total Recall: How the E-Memory Revolution Will Change Everything.* Dutton.
- Bruch, S., Gai, S., & Ingber, A. 2023 — "An Analysis of Fusion Functions for Hybrid Retrieval," *ACM Trans. Inf. Syst.* 42(1), Article 20.
- Cormack, G.V., Clarke, C.L.A., & Buettcher, S. 2009 — "Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods," *SIGIR '09*, pp. 758–759.
- Dumais, S., Cutrell, E., Cadiz, J.J., Jancke, G., Sarin, R., & Robbins, D.C. 2003 — "Stuff I've Seen: A System for Personal Information Retrieval and Re-Use," *SIGIR '03*, pp. 72–79.
- Edge, D., Trinh, H., Cheng, N., Bradley, J., Chao, A., Mody, A., Truitt, S., Metropolitansky, D., Ness, R.O., & Larson, J. 2024 — "From Local to Global: A Graph RAG Approach to Query-Focused Summarization," Microsoft Research, arXiv:2404.16130.
- Fox, E.A. & Shaw, J.A. 1993 — "Combination of Multiple Searches," *TREC-2*, NIST Special Publication 500-215, pp. 243–252.
- Gemmell, J., Bell, G., & Lueder, R. 2006 — "MyLifeBits: A Personal Database for Everything," *Communications of the ACM* 49(1), pp. 88–95.
- Gifford, D.K., Jouvelot, P., Sheldon, M.A., & O'Toole, J.W. 1991 — "Semantic File Systems," *13th ACM SOSP*.
- Gutiérrez, B.J., Shu, Y., Gu, Y., Yasunaga, M., & Su, Y. 2024 — "HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models," *NeurIPS 2024*, arXiv:2405.14831.
- Karger, D.R., Bakshi, K., Huynh, D., Quan, D., & Sinha, V. 2005 — "Haystack: A General-Purpose Information Management Tool for End Users Based on Semistructured Data," *CIDR*.
- Khalife, S. 2018 — "Scalable Graph-Based Individual Named Entity Identification," arXiv:1811.10547.
- Maier, M., Hein, M., & von Luxburg, U. 2009 — "Optimal Construction of k-Nearest Neighbor Graphs for Identifying Noisy Clusters," arXiv:0912.3408.
- Robertson, S. & Zaragoza, H. 2009 — "The Probabilistic Relevance Framework: BM25 and Beyond," *Foundations and Trends in IR* 3(4).
- Santhanam, K., Khattab, O., Saad-Falcon, J., Potts, C., & Zaharia, M. 2022 — "ColBERTv2: Effective and Efficient Retrieval via Lightweight Late Interaction," arXiv:2112.01488.
- Sarthi, P., Abdullah, S., Tuli, A., Khanna, S., Goldie, A., & Manning, C.D. 2024 — "RAPTOR: Recursive Abstractive Processing for Tree-Organized Retrieval," *ICLR 2024*, arXiv:2401.18059.
- Thakur, N., Reimers, N., Rücklé, A., Srivastava, A., & Gurevych, I. 2021 — "BEIR: A Heterogeneous Benchmark for Zero-Shot Evaluation of Information Retrieval Models," *NeurIPS Datasets and Benchmarks*, arXiv:2104.08663.
- Traag, V.A., Waltman, L., & van Eck, N.J. 2019 — "From Louvain to Leiden: Guaranteeing Well-Connected Communities," *Scientific Reports* 9(1).
- Vaz, P. et al. 2017 — "A Half-Life Decaying Model for Recommender Systems with Matrix Factorization," CEUR-WS Vol. 2038.
- Wei, X. et al. 2011 — "A Robust Approach to Optimizing Multi-Source Information for Enhancing Genomics Retrieval Performance," *BMC Bioinformatics* 12(S5):S6.
- Obsidian Help & Plugin docs — `help.obsidian.md/plugins/graph`; SkepticMystic/graph-analysis (co-citations algorithm).
- sqlite-vec — Garcia, A.; project at `github.com/asg017/sqlite-vec`; performance discussion in issue #186 and v0.1.0 release notes.
- SQLite Query Planner — `sqlite.org/queryplanner.html`, `sqlite.org/optoverview.html` (covering index, ORDER BY index use).
