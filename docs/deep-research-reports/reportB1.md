# Hybrid Retrieval Layer for a Local-First Personal Search System

## TL;DR

- **Build the lexical layer in-process on SQLite FTS5** (external-content + `contentless_delete=1`) with a custom tokenizer registered via `better-sqlite3`'s `loadExtension`, emitting the original token plus camelCase/snake_case/path splits as **co-located synonyms** (`FTS5_TOKEN_COLOCATED`). Fuse with the existing 768-d HNSW dense retriever using **Reciprocal Rank Fusion at k=60** with a small lexical bias (weight 1.2 on FTS, 1.0 on dense). Default query-side decomposition is **IDF-weighted top-k term selection over an OR-mode FTS query**, no LLM call on the hot path.
- **Expected recall@10 lift on the "folder-name / rare-term" query class: roughly +20 to +35 percentage points absolute over dense-only**, with medium confidence. Published BM25+dense fusion numbers on small/heterogeneous corpora cluster around +10 to +15 pp on average tasks (e.g., Weaviate Search Mode benchmarks: +5% on BEIR SciFact, +24% on BRIGHT Biology; Supermemory's reproduction of the standard pattern: 0.78 → 0.91). The folder-name/rare-noun class is the failure mode where the lift is largest, because the dense centroid is the worst-case there and BM25 is at its best — hence the upper end of the range.
- **Fallback trigger to escalate FTS5 → tantivy is observable and pre-defined**: if (a) p95 incremental write latency exceeds 80 ms after merge tuning, (b) `'optimize'` cadence cannot be hidden in idle windows, or (c) shadow-mode evaluation shows nDCG@10 lift below ~+6 pp vs dense-only on a labelled query slice, then move the lexical index to tantivy via a napi binding, behind the same Lexical interface, keeping the dense path untouched. SPLADE remains correctly out of scope; ColBERTv2/PLAID does not fit the 150 ms / 500 MB / no-GPU envelope at 200 K docs without aggressive engineering.

---

## Key Findings

1. **FTS5 is the right default and almost certainly sufficient.** It is in-process, transactional with the `files` table, shares the SQLite page cache with the rest of the daemon's reads, ships in `better-sqlite3` by default, and has acceptable BM25 ranking once column weights are set. The two real risks are (a) tokenizer rigidity for camelCase/snake_case/path splitting, and (b) write-amplification under heavy mutation. Both are solvable in-process.

2. **The camelCase/snake_case/path problem is solved cleanly by a custom tokenizer that emits *co-located synonyms*.** FTS5 explicitly supports synonym tokens at the same position via the `FTS5_TOKEN_COLOCATED` flag in the C `xToken` callback. This is exactly the standard practice cited from production code-search systems' designs: index `getUserById` *and* `get`, `user`, `by`, `id` at the same logical position. SQLite documents this as "method 3" of synonym handling, recommending it for prefix-query support at the cost of some extra index entries. Custom tokenizers are loaded as a normal SQLite loadable extension (a small C shim) and registered via the public `fts5_api` pointer; `better-sqlite3` exposes `db.loadExtension(...)` and this is the documented integration path used by other community tokenizers (`sqlite-better-trigram`, `signal_tokenizer`, etc.).

3. **Tantivy via Node bindings is technically feasible but currently the weaker maintenance bet.** The two longest-standing public bindings (`Frando/tantivy-node`, `strangerlabs/tantivy`) are not actively maintained; newer napi-rs-based bindings exist as of late 2025 but are small and unproven. More substantively: tantivy's data model is segment-immutable with background merges, which fights the single-writer/single-file transactional model the user already has. Turso's recent reimplementation explicitly disabled tantivy's automerge policy and replaced it with a manual `OPTIMIZE INDEX` because background merges held write transactions open and broke directory-persistence semantics. Tantivy is a fine fallback but the integration cost is real.

4. **Pure-JS (FlexSearch, MiniSearch) is a last resort, not a peer.** For 200 K docs at ~150 MB raw text, FlexSearch's in-memory index will eat much of the 500 MB RAM budget on its own and will not be transactional with the files table. It is appropriate only if FTS5 *and* tantivy both fail; we do not expect either to fail.

5. **RRF (k=60) is the correct fusion default.** It is rank-based, score-distribution-agnostic, and is the published default in Qdrant, Weaviate (rankedFusion), Elasticsearch and OpenSearch. Weighted-score fusion (CombSUM, convex combination) can edge out RRF after careful per-corpus tuning but is brittle as the corpus drifts; on a personal-search system whose corpus is in flux every minute, RRF's no-tuning property is the dominant feature. A lightweight per-list weight is supported by Qdrant's RRF formulation and gives us a single knob to slightly bias toward lexical (the explicit goal), without giving up the rank-based robustness.

6. **Query-side IDF-weighted term selection beats LLM clause-splitting for this hot path.** Calling Ollama to decompose "Mandarin and its history" into ["Mandarin", "history of Mandarin"] adds 200–800 ms of generation latency on a CPU laptop — that alone consumes the entire p95 budget. Computing IDF from the FTS5 doc-frequency statistics (cheap; it's already stored in the index) and keeping the top-k highest-IDF tokens (typically k=4) as an OR-query is essentially free, addresses the "Mandarin gets washed out" failure mode directly, and matches what major hybrid systems do as their default. LLM decomposition is the right *upgrade path*, not the default.

7. **Index-time NER is a small, optional boost — not required for v1.** A capitalisation + IDF heuristic plus a separate `proper_nouns` column with a 2–3× BM25 weight captures most of the practical value of NER for personal search. wink-nlp (~525 K tokens/sec on a single core, low RAM) or compromise are both viable in-process if a real NER pass is desired later, but neither is needed to ship.

8. **SPLADE is correctly excluded for this deployment.** SPLADE-v3 (Lassance et al., March 2024) and DF-FLOPS production-tuning work (SIGIR 2025) have brought CPU retrieval latency on par with BM25, *but only for the lookup step*. Both ends still require a transformer encoding pass per query and per document. Adding that to the existing Ollama dense embedding pass would double per-edit hot-path cost and roughly triple model-resident RAM. Unless a CPU-friendly inference-free sparse encoder shrinks below ~50 MB and 10 ms/edit, this decision should hold for 12–24 months. OpenSearch's "neural sparse v3 doc-only" (Sept 2025) is the variant most likely to flip this — it does query-time tokenization-only (free) and only encodes documents — but it still needs a transformer at index time.

9. **ColBERTv2 / late-interaction does not fit the budget.** PLAID-optimised ColBERTv2 on CPU is "few hundred milliseconds" at large scale (and 500+ ms single-threaded on LoTTE in published 2025 benchmarks); answerai-colbert-small (33 M params, Aug 2024) is the only realistic candidate but adding multi-vector storage at ~32 vectors per doc × 200 K docs blows the RAM and disk budget.

---

## Details

### A. Lexical backend deep comparison

#### A.1 SQLite FTS5 — the recommended choice

**Tokenizer customisation.** FTS5 ships with `unicode61`, `ascii`, `porter`, `trigram`. None handle camelCase or snake_case. The clean solution is a **custom tokenizer registered via the C `fts5_api`**, distributed as a small loadable extension that `better-sqlite3` loads via `db.loadExtension(path)`. The custom tokenizer wraps `unicode61` (to inherit Unicode normalisation, diacritic stripping, and the casefold pipeline) and post-processes each token: emit the original token at position *i*, then emit each sub-token (camelCase / snake_case / path / dot splits) at position *i* with the `FTS5_TOKEN_COLOCATED` flag. This is the SQLite-documented "method 3" synonym strategy and supports prefix queries against both the original and the split forms. The Node side stays pure TypeScript except for ~150 lines of C in `native/fts_codetok/` that get compiled per platform via `prebuildify` or `node-gyp`.

**BM25 ranking quality.** FTS5's `bm25()` is a faithful implementation of the standard formula; it is materially weaker than Lucene/tantivy in two specific ways: (1) no built-in BM25F field-weight tuning state — you pass weights at query time as `bm25(table, w0, w1, ...)`; (2) no global average-document-length caching outside the structure record. For a 200 K-doc, 150 MB corpus the latter is irrelevant and the former is precisely what we want (column weights as a query-time policy knob). The negative-score convention (lower is more relevant) is a known footgun; wrap it once at the data-access layer.

**Index size.** Empirical reports for FTS5 with `detail=none`, contentless, `porter unicode61` show index size on the order of 0.4× the indexed text size (e.g., 80 K-email corpus, 4.6 GB content → 2 GB FTS). For our 150 MB raw text, expect a **60–120 MB FTS5 index**. With 3× chunking it becomes 180–360 MB, which is the dominant single allocation. With page-cache sharing (better-sqlite3's `cache_size` setting) the working set against the 500 MB shared budget is comfortable.

**Incremental insert/update/delete cost.** FTS5 is log-structured (segments). Inserts append to a level-0 segment; auto-merge triggers at the configured `automerge` threshold (default 4 segments per level); `crisismerge` (default 16) forces an inline merge that *can* spike a single write to hundreds of milliseconds on a heavily fragmented index. Mitigations: (a) lower `crisismerge` to 8 to make spikes rarer-but-smaller; (b) run a manual `INSERT INTO fts(fts, rank) VALUES('merge', 16)` step at idle (cheap, bounded work); (c) avoid `INSERT INTO fts(fts) VALUES('optimize')` on the hot path — its cost is O(index size) and is appropriate only at cold start, schema migration, or recovery.

**Fragmentation under heavy mutation.** The user's mutation pattern (frequent edits) triggers level-0 churn. The right structure is **external-content + `contentless_delete=1`** (SQLite ≥ 3.43, which `better-sqlite3` ships): the `files` table is the source of truth, the FTS5 table holds only the index, and `DELETE`/`INSERT OR REPLACE` are first-class. This avoids the contentless-table footgun where DELETE requires re-supplying the original text. Triggers on the `files` table keep the FTS table consistent transactionally.

**External-content vs contentless trade-off.**
- *External-content* (`content='files', content_rowid='id'`): full FTS5 functionality, snippet/highlight available; FTS5 reads the source row from `files` to compute deletes. Best fit because we already have `files`.
- *Contentless-delete* (`content='', contentless_delete=1`): smaller index, cleaner DELETE semantics, no snippet support. Use only if storage is tight.
- Pure *contentless* is rejected: no UPDATE, awkward DELETE.

#### A.2 Tantivy via napi binding — fallback only

Tantivy is excellent technology — Lucene-compatible BM25, FST term dictionary, mature compression. As a **fallback** here it has three strikes against it for this deployment:

1. **Bindings maturity.** `Frando/tantivy-node` (the most-cited binding) hasn't been updated in years; `strangerlabs/tantivy` is similarly stale; newer napi-rs-based packages exist but are small, unproven, and would force us to take on the napi binding itself as a dependency we'd patch.
2. **Mutation model fit.** Tantivy treats documents as immutable: edit = delete + reinsert. Fine. But the default automerge policy runs in a background thread *outside the SQLite transaction*, and disabling it (as Turso did) requires us to schedule manual merges from the Node side, replicating the FTS5 mechanism we already get for free.
3. **Memory floor.** Tantivy's index writer needs a heap budget (default 4 GB recommended for batch; ≥150 MB is a practical minimum even for tiny corpora). On a 500 MB shared budget that contends with the page cache and with the dense ANN structure.

If we must escalate, the integration is bounded: the Lexical interface (see §C below) is the abstraction boundary; only the implementation file changes. Tantivy's BM25 quality and out-of-the-box code-identifier tokenizer support *are* slightly better than FTS5 + custom tokenizer, but not by a margin that justifies the migration before evidence demands it.

#### A.3 FlexSearch / pure-JS — last-resort only

In-memory, not transactional with the files table, will not benefit from the SQLite page cache. At 200 K docs the index alone is plausibly 200–400 MB resident. Reject unless FTS5 and tantivy both fail.

#### A.4 Verdict

**SQLite FTS5, external-content + `contentless_delete=1`, custom code-aware tokenizer registered as a C loadable extension, BM25 with column weights.** The dependency footprint is one ~150-line C file; the code-aware tokenizer is the only thing that needs to be ours. Every other concern (BM25 quality, incremental merging, transactional consistency with files) is a setting.

### B. Sparse-dense fusion

**Recommendation: weighted RRF, k=60, lexical weight 1.2, dense weight 1.0.**

Formula (using Qdrant's weighted-RRF generalisation; with weights = 1 it reduces to the Cormack 2009 formula):

```
score(d) = Σ_r  w_r / ( k + rank_r(d) )
```

with `k = 60`, `w_lexical = 1.2`, `w_dense = 1.0`. Each retriever returns the top 50; merged top-K is taken over the union. Documents missing from one list contribute zero from that list (no penalty for absence — that's the whole point of RRF).

**Why this configuration:**

- *k=60* is the empirically robust default across Cormack 2009, Elasticsearch, OpenSearch, Qdrant, Weaviate. Some authors recommend k=10–20 for very small corpora (<300 docs); at 10⁴–2×10⁵ files we are firmly in the regime where k=60 is correct.
- *Slight lexical bias (1.2 vs 1.0)* directly addresses the stated failure mode: rare-term queries should have FTS5 nudge ahead. This is a 17% rank-bias, not a doubling — the dense path still dominates when FTS misses entirely (e.g., synonym-only queries).
- *Top-50 from each leg* gives RRF enough material to converge on consensus documents. Top-10 each is too narrow; top-100 each costs latency without measurable lift in published reproductions.

**Why not weighted-score fusion (CombSUM/CombMNZ, alpha-tuned linear).** Score distributions from FTS5 BM25 (negative reals, unbounded magnitude) and cosine (0..1) require min-max or z-score normalisation, both of which are sensitive to outliers and to corpus drift. RRF dispenses with the calibration problem entirely. Weighted score fusion can win after per-corpus tuning, but on a personal corpus that mutates constantly there is no stable distribution to tune against.

**Why not learning-to-rank (LambdaMART, etc.).** Overkill at this scale and there is no labelled data. The defensible upgrade path is: (a) collect implicit click-through signals once the system is live; (b) train a small XGBoost/LambdaMART reranker on top of the RRF candidate set after ~10 K labelled interactions. Until then, RRF is strictly better than untuned LTR.

**Why not ColBERTv2 late interaction.** Already discussed: 200K docs × ~32 vectors/doc × bf16 ≈ 400 MB just for the index, plus per-query encoding latency. Doesn't fit the budget.

### C. Query-side decomposition

**Default: IDF-weighted top-k term selection with OR-mode FTS query, no LLM.**

Given a raw query `q`:

1. Tokenise `q` with the same custom tokenizer used at indexing time (tokens + co-located splits).
2. Drop stopwords (a small fixed list — ~150 entries; pulled from any standard English list).
3. Compute IDF for each surviving token using `fts5vocab` (FTS5 ships an auxiliary virtual table that exposes per-term document frequency at constant cost).
4. Keep the top-4 by IDF; if fewer than 2 survive, fall back to all of them.
5. Build the FTS query as `OR` over the top tokens: `MATCH 'mandarin OR history'` (instead of the default implicit AND, which would require both tokens to co-occur — too strict for "Mandarin and its history").

This single change addresses the stated "Mandarin gets washed out" failure mode end-to-end: "Mandarin" has IDF ≈ 8, "history" ≈ 3, "and"/"its" are stopwords; the FTS query becomes effectively `mandarin OR history` with the BM25 ranking automatically up-weighting the rarer term. The dense leg still gets the full original query, so semantic neighbours are still recalled.

**Why not LLM clause splitting on the hot path.** Even a small local model through Ollama costs ≥200 ms on a CPU laptop for a few-token output. That alone equals our entire p95 budget. Reserve it for an explicit "deep search" mode the user opts into.

**Why not syntactic chunking (compromise / wink-nlp) on the hot path.** Either library is fast enough (~1 ms for a typical query), but adds a dependency and only marginally improves over IDF for short queries. Acceptable as a v2 add-on if ablation shows lift.

**Per-clause search then intersect/union.** Boolean composition belongs at the FTS5 layer (its query syntax already supports `AND`, `OR`, `NEAR`); we expose the same to the application via a thin parser. For the default flow, OR-fusion at the lexical leg and rank-fusion at the cross-leg level together do the job.

### D. SPLADE / learned sparse — research-only

The user's reasoning is correct and matches the current literature.

- **SPLADE-v3** (Lassance, Déjean, Formal, Clinchant; arXiv:2403.06789, March 2024) reports >40 MRR@10 on MS MARCO and beats BM25 by ~2 points on BEIR out-of-domain. It is the strongest sparse model.
- **Efficient SPLADE** (SIGIR 2022) and **DF-FLOPS** (SIGIR 2025) bring single-CPU retrieval latency on par with BM25 by aggressively regularising posting-list size.
- **Per-document encoding cost** is the killer for our deployment: SPLADE encodes documents with a DistilBERT-class model; on CPU that's ~30–80 ms per document, doubling per-edit hot-path cost on top of the existing Ollama embedding pass. For 200 K docs an initial backfill is hours; per-edit is hot-path-prohibitive.
- **Memory floor** for the SPLADE encoder is ~250–400 MB resident (DistilBERT plus tokenizer plus runtime), nontrivial against the 500 MB shared budget once dense embedding RAM is also accounted for.
- **CPU-friendly variants worth tracking**: OpenSearch neural-sparse-doc-v3 (Sept 2025) is *inference-free at query time* (just tokenizer + lookup table for queries; transformer only at indexing). If a similar model ships under 50 MB and 10 ms/doc, the calculus changes. Track for re-evaluation in 12 months.

Verdict: **defer**, do not implement now.

### E. Entity / proper-noun extraction at index time

**Recommendation for v1: capitalisation + IDF heuristic, indexed into a separate `proper_nouns` column with a 2× BM25 weight; defer real NER to v2.**

The "Mandarin" failure mode is largely solved by tokenizer + IDF query weighting alone. The marginal benefit of true NER over capitalisation+IDF on a personal corpus (mostly English notes, code, filenames) is empirically small. The marginal cost is one new dependency.

**If real NER is wanted later**, the right in-process choices in the Node ecosystem are:

- **wink-nlp** (~525 K tokens/sec on a single CPU core, MIT licence, ~10 MB resident with `wink-eng-lite-model`, supports tokenisation, POS, NER, custom-entity rules). Strongest practical choice.
- **compromise** (smaller, no model, simpler API, English-only, weaker NER — but `.people()`, `.places()`, `.organizations()` works on most English text). Good if minimal dependencies dominate.
- **flair-via-onnx**: rejected — model size and CPU latency make it inappropriate for index-time on a laptop.

Cost/benefit at this scale: a wink-nlp NER pass on 150 MB corpus is ~5–10 minutes one-time backfill, ~1–3 ms per file save on the hot path. Acceptable but not necessary.

### F. Memory layout & integration details

- **FTS5 internals.** Log-structured merge tree, segments stored as rows in shadow tables (`%_data`, `%_idx`, `%_docsize`). Posting lists use varint delta encoding — not as compressed as PFOR-delta or Roaring, but adequate at this scale and consumes the same SQLite page cache as the rest of the database. Term dictionary is a B-tree (one term-prefix per page), not a FST. Practical implication: term lookups cost an extra page read vs tantivy's FST; at 500 K terms this is ~20 KB FST in tantivy vs ~4–8 MB B-tree pages in FTS5. Negligible for our budget.
- **Tantivy internals (for the fallback).** FST term dictionary, columnar fast fields, BM25 on by default, segment-immutable with mmap. ~10 ms cold open, very low query latency, but needs its own mmap region distinct from SQLite's page cache — that is the relevant cost against the 500 MB shared budget.
- **Page cache sharing.** With FTS5, the FTS shadow tables are pages in the same SQLite file, served from the same `cache_size`-controlled page cache. Setting `PRAGMA cache_size = -200000` (200 MB) gives the lexical layer effective access to the same hot pages as the `files` and `embeddings` tables. With tantivy, the OS file cache services tantivy's mmap and SQLite's page cache independently, doubling cache pressure.
- **Tokenizer for mixed English + code + filenames** — the canonical pattern, explicit:

### Tokenizer specification

The custom FTS5 tokenizer (registered as `code_aware`) wraps `unicode61` (which provides Unicode segmentation, casefold, diacritic stripping). After `unicode61` produces a base token, the wrapper:

1. Emits the **original (lowercased) token at the current position with no flags** — this is the canonical token that drives BM25 statistics.
2. If the original token contains uppercase-after-lowercase boundaries (camelCase / PascalCase), an underscore, a hyphen, a dot, or a slash, the wrapper splits and emits **each sub-token at the same position with `FTS5_TOKEN_COLOCATED`**.
3. Sub-tokens shorter than 2 characters are dropped (the original token already preserves them).

**Concrete rules and examples** (input → emitted tokens at the same logical position):

| Input | Emitted (canonical, then co-located) |
|---|---|
| `getUserById` | `getuserbyid` ; `get` ; `user` ; `by` ; `id` |
| `parse_json_value` | `parse_json_value` ; `parse` ; `json` ; `value` |
| `tax-2024-final` | `tax-2024-final` ; `tax` ; `2024` ; `final` |
| `src/lib/auth.ts` | `src/lib/auth.ts` ; `src` ; `lib` ; `auth` ; `ts` |
| `IOError` | `ioerror` ; `io` ; `error` |
| `XMLHttpRequest` | `xmlhttprequest` ; `xml` ; `http` ; `request` |
| `Mandarin` | `mandarin` (single token, no split) |
| `my-project-name` | `my-project-name` ; `my` ; `project` ; `name` |
| `tax 2024` | two tokens: `tax`, then `2024` |

camelCase split rule: split between (lowercase or digit) → uppercase, *and* between (uppercase) → (uppercase + lowercase), so `IOError` → `IO`, `Error`; `XMLHttpRequest` → `XML`, `Http`, `Request`.

Stopword removal is *not* done in the tokenizer — it is done at query-side IDF filtering (so document-side BM25 statistics remain correct).

The tokenizer is shared between document indexing and query parsing, but with `FTS5_TOKENIZE_QUERY`-time behaviour identical to document-time (we use the FTS5 method-3 synonym strategy: extra postings at index time, no extra work at query time). This is the SQLite-documented preferred strategy for prefix-query support and matches the patterns used in code-search systems.

### Fusion specification

```ts
// Ranks are 1-based. Lists pre-truncated to top-50.
const K = 60;
const W_LEX = 1.2;
const W_DENSE = 1.0;

function fuse(lex: Hit[], dense: Hit[]): Hit[] {
  const score = new Map<string, number>();
  lex.forEach((h, i) => {
    score.set(h.id, (score.get(h.id) ?? 0) + W_LEX / (K + i + 1));
  });
  dense.forEach((h, i) => {
    score.set(h.id, (score.get(h.id) ?? 0) + W_DENSE / (K + i + 1));
  });
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
```

Tunables, in order of likelihood-to-touch: `W_LEX` (default 1.2; raise to 1.5 if rare-term recall is still weak in shadow eval), top-50 prefetch depth (raise to 100 if the fused top-10 is stable but missing known-good hits), `K` (last; only touch with a labelled eval set).

### G. Production hybrid systems cited (2024–2026)

- **Vespa**: BM25 + dense (HNSW) + ColBERT in one rank pipeline; ColBERT 6-layer MiniLM with 32-dim per-token vectors, bf16; reports avg nDCG@10 of 0.481 vs 0.453 BM25-only across 13 BEIR-style datasets. Uses RRF or convex combination. Reference architecture for what "good" looks like at the high end; our deployment cannot afford the ColBERT leg.
- **Weaviate**: BM25F + dense; two fusion algorithms — `rankedFusion` (RRF) and `relativeScoreFusion` (min-max normalised, alpha-weighted). Their published Search Mode benchmarks (2025) show hybrid lift ranging from +5% on BEIR SciFact to +24% on BRIGHT Biology. We adopt their `rankedFusion` semantics with a slight weight (Qdrant's generalised RRF formulation).
- **Qdrant**: explicit named-vector model — one collection holds dense and sparse named vectors; `Fusion.RRF` and `Fusion.DBSF` (distribution-based score fusion) are first-class; the Universal Query API shows the standard pattern of two prefetches → fuse → rerank. Our internal data flow mirrors this: two `prefetch` queries, one fuse step, one optional rerank.
- **Elasticsearch / OpenSearch**: native RRF and weighted hybrid; OpenSearch additionally ships neural sparse v3 and neural-sparse-ANN (SEISMIC algorithm) as of mid-2025 — referenced as the path that *might* flip the SPLADE rejection in 12–24 months.
- **Recent papers**: BEIR (Thakur et al., NeurIPS 2021) remains the reference; Google's "Leveraging Semantic and Lexical Matching" (2020) established the recall-lift framing; the TREC Tip-of-the-Tongue track (2025) confirms that hybrid + LLM rerank is the current SOTA on known-item recall (recall 0.66 on a hard task) — directly relevant to the personal-search "I know it exists" use case.

### H. Failure-mode estimate: recall@10 lift on folder-name / rare-term queries

**Estimated lift: +20 to +35 percentage points absolute over dense-only**, medium confidence.

**Reasoning:**

- The *generic* BM25+dense fusion lift on heterogeneous corpora is +10 to +15 pp absolute, well-attested across BEIR-derived reproductions, Weaviate's published numbers, Supermemory's 0.78→0.91 illustration, Vespa's nDCG@10 lifts, and Google's hybrid retrieval paper.
- The "folder-name / rare-term" subset is precisely where dense underperforms most — the centroid washes out high-IDF tokens that carry essentially all the discriminating signal — and where BM25 is at its strongest. Published per-task numbers on tasks dominated by rare entities (BRIGHT Biology +24%, argument-retrieval Touché-2020 where BM25 alone tops most dense models) cluster at the high end.
- We are stacking three reinforcing mechanisms: (a) BM25 itself; (b) IDF-weighted query term selection that *forces* the rare term to dominate the lexical query; (c) tokenizer-level emission of split sub-tokens, so `my-project-name` matches `project` even when the original hyphenated form was never queried. Each is incremental, and on this query class they compound.
- **Confidence is medium, not high**, because we have no labelled in-corpus eval set yet. A precise number requires the shadow-mode evaluation phase (see §J) on the user's own corpus. A defensible lower bound is +10 pp (the average-case fusion lift); the +35 pp upper bound assumes the "Mandarin"-class queries are currently at near-zero recall@10 with dense-only, which the user's framing implies but has not measured.

---

## Chosen Architecture

**One recommendation, no menu:**

```
[query text]
    │
    ├──► QueryDecomposer (in-process)
    │       • tokenize via code_aware tokenizer
    │       • drop stopwords
    │       • IDF-rank using fts5vocab
    │       • build OR query of top-4 high-IDF tokens
    │
    ├──► LexicalRetriever (FTS5 in better-sqlite3)
    │       • bm25(fts, w_filename=4, w_proper=2, w_body=1) ASC
    │       • LIMIT 50
    │
    ├──► DenseRetriever (existing HNSW, 768-d, unchanged)
    │       • search(embed(query), 50)
    │
    └──► Fuser (weighted RRF, k=60, w_lex=1.2, w_dense=1.0)
            • returns top-10
```

**Hard binding to the constraints:**

- Single laptop, no GPU: every component above runs in-process on CPU.
- ≤500 MB shared RAM: page cache budget 200 MB, HNSW unchanged, FTS index ~100 MB, code negligible.
- p95 ≤150 ms: FTS5 retrieval ~5–20 ms typical, dense HNSW ~10–30 ms, fusion <1 ms, decomposer <2 ms — comfortable margin.
- p50 incremental reindex <100 ms: single-row INSERT into FTS5 with custom tokenizer is ~1–5 ms; trigger from `files` table fires on commit; the dense embedding pass is the bottleneck (already exists and already meets the target).
- Node host, in-process: yes, except the C tokenizer extension which is a `.so`/`.dylib`/`.dll` loaded by `loadExtension` — same process, no IPC.

**Fallback triggers (escalate FTS5 → tantivy):**

1. **Write latency.** If post-tuning p95 single-file save > 80 ms over a 7-day window, primary cause traced to FTS5 merging.
2. **Optimisation cadence.** If `merge` cannot be hidden in idle windows and fragmentation degrades query p95 above 100 ms.
3. **Quality.** If shadow-mode eval shows nDCG@10 lift < +6 pp vs dense-only on a labelled query slice (this would imply BM25 is materially weaker than expected and tantivy's slightly better ranking + native code tokenizer pulls its weight). 6 pp is the minimum lift that would justify the migration risk.
4. **Tokenizer crash.** Any segfault traced to the C tokenizer in production; defects in our own C code are a kill switch (we lose no data — files are the source of truth — but we cannot ship that risk).

If 1, 2, or 4 trigger, switch backend behind the same `LexicalRetriever` interface; nothing else moves.

---

## Concrete file-by-file change list

Assumes a typical Node/TypeScript daemon project with `src/` and `native/` folders.

### New files

| Path | Purpose |
|---|---|
| `native/fts_codetok/fts_codetok.c` | C custom tokenizer; ~150 lines; wraps `unicode61` and emits camelCase/snake_case/path splits as `FTS5_TOKEN_COLOCATED` synonyms |
| `native/fts_codetok/binding.gyp` | Build config (or use prebuildify config in `package.json`) |
| `native/fts_codetok/CMakeLists.txt` | Cross-platform build, optional |
| `src/search/lexical/index.ts` | `LexicalRetriever` interface (one method: `search(query: ParsedQuery, k: number): Promise<Hit[]>`) |
| `src/search/lexical/fts5.ts` | FTS5 implementation; opens the same SQLite handle from `db.ts`, prepares statements, runs `MATCH` queries with `bm25()` weights |
| `src/search/lexical/schema.ts` | DDL for `files_fts` virtual table and triggers; exported as a migration |
| `src/search/lexical/migrations/0001_create_files_fts.sql` | Migration script |
| `src/search/query/decompose.ts` | Tokenize + stopword + IDF-rank + OR-build; uses `fts5vocab` |
| `src/search/query/idf.ts` | IDF cache (LRU, 5K entries; invalidated on bulk reindex) |
| `src/search/fusion/rrf.ts` | Weighted-RRF implementation (~30 lines, pure function) |
| `src/search/hybrid.ts` | Top-level `search(query, k)`; orchestrates Decomposer → parallel(Lex, Dense) → RRF; no other module changes |
| `src/search/eval/shadow.ts` | Shadow-mode logger: runs hybrid alongside dense-only, records both result lists for offline diff |
| `test/search/tokenizer.test.ts` | Tokenizer unit tests covering the table in §F |
| `test/search/hybrid.test.ts` | End-to-end test on a fixture corpus |
| `test/search/golden/queries.jsonl` | ~50 hand-written queries with expected top-3 IDs for regression |

### Modified files

| Path | Change |
|---|---|
| `src/db.ts` | Call `db.loadExtension(path.join(__dirname, '../native/fts_codetok/build/Release/fts_codetok.node'))` once at startup; set `PRAGMA cache_size = -200000` |
| `src/files/index.ts` | On file save, INSERT/UPDATE `files`; the FTS triggers handle the rest. No per-call FTS code. |
| `src/dense/index.ts` | No change (the dense path is untouched — that is the explicit goal) |
| `src/api/search.ts` | Route `/search` from old `dense.search(...)` to new `hybrid.search(...)`; behind a feature flag for rollout |
| `package.json` | Add `node-gyp` / `prebuildify` dev-deps; no new runtime deps for the default path |
| `migrations/index.ts` | Register the FTS5 migration |

### Schema changes (better-sqlite3)

```sql
-- files (existing) — unchanged columns, possibly add a generated column
-- for proper-noun extraction; otherwise no change.

-- new: FTS5 virtual table, external content, contentless_delete
CREATE VIRTUAL TABLE files_fts USING fts5(
  filename,         -- weight 4 in bm25()
  proper_nouns,     -- weight 2 in bm25()
  body,             -- weight 1 in bm25()
  content='files',
  content_rowid='id',
  contentless_delete=1,
  tokenize='code_aware'
);

-- triggers to keep FTS in sync transactionally
CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, filename, proper_nouns, body)
    VALUES (new.id, new.filename, new.proper_nouns, new.body);
END;
CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, filename, proper_nouns, body)
    VALUES('delete', old.id, old.filename, old.proper_nouns, old.body);
END;
CREATE TRIGGER files_au AFTER UPDATE ON files BEGIN
  INSERT INTO files_fts(files_fts, rowid, filename, proper_nouns, body)
    VALUES('delete', old.id, old.filename, old.proper_nouns, old.body);
  INSERT INTO files_fts(rowid, filename, proper_nouns, body)
    VALUES (new.id, new.filename, new.proper_nouns, new.body);
END;
```

`proper_nouns` column is initially populated with a capitalisation+IDF heuristic (`extractProperNounCandidates(body)` in `src/files/index.ts`); we can swap to wink-nlp later without schema change.

### New dependencies

| Dep | Size | Maintenance | Why |
|---|---|---|---|
| `prebuildify` | dev-only, ~3 MB | active | ship the `fts_codetok.node` binary per platform without forcing users to compile |
| `node-gyp` | dev-only, transitive of prebuildify | active | C build |

**No new runtime npm dependencies on the default path.** wink-nlp / compromise are deferred to v2 if real NER is wanted.

---

## Migration / rollout plan

**Phase 0 — preparation (1–2 days)**
- Land tokenizer C extension and unit tests behind feature flag `HYBRID_SEARCH=off`.
- Land FTS5 schema as a migration; on first run, populate FTS5 from existing `files` rows in a single transaction (~1–2 minutes for 200 K files at 150 MB).
- Verify `db.loadExtension` works in the daemon's actual better-sqlite3 build (some distros disable extension loading; if so, recompile better-sqlite3 with `--allow-extension-loading` or use `db.unsafeMode(true)` per its docs).

**Phase 1 — shadow mode (1–2 weeks)**
- Flip `HYBRID_SEARCH=shadow`: on every user query, run *both* the existing dense path (returned to the UI) and the new hybrid path (logged only).
- `src/search/eval/shadow.ts` writes `(query, dense_top10, hybrid_top10, latency_dense, latency_hybrid)` rows to a local `eval` table. Cap at 10 K rows (rolling).
- Ship with **no UI change**; user gets exactly what they get today.
- Periodically the user (or you, with their consent) reviews shadow logs, marks ~50–200 queries with judgement (which list was better) — this becomes the labelled eval set.

**Phase 2 — opt-in canary (1 week)**
- Ship a settings toggle: "Use hybrid search (preview)". Default off.
- Internal/willing users flip it. Continue logging shadow data for the *opposite* path (so we can still compare).

**Phase 3 — default-on with kill switch (release)**
- Hybrid becomes default. Setting still allows revert.
- Keep shadow logging at low rate (10% of queries) for ongoing quality monitoring.
- Remove shadow infrastructure after 60 days of stable telemetry.

**Cold-start / corruption recovery**
- `npm run reindex-fts` rebuilds the FTS5 index from `files` (`INSERT INTO files_fts(files_fts) VALUES('rebuild')`). Acceptable runtime is ~2 minutes for 200 K files. Followed by `INSERT INTO files_fts(files_fts, rank) VALUES('merge', -2000)` and final `'optimize'`.

**Backwards compatibility**
- The dense path is byte-for-byte unchanged; if hybrid is disabled, behaviour matches the current production. There is no schema change to the existing `files` or `embeddings` tables.

---

## Caveats

- **Tokenizer correctness needs unit tests, not eyeballing.** The camelCase boundary rule has known edge cases (`HTML5`, `iOS`, `URLToFetch`); the test file `test/search/tokenizer.test.ts` should be the contract, and the C code should target it. Defects here silently corrupt recall.
- **The +20–35 pp recall@10 lift is an estimate, not a measurement.** Published per-corpus numbers vary widely; the upper end depends on the user's actual query distribution skewing toward rare-term queries. The shadow-mode phase is precisely the mechanism to convert this estimate into a number. Treat the estimate as a *hypothesis to falsify*, not a target to claim.
- **`db.loadExtension` may be disabled in some better-sqlite3 deployments** (notably when bundled by Electron with strict signing). Verify on the production target early; if disabled, the fallback is to compile a custom better-sqlite3 with the tokenizer linked in directly (more work, no architectural change).
- **`crisismerge` spikes are a real residual risk.** Even with tuning, an unfortunate edit during a level-N→N+1 merge can blow past 100 ms. Mitigation: monitor write latency p99; if more than 1% of writes exceed 200 ms, lower `crisismerge` further or schedule manual `merge` calls more aggressively.
- **The "Mandarin" example is one specific failure pattern.** The system may have *other* failure patterns (e.g., heavy synonymy where dense is right and BM25 is wrong, queries dominated by stopwords with no rare terms). The IDF-decomposer falls back to all tokens when fewer than 2 survive stopword removal, which handles the latter; the former is exactly what RRF protects against. But neither claim is empirically validated for this corpus.
- **SPLADE / OpenSearch neural-sparse-v3 should be re-evaluated in 12 months.** If a sub-50 MB inference-free document encoder ships, the trade-off shifts. The architecture above does not preclude swapping the tokenizer-emitted lexical layer for a learned-sparse layer behind the same `LexicalRetriever` interface.
- **Tantivy bindings are a real risk if escalation triggers.** The fallback is *available* but not *cheap*; budget 1–2 engineer-weeks if it happens. The trigger criteria above are deliberately conservative to reduce the chance of premature migration.
- **No labelled data exists yet.** Every quality claim above can only be confirmed in shadow mode. The plan reflects that: ship the architecture, measure, then iterate on weights and depth — not the other way around.
