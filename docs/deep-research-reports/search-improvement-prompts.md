# Search Improvement — Deep Research Prompts

Four self-contained prompts for an external deep-research agent. Two on file-to-file relationship modeling (A1, A2), two on multi-term / topic-string retrieval (B1, B2).

Findings that motivated these prompts (Star Palace, May 2026):

- Search is pure dense embedding via `nomic-embed-text` (768D) → HNSW `ip` space.
- No lexical / BM25 / FTS / hybrid layer.
- Default embedding strategy is `content-only`, so folder names (e.g. `Mandarin/`) are not embedded for typical files.
- Edges are kNN-only (top-20, threshold 0.3 cosine), bidirectional. Folders are path-strings, never graph nodes.
- No re-ranking, no MMR, no query expansion, no query decomposition.
- Multi-term queries (e.g. "Mandarin and its history") fuse into one 768-d vector — sub-term specificity lost.

---

## Stack context block (paste at top of each prompt)

> Target system: local Electron app, single-user, ≤200K files. Daemon = Node + Express + SQLite (`better-sqlite3`) + `hnswlib-node` (inner-product space, M=16, efC=200, efS=100, dim=768). Embeddings: `nomic-embed-text` via local Ollama, L2-normalized, 8KB text cap per file. Edges table caps at K=20 per src, threshold 0.3 cosine. Layout: 8-component PCA → 2D. No GPU assumed. Memory budget: full index + embeddings already ~600MB at 200K; any new structure must be incremental and fit in <500MB additional. No network calls beyond local Ollama. Insert path is on the hot path (single-file save → reindex), so any per-file cost must be sub-100ms p50.

---

## Prompt A1 — Beyond cosine-kNN: multi-signal relationship graphs for personal file corpora

> [Stack context block]
>
> Current state: `edges(src_id, dst_id, weight, engine)` is populated by HNSW kNN over whole-file embeddings (top-20, threshold 0.3 cosine), bidirectionally upserted. The `engine` column already anticipates non-embedding edges but only `'embedding'` is written today. Filename, last-2 ancestor dirs, extension, mtime, size, OS use-count, view-count exist per file but contribute nothing to relationship inference. Folders are path-strings, never nodes.
>
> **Constraints to assume (answers to likely clarifying questions):**
>
> - **Primary use case for the graph**: drives (1) re-rank stage over HNSW top-200 search candidates and (2) on-canvas spatial layout + constellation grouping (PCA-input augmentation + connected-components clustering). Same edge weights serve both. Not a recommendation feed, not auto-tagging.
> - **Compute budget**:
>   - Per-insert (hot path): <100ms p50, <300ms p95. Single-file save recomputes edges for that node only.
>   - Full reindex (cold): <30 min for 200K on M-series laptop, single-threaded daemon, no GPU.
>   - Background re-score (drift): hourly window, ≤5% CPU sustained, ≤200MB scratch RAM.
>   - Ollama embed dominates (~30–80ms). One embed per insert; zero extra at query time beyond query embed.
> - **Feedback signal availability**: implicit + sparse only. Available today: `view_count`, `osUseCount`, `osLastUsed`, `first_seen`, `pinned_at`, `pin_alpha/beta`. Explicit but very sparse: `is_pinned`, `tags[]`, `star_type`, collection membership. **No click-through log on search results** (would require new event table). No pairwise "belong together" labels. Estimate <1% of files carry explicit signal; 10–30% have nonzero view_count. Treat learned-fusion as Phase 2 contingent on adding a search-event table; baseline must work without it.
>
> Research question: design a **multi-signal relationship graph** for ≤200K heterogeneous personal files (docs, notes, code, media metadata) where edges encode at least: (a) semantic similarity, (b) co-location (shared folder, sibling depth), (c) temporal co-activity (created/modified/opened in the same window), (d) lexical/entity overlap (shared rare terms or named entities), (e) structural references (markdown links, code imports, relative paths inside docs). For each signal: scoring function, decay, fusion into a single edge weight without one signal swamping others, sparsity strategy (~K=20–40 edges/node) under SQLite. Compare learned fusion (logistic regression on user pin/open feedback, only viable post-telemetry) vs hand-tuned weighted sum vs rank-fusion (RRF). Cite empirical results from PIM and desktop-search literature (Stuff I've Seen, Haystack, MyLifeBits, Semantic File System, recent Obsidian/Reflect/Mem.ai retrieval work, 2024–2026 multi-vector RAG / GraphRAG papers). Deliverable: ranked recommendation with concrete formulas, expected recall/precision deltas, migration plan for `edges` table (multiple rows per pair vs one fused weight).

---

## Prompt A2 — Folders, hierarchies, and topic centroids as first-class graph nodes

> [Stack context block]
>
> Current state: directories appear in the embedding prompt only for `metadata-*` strategies via `shortParent()` (last-2 ancestor dirs as a `parent:` line); `content-only` (the default) drops them entirely. No folder node in SQL, no centroid embedding per folder, no hierarchical retrieval. User pain: query "Mandarin" should obviously surface every file under `/.../Mandarin/`; today it surfaces semantically-near-but-unrelated docs.
>
> Research question: should folders (and other latent groupings — tag clusters, time buckets, project roots) be **first-class nodes**? Compare (1) folder-as-document with aggregated centroid embedding (mean / weighted-mean / Fréchet mean of children), (2) hierarchical / multi-resolution HNSW with promotion of internal nodes, (3) cluster-tree retrieval (SCANN-style, ColBERT-like late-interaction over folder-level summaries), (4) pure path-prefix lexical boost on top of dense scoring. For each: incremental centroid recompute when one child changes; cold-start when folder has 1–2 children; mixture-of-topics folders (cohesive + incoherent children); query-time HNSW cost when leaves and internals share an index; impact on `clusters` (currently connected-components on edge graph). Survey 2023–2026 literature on hierarchical retrieval (RAPTOR, GraphRAG, hierarchical navigable graphs, tree-of-clusters), and address whether the directory tree is a *prior* worth respecting vs a *bias* worth overriding. Deliverable: concrete schema changes, ingestion pipeline diff, quantitative argument for which option fixes the "Mandarin folder" failure without regressing semantic search.

---

## Prompt B1 — Hybrid lexical + dense retrieval for multi-clause queries on a 200K personal corpus

> [Stack context block]
>
> Current state: queries are embedded as one vector and HNSW-searched. No tokenizer, no inverted index, no FTS, no BM25, no SPLADE, no query rewriting. A query like "Mandarin and its history" produces one fused 768-d vector that loses the rare-term specificity of "Mandarin" against high-frequency words and stop-words. Hardware: single laptop, no GPU, ≤500MB additional RAM, p95 query latency budget 150ms.
>
> Research question: design a **hybrid retrieval** layer that, given a multi-term natural-language query, returns top files satisfying *the conjunction of salient terms* (not just the centroid). Cover: (a) SQLite FTS5 vs in-process BM25 (`tantivy` Node binding, embedded MeiliSearch, custom inverted index) — memory, build time, incremental update; (b) sparse-dense fusion — RRF, weighted score normalization, learned-to-rank, ColBERTv2 late interaction at this scale; (c) query-side decomposition — LLM-split clauses vs syntactic chunking vs IDF-weighted term selection, each clause searched then intersected/unioned; (d) SPLADE / learned sparse embeddings as unified replacement; (e) entity extraction at index time so "Mandarin" is recognized as strong-IDF and indexed in a separate proper-noun postings list. Discuss memory layout: postings-list compression (PFOR, Roaring), term-dictionary size for English+code+filenames (camelCase/snake_case tokenization), and where this lives relative to `better-sqlite3`'s page cache. Cite production hybrid systems (Vespa, Weaviate, Qdrant hybrid, 2024–2026 small-corpus hybrid search papers). Deliverable: chosen architecture, expected recall@10 lift on the "folder-name-as-query" failure mode, concrete file-by-file change list.

---

## Prompt B2 — From query string to a coherent file set: set-cover, sub-topic decomposition, retrieval as composition

> [Stack context block]
>
> Current state: search returns a flat ranked list of N files near the query centroid. No notion of *coverage* — for "Mandarin and its history", top-10 might all be modern Mandarin pedagogy with zero historical files even when historical files exist and are highly relevant. User goal: a query like "a text file about Mandarin and its history" should return a *set of files that together explain the topic*, not a redundant list near one mode.
>
> Research question: how to go from "top-K nearest" to "minimal file set that covers the query's sub-topics"? Survey: (a) **sub-topic decomposition** — LLM query rewriting into N facets vs unsupervised facet extraction from candidate-set embedding clusters (k-means on top-100 retrieved, MMR, DPP — determinantal point processes); (b) **set-cover formulations** — submodular maximization (greedy with (1−1/e) bound) over candidate facets, each file covering latent topics inferred from its embedding's projection onto query-conditioned axes; (c) **iterative retrieval** — RAG-fusion / Self-RAG / IRCoT-style multi-step where each step queries a different facet; (d) **diversity-aware ranking** — MMR, xQuAD, PM-2, calibrated against user pin/open feedback. For each: cost in extra Ollama embeddings (each ~30–80ms), SQLite read cost, client-side feasibility without a second model. Critically: detect when set-cover is the right mode (compound query, "and", "vs", "history of X") vs single-shot ("the Mandarin tax form I edited yesterday") — query-intent classification via small local model or rule-based heuristics. Cite 2024–2026 work on diverse retrieval, set-augmented generation, query understanding for personal search. Deliverable: pseudocode, latency budget breakdown staying under 300ms p95 for compound queries, UI exposure of set structure (groups, facets, "this file covers aspect X").
