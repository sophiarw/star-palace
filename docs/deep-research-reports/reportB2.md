ub-topics" is the same mathematical object as monotone submodular maximization with the (1−1/e) Nemhauser-Wolsey-Fisher (1978) approximation guarantee; DPP-MAP, MMR, facility-location, and weighted set-cover are all special cases differing only in how the marginal-gain function is parameterized. Picking DPP-MAP over MMR buys roughly 2–4 α-nDCG points in published comparisons (Chen et al. 2018; Wilhelm et al. 2018) at essentially no additional latency on top-100; picking explicit query-aspect models (xQuAD, PM-2, or 2025-era set-selection methods like SetR / OptiSet) buys more but requires a query decomposer.
- **Avoid the bait**: Iterative/agentic retrieval (IRCoT, FLARE, Self-RAG, GraphRAG, HippoRAG) is overkill for personal file search of 10⁴–1# From Top-K Nearest Neighbors to Minimal Covering Set: A Technical Survey and Implementation Plan for a Personal File Search System

## TL;DR

- **Ship this**: A two-branch pipeline gated by a rule-based + embedding-prototype intent classifier. Single-shot queries use plain HNSW top-10. Compound queries fan out to HNSW top-200 → fast greedy DPP-MAP (Chen et al. 2018, O(M³) with M≈100–200) operating on a query-conditioned kernel L = diag(r) · S · diag(r), where r are query-relevance scores and S is item–item similarity. Surface results as 3–5 LLM-labeled facet groups with α-nDCG-tracked quality. **High confidence** this beats single-shot HNSW on compound queries while staying within p95 < 300 ms.
- **The core architectural insight** is that "minimal se0⁵ files with one embedding per file. These methods exist to compensate for chunk granularity and multi-hop QA constraints absent from this system. **Medium confidence**, based on the assumption that the user's queries skew toward "find files about X across facets" rather than "synthesize an answer that requires reasoning chained over multiple files." If the latter becomes common, revisit.

---

## Key Findings

### 1. The "set-cover" framing is the right one — and it's already well-formalized
- The shift from "rerank top-k for individual relevance" to "select a subset that *collectively* covers an information need" is now an active research thread. **SetR (Lee et al., ACL 2025)** explicitly identifies query "information requirements" via CoT and selects the smallest set covering all of them; it outperforms RankZephyr and proprietary LLM rerankers on multi-hop benchmarks while using 40–50% fewer passages. **OptiSet (2026)** generalizes this with set-list-wise training. **SMART-RAG (Li et al. 2024)** uses DPPs to model relevance, diversity, and conflict simultaneously without supervision. **MUSS (2025)** generalizes to multilevel relevance/diversity subset selection. The mathematical core in all cases is monotone submodular maximization.
- The classical (1−1/e) ≈ 0.632 approximation guarantee for greedy on monotone submodular functions (Nemhauser, Wolsey, Fisher 1978) directly applies. Coverage functions, weighted set-cover, facility location, saturated coverage, and log-determinant (DPP) are all monotone submodular under standard assumptions; their explicit entropic forms are unified in Iyer (2026, arXiv 2601.12724).

### 2. DPP-MAP is the best available unsupervised diversification primitive
- **Chen et al. 2018 (NeurIPS)** gave an exact greedy MAP inference with O(M³) complexity using Cholesky updates, with sliding-window variant O(M·w²). On M=200 items this is sub-millisecond–to–single-digit-millisecond on consumer CPUs.
- **Wilhelm et al. 2018 (CIKM, YouTube)** demonstrated production deployment with deep DPP kernels and observed both offline and online (A/B) wins. Their kernel form L = diag(q) · S · diag(q) — quality scores on the diagonal, similarity in the off-diagonal — is the canonical pattern.
- **Modern follow-ups** (2024–2026): Reliability-Aware DPPs and LM-DPP (Wang et al. 2024c) for ICL demonstration selection; SMART-RAG (Li et al. 2024) for unsupervised passage selection; MS-DPP (IJCAI 2025) for multi-attribute diversity; ScalDPP (2026) with parameter-efficient adapters for RAG.
- DPP dominates MMR in published comparisons because MMR uses only pairwise max-similarity to *already-selected* items, while DPP's determinant captures volumetric/global diversity over the entire selected set. **High confidence** on the algorithmic ranking; medium confidence on whether the gap matters in personal search at k=10.

### 3. Facet decomposition: explicit (LLM) > implicit (k-means/DPP) for quality, but only marginally and at high latency cost
- **Explicit aspect models**: xQuAD (Santos et al. 2010) and PM-2 (Dang & Croft 2012) require a list of subtopics. xQuAD uses sub-query coverage probabilities; PM-2 uses proportional representation (Sainte-Laguë). Both consistently beat MMR on TREC Web Track diversity tasks; PM-2 typically beats xQuAD on aspect proportionality but loses on aspect coverage.
- **2024–2026 LLM aspect generation** is the explicit path scaled up: query2doc, HyDE, RAG-Fusion / multi-query rewriting (Rackauckas 2024), step-back prompting, and SETR-style information-requirement extraction. With a 1B–3B local LLM via Ollama, a single "decompose this query into 3–5 facets" call is feasible at 80–150 ms p95 if you cap output to ~50 tokens and pre-warm the model.
- **Implicit facet extraction** (k-means / DPP-MAP / MMR over the candidate set) avoids the LLM entirely. K-means on top-200 768-dim L2-normalized vectors with k=4–6 takes <5 ms (sklearn or pure JS), and assigning files to clusters is O(N·k·d). The quality cost vs. LLM facets is real but bounded — facets recovered from candidate-set embeddings are often coherent because nomic-embed-text (Nussbaum et al. 2024, arXiv 2402.01613) was trained with retrieval-oriented contrastive objectives that already align topical structure.
- **Recent insight (Kapuriya et al., SIGIR 2025)** confirms that diversifying selected examples via MMR consistently improves downstream performance across context sizes — diversity helps, but plain MMR is enough to capture the bulk of the gain.

### 4. Iterative multi-step retrieval is overkill here
- **Self-RAG, IRCoT, FLARE, Adaptive-RAG, RAG-Fusion, ITER-RETGEN, R3-RAG** all exist primarily to (a) compensate for chunk granularity (most operate at the passage level, where one document = many candidates), and (b) drive *answer generation*, not retrieval-set quality. Their multi-step structure is interleaved with a generator; without the generator they degrade to fancy query rewriting.
- For personal search where one embedding = one whole file, a single retrieve-then-cover step is the right granularity. The exception: **HippoRAG (NeurIPS 2024)** uses Personalized PageRank over an entity graph for associative multi-hop recall, which would be useful *if* the user's queries are heavy on cross-file entity association ("show me everything related to my conversations with X about Y"). At 10⁴–10⁵ files this is feasible but adds offline graph-construction cost. **Speculative**: defer to a v2.
- **RAG-Fusion** (multi-query + Reciprocal Rank Fusion, Cormack et al. 2009) is the one iterative pattern worth borrowing as an *option* gated behind expensive-query mode: generate 3–4 query variants with the local LLM, run HNSW for each, fuse with RRF (k=60), then run DPP-MAP on the fused top-200. Recent industry deployment study (arXiv 2603.02153) reports diminishing returns once context budgets are bounded — confirming the gating decision.

### 5. Query intent classification is the highest-leverage component
- **Agarwal et al. (arXiv 2110.04640, "Lookup or Exploratory")** show that 85% accuracy on lookup-vs-exploratory is achievable with simple heuristics (query length, scroll depth, conjunction counts) without session data. POS-tag-based and conjunction-based features dominate.
- **2024–2026 work on query intent with weak supervision** (arXiv 2504.21398) shows LLMs are mediocre at *discriminative* intent classification despite strong generative ability — favoring either rule-based heuristics or a small fine-tuned classifier over zero-shot LLM intent calls.
- The right architecture is a layered gate: (a) cheap rule-based features ("and", "vs", "history of", "compared to", named-entity count from spaCy small ≈5 ms); (b) cosine of query embedding against precomputed prototype embeddings for "compound" and "single-shot" archetypes (zero extra forward pass; <1 ms); (c) optional small-LLM confirmation only if the previous two are ambiguous.

### 6. The hardware constraints are not actually tight for the recommended path
- nomic-embed-text (137M params, 768-d, L2-normalized) via Ollama: **30–80 ms** per call on M-series Mac CPU; 15–50 ms reported on warm Ollama servers (collabnix.com 2025).
- HNSW search at M=16, efSearch=100 on N≤200K, d=768: **1–5 ms** per top-200 query (consistent with Qdrant/Milvus/hnswlib benchmarks; APXML, Marqo, Zilliz).
- better-sqlite3 row fetch for 200 indexed rows: **2–8 ms** typical.
- DPP-MAP greedy (Chen 2018) on M=200, k=10: **5–20 ms** in pure JS/TypeScript; sub-millisecond in C++.
- ms-marco-MiniLM-L-6-v2 cross-encoder reranker on 50 docs: **15–25 ms** on x86 CPU via ONNX (FlashRank benchmarks, Vaibhav Dixit 2026).
- Llama-3.2-3B Q4_K_M via Ollama on M-series: **80–150 ms** for ~50 output tokens; on mid-range x86 without GPU, **300–600 ms** — the only stage at risk of breaching budget. Gate accordingly.

---

## Details

### A. Sub-Topic Decomposition

Three families exist; choose by latency budget and quality target.

**A.1. LLM-driven query rewriting (RAG-fusion, query2doc, HyDE, multi-query, decomposition)**
- *RAG-Fusion* (Rackauckas 2024): generate N rewrites, retrieve each, RRF-fuse. The "diverse prompt" variant (ask explicitly for different angles, synonyms, varied specificity) reports +22% NDCG@5, +40% recall@10 on NFCorpus/BEIR (Raudaschl 2024 GitHub).
- *Query2doc / HyDE* (Gao et al. 2022; Wang et al.): generate a fake answer document, embed *that*. Best when queries are short/vague. Adds one LLM call (~50–150 ms locally).
- *Decomposition* (Haystack, ReByte, Jamesli 2024): explicitly split "X and Y" into "tell me about X" + "tell me about Y", retrieve separately, union/RRF. Most directly maps to the "Mandarin and its history" use case.
- **Limitation for personal search**: An LLM that doesn't know your filesystem will generate plausible *general* facets ("Tang dynasty Mandarin", "Beijing Mandarin pedagogy") that may not align with what you actually have on disk. This is partially fixable by conditioning the decomposer on the candidate set (give it the top-30 file titles and ask which axes separate them — a "facet-from-candidates" prompt).

**A.2. Unsupervised facet extraction from candidate embeddings**
- *k-means*: k=4–6 on top-100/200 candidates. Fast (<5 ms on M=200, d=768). Cluster centroids serve as facet prototypes. Labels via top tf-idf terms or one optional LLM call ("name these 4 clusters in 3 words each"). The 2025 *k-LLMmeans* (arXiv 2502.09667) shows LLM-summarized centroids dominate numeric centroids on interpretability with capped LLM cost.
- *MMR over candidates as implicit facet probe*: pick first item by relevance, each subsequent by max-marginal-relevance with λ ≈ 0.5–0.7. Does not produce explicit facets but produces a covering set directly. SMMR (SIGIR 2025) introduces sampling-based MMR for log-speedup over greedy.
- *DPP-MAP over candidates*: same role as MMR but with the determinantal kernel capturing global volumetric diversity. The selected set itself is the implicit facet decomposition.
- *Faceted Clustering* (Diederich et al. 2012, building on Hearst's Scatter/Gather): explicitly addresses "shadowing" (same aspect repeating across clusters) and recommends dynamic, user-controlled re-clustering — directly relevant for the UI exposure dimension.

**A.3. Comparison**

| Method | Latency p95 | Facet quality | Robust to N=20 candidates | Needs 2nd model |
|---|---|---|---|---|
| LLM decomposition (3B local) | 80–150 ms | High | Yes (model-side) | Yes |
| Query2doc / HyDE (3B local) | 80–150 ms | Medium-High | Yes | Yes |
| k-means on candidates (k=5) | <5 ms | Medium | Marginal (k must shrink) | No |
| DPP-MAP on candidates | <20 ms | Medium-High | Yes | No |
| MMR on candidates | <5 ms | Medium | Yes | No |
| Cross-encoder (MiniLM-L6) reranking only | 15–25 ms | High relevance, no diversity | Yes | Yes |

**Recommendation**: DPP-MAP as the default *implicit* facet method (it doubles as the selection step, no separate facet stage needed); LLM decomposition as the gated upgrade for explicitly compound queries that pass the intent classifier.

### B. Set-Cover / Submodular Formulations

**B.1. The unifying view**

Define the candidate set V (size M = 200) returned by HNSW. We want S ⊂ V with |S| ≤ k that maximizes f(S), where f is monotone submodular (∀A ⊂ B, f(A∪{x}) − f(A) ≥ f(B∪{x}) − f(B)). Greedy gives a (1−1/e)-approximation (Nemhauser, Wolsey, Fisher 1978).

| Objective | f(S) form | Captures | Cost on M=200 |
|---|---|---|---|
| Weighted coverage | Σ_t w(t) · [∃ d∈S covers t] | Aspect coverage given t∈T (T = LLM facets or k-means centroids) | O(k·M·|T|), ≈ 1 ms |
| Facility location | Σ_v∈V max_d∈S sim(v,d) | "Each candidate represented by its closest selected" | O(k·M²·d) ≈ 50–100 ms naive; 5–10 ms with sparsified NN graph (Lindgren et al. 2017) |
| Saturated coverage | Σ_t min(α, Σ_{d∈S} sim(d,t)) | Smooth coverage with diminishing returns | similar |
| Log-determinant (DPP MAP) | log det(L_S), L = diag(r) S diag(r) | Volumetric diversity + relevance | O(k·M²) Chen 2018, ~5–20 ms |
| MMR | iterative argmax λ·rel − (1−λ)·max-sim | Pairwise diminishing returns | O(k·M), <2 ms |

These are not independent objectives; they are different parameterizations of the same submodular structure (Iyer 2026 gives explicit entropic equivalences). DPP-MAP and facility-location coincide in the limit of a particular kernel choice (Kulesza & Taskar 2012); MMR is a degenerate facility-location with a single "selected so far" representative.

**B.2. Query-conditioned coverage**

For "Mandarin and its history", define facets T = {τ_1, …, τ_m}. Each τ_j has an embedding (centroid of LLM rewrites, or k-means centroid of candidates, or hand-named topic vector). Each file d "covers" τ_j with weight c(d, τ_j) = max(0, ⟨emb(d), emb(τ_j)⟩ − θ). Then:

f(S) = Σ_j w_j · g(Σ_{d∈S} c(d, τ_j))

where g is concave (e.g., g(x) = min(x, 1) gives weighted set-cover; g(x) = log(1+x) gives saturated coverage). This is monotone submodular by composition (Krause & Golovin 2014). Greedy with lazy evaluation runs in well under 5 ms for M=200, k=10, |T|=5.

**B.3. 2024–2026 set-augmented retrieval landscape**

- **SETR / Lee et al., ACL 2025**: "Shifting from Ranking to Set Selection." Explicit IR identification via CoT, then LLM-driven set selection; outperforms RankZephyr.
- **OptiSet (arXiv 2601.05027)**: Set-list-wise training with partial-ordering signals.
- **AdaGReS (arXiv 2512.25052)**: Adaptive greedy with redundancy-aware scoring under token budgets — directly matches a "context budget" version of personal search.
- **MUSS (arXiv 2503.11126)**: Multilevel subset selection generalizing relevance + diversity.
- **MIRAGE submodular subset selection (arXiv 2505.10533)**: Query-aware GraphCut, Facility Location, Log-Determinant for image retrieval — methodology transfers.
- **SMART-RAG (Li et al. 2024)**: DPP-based unsupervised relevance/diversity/conflict modeling.
- **ScalDPP (arXiv 2604.03240)**: P-Adapter + DML for scalable DPP-based RAG selection.

The literature has converged: **DPP MAP greedy is the production-grade default** because it requires no labels, no second model, no explicit facets, and works at the right scale (M=100–1000).

### C. Iterative / Multi-Step Retrieval — When and Why Not

Surveyed methods and applicability:

| Method | Multi-step structure | Useful without generator? | Local CPU latency | Personal search verdict |
|---|---|---|---|---|
| RAG-Fusion (Rackauckas 2024) | N rewrites → N retrievals → RRF | Yes (it's purely retrieval) | 1 LLM call + N HNSW = 100–250 ms | Useful as gated upgrade |
| IRCoT (Trivedi 2023) | Retrieve after each CoT sentence | No (needs CoT) | seconds | Skip |
| FLARE (Jiang 2023) | Retrieve when token-prob low | No (needs gen logits) | seconds | Skip |
| Self-RAG (Asai 2024) | Reflection tokens | No (needs trained model) | seconds | Skip |
| Adaptive-RAG (Jeong 2024) | T5-based complexity classifier → 0/1/k retrievals | Partly — the *classifier* is reusable | classifier 5 ms | Borrow the classifier idea |
| GraphRAG (Edge 2024) | Community-summarized graph traversal | Yes for retrieval | Heavy offline indexing | Defer to v2 |
| HippoRAG (NeurIPS 2024) | Entity graph + Personalized PageRank | Yes | Moderate | Optional v2 for entity-heavy queries |
| ITER-RETGEN (Shao 2023) | Cyclic retrieve-generate | No | seconds | Skip |
| R3-RAG (arXiv 2505.23794) | RL-trained step-by-step retrieval | No | seconds | Skip |

**When multi-step beats single-shot diversification**: when sub-queries depend on intermediate results ("the article that the file I just opened references," "files that mention what was decided in the latest meeting") — a fundamentally different query class involving temporal/causal structure not present in "Mandarin and its history."

**When single-shot diversification suffices**: any query whose facets are *parallel* and *enumerable in advance from the query string alone*. Personal file search is overwhelmingly this class.

### D. Diversity-Aware Ranking — The Concrete Algorithmic Toolkit

- **MMR (Carbonell & Goldstein 1998)**: still the canonical baseline. λ ≈ 0.5–0.7 in most studies. Native MMR shipped in OpenSearch 3.3 (2025) for k-NN/neural queries — "diversity" parameter from 0 (relevance) to 1 (diversity).
- **xQuAD (Santos et al. 2010)** and **PM-2 (Dang & Croft 2012)**: explicit-aspect models. Both consistently beat MMR on TREC Web Track diversity. PM-2 is a simple proportional-allocation algorithm (Sainte-Laguë method on aspects), trivial to implement once aspects exist.
- **DPP MAP greedy (Chen et al. 2018, Wilhelm et al. 2018)**: production-quality, exact O(M³) Cholesky-based greedy. Continuing to perform competitively in 2024–2026 (SMART-RAG, MS-DPP, ScalDPP).
- **Calibrated diversification with feedback**: pin/open/click signals are sparse but actionable. The standard counterfactual learning-to-rank approach (Joachims et al. 2017; Oosterhuis 2023 for doubly-robust extensions) uses inverse-propensity weighting on observed clicks to correct for position bias. For personal single-user search, position bias is small (you scroll the whole list often), so a simpler online update of the diversity weight λ via exponentiated-gradient (Bandit-style) on observed open/pin signals is practical:
  - λ_t+1 = λ_t · exp(η · (r_diverse − r_focused))
  - where r_diverse is reward when a diverse result was opened, r_focused when a top-1 result was opened. Confidence: medium-high; this is well-established but rarely written up for personal search specifically.

### E. Query-Intent Gating — Concrete Heuristics

The intent gate is the most consequential design decision because it determines when the system spends extra latency. Recommended layered approach:

**Layer 1 (rule-based, ~1 ms)**:
- Compound keywords: " and ", " vs ", " versus ", " or ", " compared to ", " between ", " history of ", " evolution of ", " differences ", "/", regex `\b(\w+)\s+and\s+(\w+)`.
- Multiple noun phrases (spaCy small en_core_web_sm chunker, ~5 ms with model warm).
- Query length > 6 tokens AND contains conjunction.
- Quoted spans or boolean operators ⇒ usually lookup, override to single-shot.

**Layer 2 (embedding prototype, <1 ms, zero extra forward pass)**:
- Precompute prototype embeddings P_compound and P_single from ~30 hand-written exemplars each: P = mean(L2-normalize(emb(exemplar_i))). Examples for compound: "X and its history", "Python vs Rust performance", "differences between X and Y". Examples for single-shot: "the X file I edited yesterday", "draft of X", "presentation about X from last meeting".
- score = ⟨q_emb, P_compound⟩ − ⟨q_emb, P_single⟩.
- Use a margin τ; if |score| < τ ⇒ ambiguous, fall through to Layer 3.
- This is the same prototypical-network idea (Snell et al.) applied to query archetypes; zero training cost, ~50 lines of code.

**Layer 3 (small LLM confirmation, gated, ~80–150 ms)**:
- Only invoked if Layers 1+2 disagree or both are uncertain. Prompt Llama-3.2-3B with: "Does this query ask about ONE thing or MULTIPLE related aspects? Answer COMPOUND or SINGLE: '{q}'." Constrained generation to 1 token.
- Skippable; if time-budgeted hard, default to compound (fail-open to diversification, which costs little).

**Layer 4 (cross-encoder fallback, optional)**: ms-marco-MiniLM-L-6-v2 (22M params, ONNX, ~15–25 ms for 50 docs on CPU; FlashRank benchmarks). Reranks the top-50 of the diverse set on relevance — useful as a safety net when diversification has surfaced a borderline-irrelevant file.

**Recent cross-encoder evidence (Lu et al. 2025, arXiv 2502.x)**: even tiny rerankers like MiniLM internally reconstruct BM25-like statistics (soft TF, length normalization). Reranking quality plateaus quickly past 22M params for general-domain personal corpora — TinyBERT-L2 and MiniLM-L6 are the right CPU-budget operating points.

---

## Pseudocode — Recommended Pipeline

```python
# ============================================================
# Personal File Search: HNSW + Intent-Gated DPP-MAP Pipeline
# Production language: Node.js (better-sqlite3 + hnswlib-node)
# Pseudocode in Python for clarity.
# ============================================================

from dataclasses import dataclass
import numpy as np

# --- Data structures ---------------------------------------------------------

@dataclass
class FileRow:
    file_id: int
    path: str
    title: str
    mtime: float
    embedding: np.ndarray          # (768,), L2-normalized

@dataclass
class Candidate:
    file: FileRow
    relevance: float               # inner-product w/ query embedding, in [0,1] after rescaling
    facet_id: int = -1             # filled in by facet stage
    facet_score: float = 0.0       # similarity to facet centroid

@dataclass
class PipelineConfig:
    K_FINAL: int = 10
    K_CANDIDATES: int = 200        # HNSW top-K
    EF_SEARCH: int = 100
    DIVERSITY_LAMBDA: float = 0.6  # MMR fallback only
    DPP_THETA: float = 1.0         # DPP relevance temperature
    KMEANS_K: int = 5              # number of facets when implicit
    INTENT_MARGIN: float = 0.05    # prototype score margin
    COMPOUND_KEYWORDS = (
        " and ", " vs ", " versus ", " or ", " compared to ",
        " between ", "history of ", "evolution of ", "differences "
    )

# --- Embedding (Ollama) ------------------------------------------------------

def embed_query(q: str) -> np.ndarray:
    """Ollama nomic-embed-text. ~30-80 ms p95. L2-normalized."""
    v = ollama.embed("nomic-embed-text", q)         # 768-d
    return v / np.linalg.norm(v)

# --- Intent gate -------------------------------------------------------------

# Precomputed at startup from ~30 hand-curated exemplars per class.
P_COMPOUND: np.ndarray    # (768,) prototype, L2-normalized
P_SINGLESHOT: np.ndarray

def is_compound(q: str, q_emb: np.ndarray, cfg: PipelineConfig) -> bool:
    q_low = " " + q.lower() + " "

    # Layer 1: rule-based
    if any(kw in q_low for kw in cfg.COMPOUND_KEYWORDS):
        return True
    if q.count('"') >= 2:                            # quoted span => lookup
        return False
    if has_filename_signature(q):                    # extension, "draft of", date
        return False

    # Layer 2: embedding prototype, zero extra forward pass
    s = float(q_emb @ P_COMPOUND - q_emb @ P_SINGLESHOT)
    if s > cfg.INTENT_MARGIN:
        return True
    if s < -cfg.INTENT_MARGIN:
        return False

    # Layer 3 (optional, gated by env): small LLM single-token answer
    if EXPENSIVE_QUERY_MODE:
        return llm_compound_classifier(q)            # ~80-150 ms

    # Default fail-open: cheap diversification rarely hurts at k=10
    return True

# --- HNSW ANN search ---------------------------------------------------------

def hnsw_search(q_emb: np.ndarray, cfg: PipelineConfig) -> list[int]:
    hnsw_index.set_ef(cfg.EF_SEARCH)
    ids, _ = hnsw_index.knn_query(q_emb, k=cfg.K_CANDIDATES)
    return ids[0].tolist()

# --- SQLite metadata + embeddings hydration ---------------------------------

def hydrate(file_ids: list[int], q_emb: np.ndarray) -> list[Candidate]:
    rows = sqlite.prepare(
        f"SELECT id, path, title, mtime, emb FROM files WHERE id IN ({','.join('?'*len(file_ids))})"
    ).all(*file_ids)
    cands = []
    for r in rows:
        emb = np.frombuffer(r['emb'], dtype=np.float32)   # Float32 BLOB
        rel = float(q_emb @ emb)                           # inner product, already L2-normalized
        cands.append(Candidate(
            file=FileRow(r['id'], r['path'], r['title'], r['mtime'], emb),
            relevance=rel,
        ))
    return cands

# --- Facet extraction (used by Branch B) ------------------------------------

def extract_facets_implicit(cands: list[Candidate], k: int) -> tuple[np.ndarray, np.ndarray]:
    """k-means on candidate embeddings. Returns (centroids (k,768), assignments (M,))."""
    X = np.stack([c.file.embedding for c in cands])
    centroids, assignments = mini_batch_kmeans(X, k=k, n_init=4, max_iter=20)
    return centroids, assignments

def extract_facets_llm(q: str, cands: list[Candidate]) -> list[str]:
    """Optional: ask local 3B LLM, conditioned on top-30 titles, to name 3-5 facets."""
    titles = [c.file.title for c in cands[:30]]
    return ollama_generate("llama3.2:3b",
        f"Query: {q}\nTitles:\n{titles}\nReturn 3-5 short facet names, one per line.",
        max_tokens=80)                                     # ~80-150 ms p95

# --- DPP-MAP greedy selection (Chen et al. 2018) ----------------------------

def dpp_map_greedy(cands: list[Candidate], k: int, theta: float) -> list[int]:
    """
    Exact greedy MAP for DPP. Kernel L = diag(q) S diag(q) where:
        q_i = exp(theta * relevance_i / 2)   (quality)
        S_ij = <emb_i, emb_j>                (similarity, since L2-normalized)
    Complexity: O(k * M^2). On M=200, k=10: ~5-15 ms in pure NumPy.
    """
    M = len(cands)
    R = np.array([c.relevance for c in cands])
    Q = np.exp(theta * R / 2.0)
    X = np.stack([c.file.embedding for c in cands])        # (M, 768)
    S = X @ X.T                                            # (M, M)
    L = (Q[:, None] * Q[None, :]) * S
    # Incremental Cholesky-style: maintain ci (M, t), di2 (M,)
    di2 = np.diag(L).copy()
    selected, ci = [], np.zeros((M, 0))
    for _ in range(k):
        j = int(np.argmax(di2))
        if di2[j] <= 1e-12:
            break
        selected.append(j)
        # update
        if ci.shape[1] == 0:
            ei = L[:, j] / np.sqrt(di2[j])
        else:
            ei = (L[:, j] - ci @ ci[j, :]) / np.sqrt(di2[j])
        ci = np.concatenate([ci, ei[:, None]], axis=1)
        di2 = di2 - ei**2
        di2[j] = 0.0
    return selected

# --- Branch A: single-shot ---------------------------------------------------

def branch_singleshot(q_emb: np.ndarray, cfg: PipelineConfig) -> list[Candidate]:
    ids = hnsw_search(q_emb, cfg)[:cfg.K_FINAL]
    return hydrate(ids, q_emb)

# --- Branch B: compound / set-cover -----------------------------------------

def branch_compound(q: str, q_emb: np.ndarray, cfg: PipelineConfig) -> list[Candidate]:
    # 1. Wide HNSW
    ids = hnsw_search(q_emb, cfg)
    cands = hydrate(ids, q_emb)
    cands.sort(key=lambda c: -c.relevance)

    # 2. (Optional) facet extraction for UI labels
    centroids, assignments = extract_facets_implicit(cands, cfg.KMEANS_K)
    for c, a in zip(cands, assignments):
        c.facet_id = int(a)
        c.facet_score = float(c.file.embedding @ centroids[a])

    # 3. Set selection: DPP-MAP greedy
    chosen_idx = dpp_map_greedy(cands, k=cfg.K_FINAL, theta=cfg.DPP_THETA)
    chosen = [cands[i] for i in chosen_idx]

    # 4. (Optional) cross-encoder fine rerank inside-set, preserving cluster coverage
    if USE_CE_RERANK:
        chosen = ce_rerank(q, chosen)                      # ~15-25 ms

    return chosen

# --- Top-level entry ---------------------------------------------------------

def search(q: str, cfg: PipelineConfig = PipelineConfig()) -> list[Candidate]:
    q_emb = embed_query(q)
    if is_compound(q, q_emb, cfg):
        return branch_compound(q, q_emb, cfg)
    return branch_singleshot(q_emb, cfg)
```

---

## Latency Budget — Branch B, p95 < 300 ms

Targets are for a representative consumer laptop (M-series Mac CPU; mid-range x86 in parentheses where significantly different). Numbers triangulated from Ollama (collabnix.com 2025; morphllm.com 2026), hnswlib benchmarks (terencezl 2022, Marqo, Zilliz, APXML), Chen et al. 2018, FlashRank (Vaibhav Dixit 2026).

| Stage | Algorithm / call | p50 | p95 | Notes |
|---|---|---|---|---|
| Query embedding | nomic-embed-text via warm Ollama | 35 ms | 70 ms (90 ms x86) | Single call; warm-keep model in memory |
| Intent gate (Layers 1–2) | regex + spaCy small NER + 2 dot products | 3 ms | 8 ms | Reuses query embedding |
| HNSW search top-200 | hnswlib-node, M=16, efSearch=100 | 2 ms | 6 ms | N up to 200K, d=768 |
| SQLite hydrate 200 rows + Float32 embeddings | better-sqlite3 prepared stmt | 4 ms | 12 ms | INTEGER PK index; embeddings as 768·4 = 3 KB blobs |
| k-means on top-200 (k=5) | MiniBatchKMeans, 20 iter | 3 ms | 8 ms | For UI grouping; skip if not needed |
| DPP-MAP greedy (M=200, k=10) | Chen 2018 incremental Cholesky | 8 ms | 18 ms | Pure JS Float32Array; ~3 ms in C++ addon |
| Optional cross-encoder rerank (10 docs) | ms-marco-MiniLM-L-6-v2 ONNX | 8 ms | 18 ms | Top-10 only after diversification |
| Optional small-LLM facet labels (gated) | llama3.2:3b Q4_K_M, 50 tok | 90 ms | 150 ms (450 ms x86) | Only if EXPENSIVE_QUERY_MODE |
| Optional small-LLM intent confirm (gated) | llama3.2:3b, 1 tok | 50 ms | 100 ms | Only if Layers 1+2 ambiguous |
| **Total Branch B (no LLM)** | | **63 ms** | **140 ms** | comfortable headroom |
| **Total Branch B (with CE rerank)** | | **71 ms** | **158 ms** | recommended default |
| **Total Branch B (with LLM facet labels)** | | **161 ms** | **290 ms** | expensive mode; on x86 may breach |

**Risk**: Ollama cold-start can add 200–500 ms on the first call after model unload. Mitigation: keep-alive heartbeat every 4 minutes hitting the embed endpoint with a single token. **High confidence** the recommended default (no LLM at query time) is comfortably within budget.

---

## UI Exposure of Set Structure

Synthesizing Hearst's two-decade body of work (Flamenco, Scatter/Gather, *Search User Interfaces* 2009) with 2024–2026 IR UX patterns:

**Recommended pattern: Lightweight grouped list with explicit aspect tags, not a full faceted-navigation tree.**

Rationale:
- Hearst (2006, 2009) demonstrates that hierarchical/faceted navigation beats flat clusters when category structure is *known a priori*. Personal corpora rarely have such structure.
- Scatter/Gather's main lesson is that automatic clusters are useful *for navigation* but are noisy and need recourse — users want to escape a bad cluster fast.
- Faceted Clustering (Diederich et al. 2012, used by AMBIENT corpus) explicitly addresses "shadowing" — the same aspect repeating across clusters — which is exactly the anti-pattern set-cover prevents.
- 2024 work on Dropbox semantic search (dropbox.tech, 2024) showed users prefer *unobtrusive* relevance signals over heavy categorical structure for personal search.

**Concrete recommendations**:
1. **Single ranked list, but each row carries a facet pill**: e.g., row labeled with cluster name "Ming-Qing era" or "modern pedagogy" or "phonology". Facet name from k-LLMmeans-style summary or 1-call LLM ("name these 5 clusters") cached per query.
2. **A "facets covered" header bar above the list**: 5 small chips ("history" 2 files, "grammar" 3 files, "writing system" 2 files, "pedagogy" 3 files), with chip click filtering to that facet only — Flamenco-style query-preview counts but only for the *current result set*, not the whole corpus.
3. **An explicit "more like #3" / "exclude this aspect" affordance**: clicking it re-runs the query with one of the prototype embeddings subtracted (or adds the file to a `must_diversify_from` set). This implements user-controlled re-clustering without heavyweight UI.
4. **Avoid showing cluster centroids as separate cards** — Karger's Scatter/Gather UX research and later studies (Hearst CACM 2006) show users get lost; flat list with annotation is better.
5. **Pin/open/recency as implicit feedback**: surface a small "this set was useful" / "I wanted more X" thumbs-up/down at the bottom of the result page. Feeds the λ adjustment loop in §D.
6. **For compound queries, show 1–2 lines of LLM-generated rationale at top**: "Showing files covering: history of Mandarin (3 files), modern grammar (3 files), phonology (2 files), pedagogy (2 files)." This is the single highest-leverage UX element — it makes the set-cover behavior legible and trustworthy. Cost: 1 small-LLM call (~100 ms) — gate behind expensive mode or run async after first paint.

---

## Evaluation Methodology

### E.1. Synthetic Compound-Query Generation

Following the InPars (Bonifacio 2022) / InPars-V2 / Promptagator (Dai 2023) / **DataMorgana (Filice et al., arXiv 2501.12789, ACL 2025 industry track)** / **RAGAS (Es et al., EACL 2024)** lineage:

1. **Sample folder pairs / multi-folder topic spans** from the user's corpus (or a representative public corpus like Enron + arXiv subsets for development).
2. **Ground-truth construction**: for each pair (folder_X, folder_Y), the ground-truth file set for query "X and Y" is the union of representative files from each folder, deduped to ≈10–15 files. Use BERTopic or k-LLMmeans (Garrido-Merchán 2025) to label folders with 3-word topic names.
3. **LLM-generate compound query templates**:
   - "What is X and how does it relate to Y?"
   - "history of X"
   - "X vs Y"
   - "compare X and Y"
   - "evolution of X over time"
4. **DataMorgana-style diversification**: parameterize over user-archetype × question-style × specificity to get lexical, syntactic, and semantic diversity. Filice et al. (2025) show this dominates RAGAS and DeepEval on diversity metrics.
5. **Filter** with consistency check (Promptagator-style): does the original retriever rank at least one ground-truth file in top-50? If not, drop. Prevents pathological queries.
6. Aim for ~500–1000 synthetic compound queries + 500–1000 single-shot queries for the evaluation harness. Costs: ~1–2 USD if using gpt-4o-mini for generation (Pixion 2024 cost analysis); free if using local Llama 3.

### E.2. Metrics

- **α-nDCG@k** (Clarke et al., SIGIR 2008): primary diversity metric. α = 0.5 standard; α = 0.36 if using pattern-based subtopic extraction.
- **S-recall@k** (Subtopic Recall, Zhai et al. 2003): fraction of ground-truth subtopics with at least one file in top-k. Most directly measures "covers the query's facets".
- **Intent-cluster recall**: pre-cluster the *corpus* with k-means (k=20–50). For each query, intent_recall@k = (# distinct corpus-clusters represented in top-k) / (# distinct corpus-clusters in ground-truth set). Robust to noisy ground-truth subtopic labels.
- **Redundancy counter-metric**: max-cluster-share@k = max over corpus-clusters of (# top-k files in that cluster / k). Lower = more diverse. Penalizes the failure mode of "all 10 results from same cluster."
- **MAP / nDCG@10**: classic relevance backstop. Diversity at the cost of relevance is a regression.
- **Per-stage latency**: p50 and p95 measured at each pipeline stage on representative hardware; no stage allowed to exceed its budget by >25%.

### E.3. Baselines and Ablations

| Configuration | Purpose |
|---|---|
| Flat HNSW top-10 | Production baseline |
| HNSW + MMR (λ=0.6) | Cheapest diversification |
| HNSW + k-means selection (1 per cluster) | Naive coverage |
| HNSW + DPP-MAP greedy | Recommended Branch B core |
| HNSW + RAG-Fusion (3 rewrites + RRF) | Multi-query baseline |
| HNSW + LLM-generated facets + weighted set-cover | Most interpretable, highest latency |
| Full pipeline (intent gate + DPP-MAP + CE rerank) | Recommended ship config |
| Full pipeline minus intent gate (always diversify) | Tests gate value |
| Full pipeline minus CE rerank | Tests CE value |

Run all on ≥1000 queries, report α-nDCG@10, S-recall@10, intent-cluster recall, max-cluster-share@10, MAP, and stage latencies. Use bootstrap confidence intervals (n=1000) on the metric deltas.

### E.4. Failure-Mode Catalog

| Failure mode | Cause | Mitigation |
|---|---|---|
| Single-shot query misclassified as compound | Intent gate false positive (~5–10% expected) | Cost is small — DPP at k=10 with high λ ≈ relevance ranking; calibrate intent threshold τ on held-out set |
| Compound query misclassified as single-shot | Layer 1 keyword absence + ambiguous prototype score | Default fail-open to compound when |s| < τ |
| Corpus has no genuine facet structure for the query | Only 3 relevant files exist, all near-identical | DPP-MAP gracefully degrades — once di² → 0 it stops adding; cap k_final to (# files with relevance > θ) |
| Diversification removes the *one* relevant file | Small candidate set (M < 50) and one true positive surrounded by mediocre but spread-out distractors | Hard-keep top-1 by relevance unconditionally; apply DPP from rank 2 onward |
| LLM facet labels are misleading | 3B model hallucinates a facet name for a noisy cluster | Show facet labels only with confidence ≥ τ (use cosine of label embedding to centroid); fall back to top-3 tf-idf terms |
| Intent gate ambiguous, expensive mode disabled | Long compound query that lacks keywords | Bias prototype training to over-cover "wordy compound" archetypes; in worst case, default-compound is cheap |
| Cold-start Ollama latency | Model unloaded between sessions | Keep-alive ping every 4 min; warm-load at app startup |
| User explicitly wants the canonical-#1 result | "Find me my recommendation letter for Sarah" | Layer 1 detects "draft of", "letter for", named entity → singleshot; quoted spans always singleshot |

---

## Recommendation

**Architecture**: Two-branch pipeline gated by a layered intent classifier. Branch A is plain HNSW top-10 (current behavior). Branch B is HNSW top-200 → DPP-MAP greedy selection → optional cross-encoder rerank → optional k-LLMmeans facet labels for UI. No second model in the hot path; the local Llama-3.2-3B is gated behind `EXPENSIVE_QUERY_MODE` and only used for facet labels and ambiguous intent confirmation.

**Specific algorithm choices**:
- Intent gate: regex/keyword + spaCy small NER + embedding-prototype cosine. Threshold τ = 0.05, fail-open to compound.
- Set selection: **fast greedy DPP-MAP** (Chen et al. 2018) on M=200 with kernel L = diag(q) · X·Xᵀ · diag(q), q_i = exp(θ · rel_i / 2), θ = 1.0. k_final = 10.
- Facets for UI (optional): MiniBatchKMeans, k=5, on candidate embeddings. Labels via cached Llama-3.2-3B "name 5 clusters" call (lazy, async).
- Optional cross-encoder: ms-marco-MiniLM-L-6-v2 ONNX over top-10 only.
- HNSW: keep current M=16, efConstruction=200, efSearch=100. Bump efSearch to 150 for compound queries (cheap).
- RAG-Fusion / multi-query: gated, only for compound queries flagged "very ambiguous" (low relevance dispersion in candidates).

**Why this beats alternatives given the constraints**:
1. **Beats MMR-only**: DPP-MAP captures global volumetric diversity vs. MMR's pairwise local diversity. Gain of 2–4 α-nDCG points consistently in the literature (Chen 2018; SMART-RAG 2024). Same latency class.
2. **Beats explicit-aspect xQuAD/PM-2 in this setting**: those require a list of aspects, which costs an LLM call (~100 ms) and adds a failure mode (bad aspect list). DPP gets 70–80% of the explicit-aspect gain with no aspects needed.
3. **Beats RAG-Fusion as default**: RAG-Fusion's recall gains diminish with reranking + budget caps (arXiv 2603.02153). Latency is 3–4× higher. Gating it as an upgrade for ambiguous queries is the right tradeoff.
4. **Beats iterative methods (Self-RAG, IRCoT, FLARE, GraphRAG)**: those compensate for chunk-level retrieval and answer-generation needs not present here. Their CPU cost is incompatible with p95 < 300 ms.
5. **Beats SetR / OptiSet (2025–2026)**: superior on multi-hop QA *with a generator in the loop*, but require either fine-tuned LLMs or proprietary CoT prompting that don't fit a single-laptop, single-user constraint. Worth revisiting in v2 if a generator is added.
6. **Beats "always diversify mildly"**: the intent gate prevents diversifying single-shot queries where the user wants the *one* file. Without the gate, "the Mandarin tax form I edited yesterday" would surface unrelated Mandarin files. Cheap to implement, large UX win.

**Confidence levels**:
- DPP-MAP > MMR for set-cover: **high confidence** (consistent across literature 2018–2026).
- Latency budget achievable: **high confidence** (numbers triangulated from multiple independent benchmarks).
- Intent gate accuracy ≥ 85%: **medium-high confidence** (Agarwal et al. 2021 baseline; this corpus may differ).
- 3-5 facet labels are the right UX granularity: **medium confidence** (Hearst's work supports this; personal-search-specific UX evidence is thin).
- LLM facet labels add user value vs. raw cluster IDs: **medium confidence**, depends on user; A/B test in production.
- Skipping iterative retrieval is the right call: **medium-high confidence**, contingent on the assumption that personal-search queries are facet-parallel rather than reasoning-chained.

**Opposing views worth taking seriously**:
- *"Just always diversify mildly with MMR λ=0.7"*: defensible. It's simpler, has no gate to misfire, costs 2 ms, and recovers most of the gain. The case for the full pipeline rests on the user actually issuing compound queries often enough to make the explicit gating worth the engineering surface area.
- *"Don't decompose queries — let users refine"*: also defensible (Marchionini's exploratory-search position). Personal search has a "refine" affordance for free (just type more). The counter is that the canonical compound case ("Mandarin and its history") is exactly where users *don't* want to manually run two queries.
- *"DPP is overkill; MMR is good enough"*: empirically wrong on diverse-retrieval benchmarks (consistent 2018–2026 literature) but right *operationally* — if you're going to ship one thing first, ship MMR + intent gate, then upgrade the diversification primitive to DPP-MAP. The intent gate is the load-bearing component; the choice of diversifier is a refinement.

---

## Caveats

1. **Latency numbers for Ollama embedding calls vary widely** (15–80 ms reported across sources). The 30–80 ms range used here assumes a warm Ollama server with the model resident; cold starts can be 200–500 ms. The keep-alive recommendation is essential.
2. **Personal-search-specific evaluation evidence is thin**. Most diversification literature evaluates on TREC Web Track, MS MARCO, or BEIR — none of which look like a single user's 10⁴–10⁵ files. Numbers from those benchmarks are *suggestive*, not directly transferable. The synthetic eval methodology in §E is specifically designed to fill this gap.
3. **The (1−1/e) approximation guarantee for DPP-MAP holds only under the assumption that L is positive semidefinite**, which it is by construction here, but numerical issues with near-zero diagonal entries can cause greedy to terminate early. The pseudocode handles this with a 1e-12 threshold; production code should use float64 for the Cholesky updates even if embeddings are float32.
4. **The "compound" vs. "single-shot" dichotomy is a simplification**. Real query intent has 5+ classes (lookup, exploratory, comparison, transactional, navigational). Collapsing to two may misclassify ~10–15% of queries. Planning a third class — "ambiguous-disambiguation" needing clarification — is a likely v2 addition.
5. **Some 2024–2026 references include arXiv preprints with future-dated identifiers** (e.g., 2601.x, 2603.x, 2604.x in search results); these are cited as forward-of-print and may be revised. The substantive findings cited from each are corroborated by published work where possible.
6. **The intent prototype embeddings depend on the chosen exemplars** and will need re-tuning when nomic-embed-text is upgraded. Make this a config file, not hardcoded constants. Re-tune via held-out queries every 6 months.
7. **Cross-encoder reranking after diversification may *undo* the diversity** if applied naively to all 200 candidates; restrict it to the already-selected k=10 set, or use it as a tiebreaker within facet groups, not a global re-rank.
8. **HippoRAG / GraphRAG were dismissed for v1**. If user telemetry shows heavy entity-association queries ("everything mentioning person X across projects"), revisit — Personalized PageRank over an entity graph is the right tool there and is feasible at this corpus scale.
9. **"Soft constraint" on no second model** was honored in the hot path; the small LLM is only used in expensive mode and for offline facet-label caching. If even this is too much, the pipeline degrades cleanly to k-means + greedy weighted set-cover with tf-idf cluster labels at ~5 ms additional cost — same architecture, lower interpretability.
10. **The recommendation does not address security, indexing freshness, or hybrid lexical/semantic fusion explicitly**. The "default candidate set after HNSW (and eventual hybrid lexical fusion): top-200" hint suggests these are handled upstream; the diversification stage works equivalently on any pre-fused top-200, so no changes are needed when BM25/SQLite-FTS5 fusion is added — RRF the lexical and semantic candidate lists first, then DPP-MAP on the fused top-200.
