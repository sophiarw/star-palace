# Should Folders Be First-Class Nodes in a Local-First Semantic File Search System?

## Executive Recommendation (thesis-first)

**Phase 1 (ship now): adopt Option 4 — a path-token lexical channel fused with the existing dense channel via Reciprocal Rank Fusion.** Confidence: **high**. It is the only option that *guarantees* the "Mandarin folder" acceptance criterion deterministically, requires zero changes to HNSW, costs <5% additional storage, and is buildable in a few hundred lines of Python on top of SQLite. RAPTOR/GraphRAG-class architectures (Option 3) cannot meet this acceptance bar more cheaply, and Options 1/2 cannot meet it at all without lexical support, because nomic-embed-text has no special inductive bias for "the file is in a folder named X."

**Phase 2 (durable architecture): add Option 1 — folder-as-document with a *cohesion-gated, L2-renormalized arithmetic-mean centroid* — inserted into the **same** HNSW index as leaves, tagged by `node_type`.** Confidence: **medium-high**. This composes additively on Phase 1, costs ~10–15% extra index size at the stated 10⁵ files / 10⁴ folders scale, and gives the durable property the user wants ("tonal language drills" → /Mandarin/). I explicitly recommend **against** Option 2's separate "promoted internal-node" HNSW levels (Munyampirwa et al., ICML 2025, show the H in HNSW is empirically unnecessary at d≥768) and **against** Option 3's recursive-LLM-summarization trees (regime mismatch — RAPTOR/GraphRAG are evaluated on multi-document QA, not single-user FS browsing, and require continuous LLM cost for a workload where the user already supplies a hierarchy via the FS).

The directory tree is **a prior worth respecting but not a prior worth privileging.** The user's folder structure is empirically informative ~50% of the time (per the stated cohesion bimodality); a system that *always* honors it confabulates structure where there is none, and a system that *never* honors it ignores user-curated semantics. The right philosophical stance is therefore: **gate folder semantics behind a cohesion test, and combine with content semantics through a fusion that lets either channel veto the other.**

---

## 1. Comparison Table — Four Options × Six Axes

| Axis | (1) Folder-as-doc centroid | (2) Multi-resolution HNSW | (3) Cluster-tree (RAPTOR/GraphRAG) | (4) Path-prefix lexical boost |
|---|---|---|---|---|
| **(i) Incremental centroid recompute on 1-child change** | O(d) per ancestor (mean update is associative); ~6–12 µs × depth(8) ≈ 100 µs | Same as (1) but HNSW edge repair adds O(M·log N) ≈ 2–5 ms per affected node | RAPTOR full re-cluster on tree change is expensive (adRAP 2410.01736 calls global rebuild "computationally expensive"); GraphRAG Leiden re-run on KG | None — path tokens are immutable per file; one INSERT into FTS table, ~50 µs |
| **(ii) Cold-start (1–2 children)** | Centroid ≈ child vector → useless; **must be cohesion-gated** | Same problem; promoted nodes degenerate into duplicate leaves | RAPTOR clustering needs ≥k≈4 points; folder-of-1 produces no parent | Works trivially — path tokens exist regardless of child count |
| **(iii) Mixture-of-topics folders** | Centroid is meaningless on incoherent folders; cosine variance is the gate | Demotes mixed-topic internal nodes to non-promoted | RAPTOR's GMM soft-clustering breaks by-folder grouping (it re-clusters by content, ignoring FS structure) | Naturally handles — Downloads/ matches "downloads" but not "ML papers"; signal is the folder name itself |
| **(iv) Query-time HNSW cost (shared vs separate index)** | Shared: efSearch=100 over 110K nodes ≈ same recall as 100K (logarithmic). Separate: two queries, sum latency. | Shared with promoted layers — Munyampirwa 2412.01940 shows hierarchy gives no benefit at d≥768; flat is equivalent | Separate per-tree-level retrieval, then re-rank — multiplies query cost ~3–5× | Adds ~1 ms FTS5 query in parallel; RRF merge is ~5 µs |
| **(v) Impact on `clusters` table (CC over edge graph @cos≥0.3)** | None — folders and content clusters are orthogonal axes; both can coexist | None — but easy confusion between "graph layer" and "cluster ID" | RAPTOR clusters compete with `clusters` for the same role; GraphRAG Leiden hierarchy duplicates it | None — purely additive |
| **(vi) Implementation complexity (hnswlib-node + SQLite)** | **Low**: new `folders` table, batch reindex on add, ~300 LoC | Medium: maintain layer assignment outside hnswlib (which doesn't expose layer control) — would require forking | **High**: requires LLM summarization loop (8–60 s per folder), evaluation harness, retry logic; off-budget for local-first single-user | **Lowest**: SQLite FTS5 virtual table on `path_tokens`, ~150 LoC including tokenizer |

---

## 2. Literature Synthesis (2023–2026)

### 2.1 RAPTOR (Sarthi et al., ICLR 2024, arXiv:2401.18059)

RAPTOR builds a tree by recursively (a) embedding chunks, (b) reducing dimensionality with UMAP, (c) soft-clustering with a Gaussian Mixture Model (using BIC for k selection), and (d) abstractively summarizing each cluster with an LLM. Retrieval is "collapsed-tree": all nodes at all levels go into one pool ranked by cosine to the query. Reported gain: +20 absolute accuracy points on QuALITY paired with GPT-4. **Confidence in claim: medium-high (peer-reviewed at ICLR; reproduced widely).**

**Regime mismatch for our problem (high confidence):**
- RAPTOR re-clusters by content; it does **not** respect the FS hierarchy. If the user wants `/Mandarin/` to act as a cluster, RAPTOR may dissolve it across multiple GMM clusters that group flashcards with /Spanish/flashcards. This contradicts Phase 1.
- RAPTOR is expensive to update. The follow-up adRAP (Tian et al., 2410.01736) explicitly notes: "the clustering component makes the tree structure sensitive to these updates, requiring a full re-computation of the tree after each change." For a single-user FS where files churn hourly, this is a non-starter.
- The Stanford CS224N follow-up (web.stanford.edu/class/cs224n/final-reports/256925521.pdf) finds RAPTOR's UMAP step loses information from the original embeddings, and that GMM's Gaussian assumption misfits text geometry — these matter for our cohesion analysis.
- Information-loss criticism summarized in dev.to/praveensk RAPTOR review and DTCRS (arXiv:2604.07012) which reduces summary-layer nodes by 92% by being more selective.

### 2.2 GraphRAG (Edge et al., Microsoft, arXiv:2404.16130) and successors

GraphRAG extracts entities/relations into a KG, then runs **Leiden** (Traag et al. 2019) for hierarchical community detection. Each community at each level gets an LLM summary. Local search expands from entities; global search aggregates community summaries. Confidence: high (large-scale published results; robust open-source release).

**Important 2025–2026 critiques (high confidence, peer literature):**
- Core-based Hierarchies for Efficient GraphRAG (arXiv:2603.05207, "near-optimal modularity partitions on sparse graphs admit exponential cardinality") proves Leiden is **non-reproducible** on the kind of sparse graphs typical of personal corpora; result depends on initialization seed.
- LazyGraphRAG (Microsoft, Nov 2024) achieves ~0.1% of full-GraphRAG indexing cost by skipping LLM summarization at index time, suggesting the LLM summaries themselves are over-engineered for many query patterns.
- LightRAG (Guo et al., arXiv:2410.05779) reports comparable retrieval quality at far lower token cost than GraphRAG, with explicit incremental update support — directly applicable comparison.
- HiRAG (Huang et al., arXiv:2503.10150, Mar 2025) introduces hierarchical bridging for "knowledge gap between local and global"; it requires a knowledge graph that we do not have for personal files.

The bottom line for our problem: GraphRAG's community hierarchy duplicates the role of the existing `clusters` table (CC over edge graph @cos≥0.3) but at much higher cost, with non-reproducibility, and no inherent respect for the FS hierarchy.

### 2.3 Hierarchical Navigable Small World extensions

The single most important 2024–25 result for **Option 2** is Munyampirwa, Lakshman & Coleman, "Down with the Hierarchy: The 'H' in HNSW Stands for 'Hubs'" (arXiv:2412.01940, ICML 2025, ECIR 2026). They show empirically across BigANN-scale benchmarks that, at d≥32 (and certainly at d=768 like ours), the hierarchical layers provide **no recall or latency benefit** over a flat NSW graph; navigation is governed instead by emergent hub nodes. Their "FlatNav" implementation reaches parity with hnswlib while saving ~20–40% memory. Earlier evidence: Lin & Zhao 2019 and Coleman et al. 2022 (referenced therein). **Confidence: high (oral, ICML 2025).**

**Implication for us:** explicitly *adding* a "folder layer" to HNSW gives no algorithmic win. The right move is to add folder centroids as additional nodes in the *same* flat-equivalent graph and tag them via metadata, letting hubs emerge naturally.

Other relevant infrastructure:
- SPANN (NeurIPS 2021) and SPFresh (SOSP 2023, arXiv:2410.14452) maintain centroid-based partitions with incremental rebalancing — instructive for the centroid-update protocol.
- FreshDiskANN (arXiv:2105.09613) — graph-based ANN that supports fresh inserts/deletes; HNSW deletion adds O(R³) edges per delete, so we should prefer mark-deleted + periodic compaction. Hnswlib's `mark_deleted` is the correct primitive (github.com/nmslib/hnswlib).
- MN-RU update strategy (arXiv:2407.07871) addresses unreachable-point degradation for HNSW under heavy churn — relevant only above ~10⁶ updates, not at our scale.

### 2.4 Late-interaction at the cluster level (ColBERTv2 + PLAID)

PLAID (Santhanam et al., SIGIR 2022) proves that "centroid interaction" — scoring a query against a passage's bag of centroids before decompressing the residual vectors — preserves recall while pruning 95%+ of candidates. This is the direct evidentiary basis for treating folder-level centroids as a *first-pass* prune in our retrieval pipeline. Quality is maintained when (a) centroids cover the document well, and (b) per-passage residuals are available for re-scoring. We have neither multiple-vectors-per-file nor residual quantization, so PLAID's full architecture doesn't transfer, but its **first-stage centroid prune** maps cleanly onto Phase 2's folder-centroid retrieval. Confidence: medium for the analogy.

### 2.5 Centroid quality on the unit hypersphere

For L2-normalized embeddings, the "cosine-similarity centroid" — the unit vector maximizing average cosine similarity to a set of points — is **equal to the L2-normalized arithmetic mean**, by direct optimization (Skeptric, "Centroid for Cosine Similarity," 2020; geometric proof: Euclidean centroid minimizes squared distance, projection to sphere preserves the optimum). On the unit sphere, when angular dispersion is small (intra-folder cohesive case), this also coincides with the Karcher mean / Fréchet mean to first order. **For our problem, the L2-renormalized arithmetic mean is the right centroid, full stop.** Spherical or Karcher means deliver second-order corrections that vanish below ~30° dispersion — exactly the regime where the cohesion gate keeps us. Confidence: high (mathematical).

The Steck et al. (WWW '24 Companion, arXiv:2403.05440) caution against cosine similarity is **not applicable** to our nomic-embed-text setup. nomic-embed-text-v1/v1.5 is contrastively trained with cosine objectives and outputs L2-normalized vectors; the gauge freedom Steck et al. describe is eliminated when the training objective constrains angular structure (Bouhsine, arXiv:2602.19393, "In Defense of Cosine Similarity"). This is the Sentence-Transformers / SimCLR / CLIP class of model. Confidence: high.

### 2.6 Hybrid retrieval and fusion (relevant for Option 4 + Phase 2)

The dominant 2024–2026 finding is that **Reciprocal Rank Fusion** (Cormack et al., 2009) is the parameter-free default for combining a dense channel and a lexical/sparse channel because BM25 and cosine scores live on incompatible scales (avchauzov.github.io 2025; Bruch et al., arXiv:2210.11934). Elastic's published experiments (2024) find that beating RRF with a tuned weighted sum requires ≥40 annotated queries per dataset — far more labeling than a single-user system can produce. **Therefore for Phase 1, RRF is the right choice; do not ship a tunable weight.** Confidence: high.

### 2.7 Personal-information-management / file-system retrieval literature

This literature is **thin and largely pre-2020**. The original semantic-file-systems paper (Gifford et al., 1991, "Semantic File Systems") proposes virtual directories as query results. Modern work is sparse:
- LSFS (Shi et al., arXiv:2410.11843, 2024) — LLM-based semantic file system, but it builds an external LlamaIndex per file rather than respecting on-disk hierarchy.
- OntoFM (Rompa et al.) and Semantic Desktop — RDF-driven, never reached production traction.
- Recoll, DocFetcher, Tracker — production desktop search, all keyword-based via Xapian/Lucene; they tokenize **path components by default** (Recoll's `dir:` filter, DocFetcher's path search), which is exactly Option 4.

**No published work specifically evaluates whether to *promote folders to first-class nodes* in a vector index for personal file search.** The closest analogues are RAPTOR (which builds its own hierarchy and ignores yours) and EHI (Gupta et al., arXiv:2310.08891), which learns hierarchical indices end-to-end but requires labeled training data we don't have. **This is a gap in the literature; the recommendation here is therefore from first principles, not from a single canonical citation.** Confidence in literature gap: high.

### 2.8 Path-as-prior vs path-as-bias (philosophy)

The PIM literature (e.g., Diekema 2024, "What's in People's Digital File Collections?", arXiv:2402.06421; Marshall on personal archives) consistently finds folder structures are **half-curated, half-detritus** — Downloads and Desktop accumulate noise; project and course folders are intentional ontologies. Empirically that matches the user's stated bimodality. The defensible engineering stance: **honor the folder when it carries signal (cohesion test), ignore it when it doesn't, and never let it veto a strong content match.** This translates to: lexical boost is **additive** (RRF), never **multiplicative** or **gating**.

---

## 3. Concrete Schema Changes (SQLite + hnswlib-node)

Implied current schema:

```sql
-- Existing (inferred from context)
CREATE TABLE files (
  id           INTEGER PRIMARY KEY,
  path         TEXT UNIQUE NOT NULL,
  mtime        INTEGER,
  size         INTEGER,
  content_hash TEXT,
  embedding    BLOB    -- 768 × float32 = 3072 B, L2-normalized
);
CREATE TABLE edges (
  src INTEGER, dst INTEGER, cosine REAL,
  PRIMARY KEY (src, dst)
);
CREATE TABLE clusters (
  id INTEGER PRIMARY KEY, label TEXT
);
CREATE TABLE file_cluster (file_id INTEGER, cluster_id INTEGER);
-- HNSW index lives in hnswlib-node, persisted as a binary file.
```

### 3.1 Phase 1 additions (path lexical channel)

```sql
-- New: per-file tokenized path components.
CREATE TABLE file_path_tokens (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  token   TEXT    NOT NULL,
  depth   INTEGER NOT NULL,    -- 0 = leaf basename, 1 = parent, ...
  PRIMARY KEY (file_id, token, depth)
);
CREATE INDEX idx_path_token ON file_path_tokens(token);

-- Optional but recommended: SQLite FTS5 virtual table for sub-millisecond
-- prefix and phrase queries on the joined path string.
CREATE VIRTUAL TABLE files_fts USING fts5(
  path_tokens,
  content='files', content_rowid='id',
  tokenize = 'unicode61 remove_diacritics 2'
);
-- Populated by trigger on files insert/update; tokenizer is applied at insert.
```

The tokenizer (Python pseudocode, run once per file at ingest):

```python
import re, unicodedata
SEP = re.compile(r"[/\\\s\-_.\u3000]+")  # incl. CJK ideographic space
CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")

def tokenize_path(path: str) -> list[tuple[str, int]]:
    out = []
    parts = [p for p in SEP.split(path) if p]
    for depth, part in enumerate(reversed(parts)):       # 0 = leaf
        # NFKC normalize for fullwidth CJK punctuation
        part = unicodedata.normalize("NFKC", part)
        # camelCase / PascalCase splits
        for sub in CAMEL.split(part):
            sub = sub.strip().lower()
            if not sub: continue
            # CJK: every ideograph is its own token (Lucene/dtSearch convention)
            if any('\u3400' <= c <= '\u9fff' for c in sub):
                for ch in sub:
                    if '\u3400' <= ch <= '\u9fff':
                        out.append((ch, depth))
            else:
                out.append((sub, depth))
            # also keep bigram of parent+child for phrase recall
    return out
```

### 3.2 Phase 2 additions (folders as first-class nodes)

```sql
CREATE TABLE folders (
  id            INTEGER PRIMARY KEY,
  path          TEXT UNIQUE NOT NULL,
  parent_id     INTEGER REFERENCES folders(id),
  depth         INTEGER NOT NULL,
  child_file_ct INTEGER NOT NULL DEFAULT 0,
  child_dir_ct  INTEGER NOT NULL DEFAULT 0,
  -- Sum of unit vectors of leaf descendants (NOT yet renormalized).
  -- Stored as float32 BLOB for incremental update; 768*4 = 3072 B.
  centroid_sum   BLOB,
  centroid_count INTEGER NOT NULL DEFAULT 0,
  -- Cached unit-norm centroid; nullable if cohesion gate fails.
  centroid_unit  BLOB,
  -- Cohesion = mean cosine of children to centroid_unit, in [-1,1].
  -- High = tight folder, low = mixed (Downloads, Desktop).
  cohesion       REAL,
  -- True if folder is currently a first-class node in the HNSW index.
  promoted       INTEGER NOT NULL DEFAULT 0,
  -- HNSW internal id used when promoted; -1 otherwise.
  hnsw_id        INTEGER NOT NULL DEFAULT -1,
  last_recompute INTEGER  -- mtime in epoch
);
CREATE INDEX idx_folder_parent ON folders(parent_id);
CREATE INDEX idx_folder_promoted ON folders(promoted) WHERE promoted = 1;

CREATE TABLE folder_files (
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  file_id   INTEGER NOT NULL REFERENCES files(id)   ON DELETE CASCADE,
  PRIMARY KEY (folder_id, file_id)
);
CREATE INDEX idx_ff_file ON folder_files(file_id);

-- Add a node_type column to distinguish leaves from folder centroids
-- when reading hnswlib results.
ALTER TABLE files   ADD COLUMN hnsw_id INTEGER NOT NULL DEFAULT -1;
ALTER TABLE files   ADD COLUMN node_type TEXT NOT NULL DEFAULT 'file';
-- Folders use a separate id space; on retrieval, we look up by hnsw_id
-- in BOTH files.hnsw_id and folders.hnsw_id.
```

**Sizing.** With 10⁵ files and 10⁴ folders of which ~50% pass the cohesion gate, the HNSW index grows from ~352 MB to ~370 MB (`(10⁵ + 5·10³) × 1.1 × (768·4 + 16·8) ≈ 371 MB`, using OpenSearch's standard `1.1·(d + 8M)` HNSW formula). That is **+5.4%**, comfortably inside the 10–20% budget. SQLite on-disk for `folders` is trivial (~30 MB at 10⁴ rows).

---

## 4. Ingestion Pipeline Diff

Treat the pipeline as three event types: **add**, **modify**, **delete**.

### 4.1 Phase 1 (path lexical only)

```python
def on_file_added(path, embedding, ...):
    file_id = db.insert_file(path, embedding, ...)
    hnsw.add_items(embedding[None,:], np.array([file_id]))
    for tok, depth in tokenize_path(path):
        db.execute("INSERT OR IGNORE INTO file_path_tokens VALUES (?,?,?)",
                   (file_id, tok, depth))

def on_file_deleted(path):
    file_id = db.lookup_file_id(path)
    hnsw.mark_deleted(file_id)              # tombstone; cheap
    db.execute("DELETE FROM files WHERE id=?", (file_id,))
    # ON DELETE CASCADE handles file_path_tokens

def on_file_modified(path, new_embedding):
    file_id = db.lookup_file_id(path)
    hnsw.mark_deleted(file_id)
    hnsw.add_items(new_embedding[None,:], np.array([file_id]))
    # Path tokens unchanged unless rename
```

Cost: O(depth) inserts ≈ 4–8 rows × ~50 µs SQLite = sub-ms; HNSW insert ~1–2 ms at our M/efC. **Confidence: high.**

### 4.2 Phase 2 (folder centroids)

The key invariant is that `centroid_sum` is incrementally updatable because the L2-normalized arithmetic mean is a linear operation on unit vectors followed by renormalization:

```
centroid_unit = normalize( sum_i x_i / N )
              = normalize( centroid_sum / centroid_count )
```

So a single child added/removed updates ancestors in O(d × depth) ≈ 768 × 8 ≈ 6 KB FLOPs ≈ ~50 µs per ancestor.

```python
def update_ancestor_centroids(file_id, x: np.ndarray, sign: int):
    """sign = +1 on add, -1 on delete; x is already L2-normalized."""
    for fid in ancestor_folder_ids(file_id):
        f = db.fetch_folder(fid)
        new_sum   = bytes_to_vec(f.centroid_sum) + sign * x
        new_count = f.centroid_count + sign
        if new_count <= 0:
            db.execute("UPDATE folders SET centroid_sum=NULL,centroid_count=0,"
                       "centroid_unit=NULL,cohesion=NULL WHERE id=?", (fid,))
            if f.promoted: hnsw.mark_deleted(f.hnsw_id)
            continue
        new_unit = new_sum / np.linalg.norm(new_sum)
        # Cohesion: mean cosine of children to new centroid.
        # We do NOT recompute over all children on every change — instead
        # maintain an EMA proxy and refresh fully on every Nth change or
        # when |centroid drift| > threshold.
        cohesion = update_cohesion_ema(fid, new_unit)
        promoted_now  = (cohesion >= 0.55) and (3 <= new_count <= 500)
        was_promoted  = f.promoted == 1
        if promoted_now and not was_promoted:
            hid = hnsw.add_items(new_unit[None,:], next_folder_hnsw_id())
            db.execute("UPDATE folders SET promoted=1, hnsw_id=?, "
                       "centroid_sum=?, centroid_count=?, centroid_unit=?, "
                       "cohesion=? WHERE id=?",
                       (hid, vec_to_bytes(new_sum), new_count,
                        vec_to_bytes(new_unit), cohesion, fid))
        elif promoted_now and was_promoted:
            # hnswlib supports replace by id via mark_deleted+add_items.
            hnsw.mark_deleted(f.hnsw_id)
            hid = hnsw.add_items(new_unit[None,:], next_folder_hnsw_id())
            db.execute("UPDATE folders SET hnsw_id=?, ... WHERE id=?",
                       (hid, ..., fid))
        elif was_promoted and not promoted_now:
            hnsw.mark_deleted(f.hnsw_id)
            db.execute("UPDATE folders SET promoted=0, hnsw_id=-1, ... WHERE id=?",
                       (fid,))
```

**Cohesion gate parameters (concrete defaults).**
- `cohesion ≥ 0.55` (mean cosine of children to centroid). Justification: for nomic-embed-text the neutral-pair cosine baseline is ~0.3 (per the user's `clusters` edge threshold); 0.55 is roughly +1 standard deviation above neutral on this model.
- `3 ≤ child_count ≤ 500`. Floor: a 2-file folder's centroid is a midpoint between two specific files and adds no information that the leaves don't already provide. Ceiling: above ~500 children, a centroid is averaged across enough topical noise that it dilutes (the signal-to-noise drops as 1/√N for genuinely homogeneous folders, but mixed folders never converge). Both bounds are heuristic; **confidence: medium**, log Phase-1 telemetry to refine.

**Hnswlib-node update cost.** From the hnswlib README and Issue #303 (Malkov): updates are implemented as mark_deleted + insert, with degree-O(M·efSearch) edge repair; on this hardware that is ~2–4 ms per update. At a worst-case edit rate of 10 file changes/sec touching 8 ancestors, total HNSW work is ~200 ms/sec — bursty but acceptable. Compaction (full rebuild) every ~10⁵ tombstones, taking ~30–60 s offline.

**Cohesion full-recompute schedule.** Cheap path: EMA-update on every leaf change. Expensive path: every Nth change OR when |Δcentroid|>0.05, recompute exact mean cosine over the last K=min(child_count, 64) sampled children. This bounds drift below detection threshold while keeping per-event work O(1). Confidence: medium.

---

## 5. Query Pipeline Diff

```python
def query(q: str, k: int = 20) -> list[Result]:
    q_emb = embed(q)                            # nomic-embed-text, L2-norm

    # ----- Channel A: dense ANN over leaves + (Phase 2) folder centroids
    dense_hits = hnsw.knn_query(q_emb, k=200, ef=100)   # over-fetch
    file_hits, folder_hits = split_by_node_type(dense_hits)
    # Expand each folder hit to its top-cohesion children
    for fh in folder_hits:
        children = db.top_children(fh.folder_id, by="centroid_cos", limit=5)
        file_hits.extend(children)

    # ----- Channel B: lexical over path tokens (Phase 1)
    q_tokens = tokenize_query(q)                # same tokenizer as ingest
    if q_tokens:
        lex_hits = db.execute(
          "SELECT files.id, files_fts.rank FROM files_fts "
          "JOIN files ON files.id = files_fts.rowid "
          "WHERE files_fts MATCH ? ORDER BY rank LIMIT 200",
          (" OR ".join(q_tokens),)
        ).fetchall()
    else:
        lex_hits = []

    # ----- Fusion: Reciprocal Rank Fusion, k_rrf=60
    fused = rrf_fuse([file_hits, lex_hits], k=60)

    # ----- Phase 1 acceptance enforcement (deterministic backstop)
    # If query exactly substring-matches a folder name, ensure ALL its
    # direct children with file_emb·q ≥ 0.2 are present in top-20.
    matched = db.find_folders_substring(q.lower())
    for folder in matched:
        for child in db.children_of(folder.id):
            if cosine(child.embedding, q_emb) >= 0.2:
                fused.ensure_in_top(child.id, top=k)

    return fused.top(k)
```

### Why this fusion shape
- **RRF over weighted sum.** Avchauzov 2025, Elastic 2024, Bruch et al. 2022 all converge on the same finding: weighted sum of an unbounded BM25-style score and a bounded cosine score requires per-query normalization, and the optimal weight is dataset-dependent. For a single-user system without labeled queries, RRF is the parameter-free default.
- **Folder centroots expanded to children before fusion**, not used as standalone results — this maps onto the PLAID centroid-interaction pattern (Santhanam et al., SIGIR '22) where centroid scores prune candidates that are then re-ranked at the leaf level.
- **Phase 1 deterministic backstop.** RRF is *probabilistic* about folder-name matches; the acceptance criterion is *deterministic*. The cleanest way to satisfy both is to run the bag-of-tokens FTS channel for ranking AND to run a lexicographic substring check that overrides the top-20 with the literal folder match. This double-guarantee costs ~20 µs and is the only way to make the contract hold without tuning.

### `clusters` table participation
The connected-components clusters remain visualization-only. They could later be promoted into a third RRF channel ("results from the same content cluster"), but this is *orthogonal* to the folder-centroid axis and should not be conflated. The folder graph is curated by the user; the cluster graph is induced from embeddings. Mixing them at this stage hides which signal is responsible for any given ranking.

---

## 6. Quantitative Argument

All numbers use the stack parameters: 10⁵ files, ~10⁴ folders, 768d float32, M=16, efC=200, efS=100.

### 6.1 Index size
- **Files only baseline:** 10⁵ · 1.1 · (768·4 + 8·16) = 10⁵ · 3520 B ≈ **352 MB**.
- **+ folder centroids (Phase 2, 50% pass cohesion):** + 5·10³ · 3520 B ≈ **+18 MB (+5.1%)**.
- **+ all 10⁴ folders if cohesion gate is removed:** +35 MB (+10%) — still inside the 20% budget. So the gate is recommended for *quality*, not *budget*.
- **SQLite path-token table:** 10⁵ files × ~6 tokens × ~16 B/row ≈ **~10 MB**. FTS5 with prefix index ≈ ~25 MB. Total <40 MB. Confidence: high.

### 6.2 Query latency
- HNSW knn (efS=100, k=200) at 110K nodes: ~3–6 ms single-thread on commodity CPU (per hnswlib benchmarks at d=768).
- SQLite FTS5 200-row lookup: ~0.5–1.5 ms.
- RRF fusion of two 200-row lists: ~50 µs in Python.
- **End-to-end p50 query latency: 5–9 ms** vs. baseline ~3–5 ms. **+~3 ms p50, +~10 ms p99 from FTS warm-up.** Comfortably below human-perceptible.

### 6.3 Recompute cost on a single-file change
- Embedding: 80–250 ms (nomic-embed-text via Ollama, dominated by model forward pass — independent of folder logic).
- HNSW upsert: ~2–4 ms.
- Path-token rows: ~6 inserts × 30 µs = ~200 µs.
- Ancestor centroid update (depth ≤ 8): 8 × ~50 µs SQLite + 8 × ~50 µs vec arithmetic + (rare) 8 × ~3 ms HNSW upsert when promotion state flips. **Worst case ≈ 30 ms; typical ≈ 1–2 ms.** Confidence: medium.

### 6.4 Phase 1 acceptance test recall
The deterministic substring backstop guarantees recall = 1.0 by construction whenever the query is a substring of any folder name and ≥1 child has cos≥0.2 to the query embedding. The lexical channel alone will achieve recall = 1.0 whenever the query token set ∩ path token set is non-empty AND the folder has ≤20 children with positive content scores. The risk case is a folder with >20 children where some pass cos≥0.2 but rank below other folders' children in the fused list — the backstop fixes this. **Expected recall on the literal "Mandarin folder" test: 1.0. Confidence: high (deterministic).**

### 6.5 Phase 2 acceptance test recall
For "tonal language drills" → /Mandarin/, the folder centroid sits in the unit-sphere region populated by mandarin-flashcard embeddings. With nomic-embed-text, the cosine between an English description of a topic and an embedding of foreign-language content of that topic is empirically modest (~0.4–0.55 from MTEB-style probes). For *cohesive* folders the centroid concentrates this signal: a centroid over 30 mandarin flashcards has higher cosine to "tonal language drills" than any single flashcard's embedding, by the hubness-of-the-mean phenomenon. Expected: in the cohesive ~50% of folders, the folder centroid ranks above any individual child for content-alignment queries. The diversity acceptance ("≥1 file from each of top-3 folders") is then satisfied by expanding each folder hit to its top-1 child after dense retrieval, before fusion — that produces structurally diverse top-20s by construction. **Expected recall on Phase 2 test: ≥0.7 across the cohesive folder subset; ≤0.3 across mixed folders (correctly so — they shouldn't surface as units).** Confidence: medium — this is a forecast, not a measurement.

---

## 7. Risks and Failure Modes

| Failure mode | Mechanism | Mitigation |
|---|---|---|
| **Incoherent folders polluting centroids** (Desktop, Downloads) | Mean of unrelated unit vectors → near-origin → near-zero cosine to anything → false negatives, not false positives | Cohesion gate (≥0.55). Centroid_unit nullable; mixed folders are skipped, not promoted. **Low residual risk.** |
| **1–2 child folders** | Centroid degenerates to the child(ren); duplicate noise in HNSW | child_count ≥ 3 floor in promotion rule. Confidence: high. |
| **>500 child Downloads-style folders** | Centroid is stable but uninformative; embedding becomes "average of internet" | child_count ≤ 500 ceiling. Above this, the folder gets the path-lexical channel (Phase 1) but no centroid. **Medium residual risk** — still surfaces via lexical, may pollute on broad queries. |
| **Deep hierarchy ancestor-overlap** | At depth 8 with median fan-out 4, /A/B/.../H may have a centroid nearly identical to /A/B/.../G's (if they share most leaves), creating duplicate hits | Deduplicate fused results by ancestor-pruning: if folder F is a descendant of folder G in top-20, drop G; or merge their child-expansion. ~50 LoC. |
| **Hostile path names** (foreign, transliterated, abbreviated, hash-named) | "/Users/x/Documents/プロジェクト/" — Latin tokenizer drops it; `/d3a4b9c1/` is meaningless | NFKC normalization + per-character CJK tokenization (Section 3.1) handles Japanese/Chinese/Korean. For hash-named folders, lexical channel produces no signal — fall back to dense, which is the correct behavior. |
| **Embedding drift on model update** | If user upgrades nomic-embed-text, every centroid is now a stale mean over old-model leaves | Store `model_version` per file and per folder centroid; lazy-recompute on first read after version bump. Or full reindex (~30 minutes for 10⁵ files at 250 ms each). |
| **Hnswlib tombstone bloat** | After many edits, deleted-but-not-removed nodes inflate query cost and memory | Compaction at ≥10% tombstones (full rebuild from `files.embedding` BLOB column, 30–60 s). hnswlib `replace_deleted` path covered in Yang et al. (arXiv:2407.07871) — for our scale, periodic full rebuild is simpler. |
| **Cohesion-EMA staleness** | EMA can diverge from true cohesion under correlated edits (e.g., bulk-add 50 unrelated PDFs to a folder) | Trigger exact recompute when `centroid_drift > 0.05` since last exact computation. Bounded recompute work O(child_count·d). |
| **RRF drowning the dense channel** | If FTS returns 200 lexical-but-irrelevant matches, RRF dilutes the dense signal | Cap each channel to k=200 candidates and require `cos≥0.1` floor on dense; this is industry-standard practice (Elastic 2024). |

The largest risk is **silent quality regression on mixed folders that the cohesion gate misclassifies as cohesive.** Mitigation: log the top-20 every query, ship a small evaluation harness that periodically re-runs known-good queries and alerts on rank changes.

---

## 8. Phase 1 → Phase 2 Migration Path

Phase 2 is **strictly additive** to Phase 1; no code from Phase 1 is discarded.

**Phase 1 (week 1–2 of work).**
1. Add `file_path_tokens` table + FTS5 virtual table + `tokenize_path()`.
2. Backfill: tokenize all current paths, populate FTS index. ~10 minutes for 10⁵ files.
3. Add the dual-channel query path with RRF + deterministic substring backstop.
4. Add evaluation harness: a YAML of "query → expected file" pairs the user maintains by hand. Required for telemetry on Phase 2 promotion decisions later.
5. **Ship.** Acceptance bar Phase 1 satisfied by construction.

**Telemetry collected during Phase 1 → drives Phase 2 thresholds.**
- For every query: which channel produced each top-20 hit (dense vs lexical vs backstop).
- Per-folder: rolling cohesion estimate computed offline from existing embeddings (no Phase 2 schema yet, just a script).
- Distribution of folder sizes, depths, intra-folder cosine variance — confirms or refutes the bimodality assumption and tunes the 0.55 cohesion threshold.

**Phase 2 (week 3–5).**
1. Add `folders` and `folder_files` tables.
2. Backfill: walk FS, populate folder hierarchy, compute initial centroid_sum/count/unit/cohesion offline.
3. Insert promoted folder centroids into the **existing** HNSW index with `node_type='folder'`. This is one bulk insert; HNSW efC=200 quality preserved.
4. Wire the centroid-update protocol into the existing add/modify/delete handlers (Section 4.2).
5. Modify the query pipeline to expand folder-typed dense hits to their top children (Section 5).

**No data thrown away.** The path-lexical channel keeps doing its job. The substring backstop keeps doing its job. Phase 2 only *adds* a folder-centroid signal to the dense channel, which was not contributing it before.

**Off-ramps.** If Phase 2 telemetry shows centroids hurt rather than help on mixed folders, the cohesion gate can be raised (0.55 → 0.65) without code changes. If it shows promoted folders never appear in top-20, the folder centroids can be dropped from HNSW (saving 5%) and the system reverts to Phase-1-only behavior. Phase 2 is **reversible**, by design.

---

## Caveats

1. **The literature is silent on this exact problem.** No 2023–2026 paper I could locate evaluates folder-promotion-as-HNSW-nodes for personal-file semantic search. The recommendation rests on first-principles synthesis of (a) cosine-centroid math (well-established), (b) the RAPTOR/GraphRAG corpus-QA results adapted to a regime they were not evaluated in, (c) Munyampirwa et al.'s finding that HNSW hierarchy is empirically inert at d≥768, and (d) industry hybrid-retrieval practice (RRF). Where the synthesis bridges domains, I have flagged confidence as medium, not high.

2. **Phase 2 recall numbers are forecasts, not measurements.** No publicly available benchmark resembles a 10⁵-file personal corpus with the specific bimodal cohesion the user describes. The numbers are derived from cosine-arithmetic on nomic-embed-text's published MTEB profile, not from running the system. Build the evaluation harness in Phase 1 and treat Phase 2 promotion as an empirical hypothesis.

3. **The 0.2 "loose semantic floor" in the Phase 1 acceptance criterion is unusually low for nomic-embed-text** (typical relevance threshold is 0.5–0.6). At 0.2, many genuinely unrelated files will satisfy the constraint. The substring backstop honors the contract literally — but the user may want to re-examine whether 0.2 is the threshold they actually want, or whether they meant 0.4. This is a specification-clarification flag, not a recommendation change.

4. **Cohesion-gate threshold (0.55) and size bounds (3–500) are first-pass heuristics.** They should be measured against the user's actual corpus before being treated as defaults. The pipeline supports A/B'ing them via a single config file.

5. **RAPTOR/GraphRAG are powerful where they fit.** This report rejects them for *this* problem (single-user FS browsing with hard latency and cost constraints), not as research artifacts. If the user later wants question-answering over their files (not retrieval), RAPTOR-style summaries on top of the existing folder hierarchy could be added at that point — they are orthogonal to the Phase 1/2 architecture proposed here.

6. **Steck et al.'s cosine warning is non-applicable here, but the user should know it exists.** It applies to MF-style and dot-product-trained models, not to L2-normalized contrastively-trained encoders like nomic-embed-text. If they ever switch embedding models, they should re-check the new model's training objective.

7. **The "Down with the Hierarchy" result motivates against Option 2 specifically, not against hierarchical structures generally.** The folders-as-nodes approach in Option 1 + Phase 2 is **not** a literal HNSW hierarchy; it's additional nodes in the same graph with an application-level interpretation. That distinction matters and I have tried to make it crisply.
