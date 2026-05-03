import type { FileIndex } from '../db/FileIndex'
import { StarPca, scalePositions, applyScale, type PcaModel } from './Pca'
import { jitterFor } from './jitter'
import { recomputeClusters, updateClusterCentroids } from './clustering'
import { detectSignFlips } from '../math/pinMath'
import { LAYOUT_THRESHOLD, type ProjectionFile } from '../../shared/types'

// B2 — minimum sample count for a subset PCA fit. Below ~10 the eigenvector
// decomposition becomes rank-deficient (fewer samples than embedding dims) and
// the resulting projection collapses to a tiny region. Caller (the experiment
// endpoint) converts a too-small subset into HTTP 400 instead of a stack trace.
export const SUBSET_PCA_MIN = 10

export class Relayouter {
  private db: FileIndex
  private pca: StarPca | null = null
  private layoutVersion: number = 0

  constructor(db: FileIndex) {
    this.db = db
  }

  loadExisting(): boolean {
    const meta = this.db.getLatestLayoutMeta()
    if (!meta) return false
    try {
      this.pca = StarPca.deserialize(meta.projection_model)
      this.layoutVersion = meta.version
      return true
    } catch {
      return false
    }
  }

  get currentVersion(): number {
    return this.layoutVersion
  }

  get isReady(): boolean {
    return this.pca !== null
  }

  // Project a single embedding using the current model (no re-fit). Applies
  // the train-time scale transform when available so post-train inserts land
  // in the same world-unit range as the training set instead of clustering at
  // raw PCA scale near the origin. The optional `id` adds a tiny deterministic
  // jitter so two files with identical embeddings don't render on top of each
  // other.
  projectOne(embedding: Float32Array, id?: string): [number, number] | null {
    if (!this.pca) return null
    const raw = this.pca.project(embedding)
    const s = this.pca.scale
    const scaled = s ? applyScale(raw, s) : raw
    if (!id) return scaled
    const [jx, jy] = jitterFor(id)
    return [scaled[0] + jx, scaled[1] + jy]
  }

  // True when the loaded model predates per-axis scale persistence and a
  // one-shot retrain is needed to upgrade it. Daemon startup checks this.
  get needsScaleMigration(): boolean {
    return this.pca !== null && this.pca.scale === null
  }

  get componentCount(): number {
    return this.pca?.componentCount ?? 0
  }

  getModel(): PcaModel | null {
    return this.pca?.toJSON() ?? null
  }

  // For each file with an embedding, return its projection onto all PCs.
  // Pin coefficients ride along so the renderer's PC-dial pipeline can apply
  // them client-side (F4 — see usePcDial.scaledById).
  getAllProjections(): ProjectionFile[] {
    if (!this.pca) return []
    const files = this.db.listWithEmbeddings()
    const out: ProjectionFile[] = []
    for (const f of files) {
      if (!f.embedding) continue
      out.push({
        id: f.id,
        pcs: this.pca.projectAll(f.embedding),
        isPinned: f.isPinned,
        pinAlpha: f.pinAlpha,
        pinBeta: f.pinBeta,
        pinAxisA: f.pinAxisA,
        pinAxisB: f.pinAxisB,
      })
    }
    return out
  }

  // Train PCA on all embeddings, project all files, write x/y, bump layout_version.
  // Returns true if training occurred.
  train(): boolean {
    const files = this.db.listWithEmbeddings()
    if (files.length < LAYOUT_THRESHOLD) return false

    const embeddings = files
      .map(f => f.embedding)
      .filter((e): e is Float32Array => e !== null)

    // F4 — capture old eigenvectors so we can detect per-axis sign flips.
    // PCA SVD is sign-ambiguous: the "same" semantic axis can flip on a
    // refit, and any pinned files would otherwise jump to the mirror world
    // position. detectSignFlips → applyPinSignFlips negates α/β where the
    // axis flipped (and logs where the axis became unstable).
    const oldComponents = this.pca?.toJSON().components ?? null

    this.pca = StarPca.train(embeddings)

    if (oldComponents) {
      const newComponents = this.pca.toJSON().components
      const flips = detectSignFlips(oldComponents, newComponents)
      this.db.applyPinSignFlips(flips)
    }

    // Project all and scale to [-500, 500]. Capture the linear transform on
    // the PCA model so projectOne (single-file inserts after training) can
    // apply the same transform — without it, post-train files land at raw
    // PCA scale (~±1) and visually stack at the world origin.
    const rawPositions = embeddings.map(e => this.pca!.project(e))
    const { scaled, params } = scalePositions(rawPositions, 1000)
    this.pca.setScale(params)

    this.layoutVersion++

    // Write positions + bump layout_version per file
    const updateStmt = this.db.db.prepare(`
      UPDATE files SET x = ?, y = ?, layout_version = ? WHERE id = ?
    `)
    const updateAll = this.db.db.transaction(() => {
      for (let i = 0; i < files.length; i++) {
        const [x, y] = scaled[i]
        const [jx, jy] = jitterFor(files[i].id)
        updateStmt.run(x + jx, y + jy, this.layoutVersion, files[i].id)
      }
    })
    updateAll()

    // Persist model
    this.db.saveLayoutMeta(
      this.layoutVersion,
      'pca',
      this.pca.serialize(),
      files.length
    )

    // Recompute clusters and their centroids
    recomputeClusters(this.db)
    updateClusterCentroids(this.db)

    return true
  }

  // Check if we should train (first time threshold crossed)
  maybeTrainFirst(): boolean {
    if (this.isReady) return false
    const count = this.db.countWithEmbeddings()
    if (count < LAYOUT_THRESHOLD) return false
    return this.train()
  }

  // B2 — fit a one-shot PCA on just the supplied files and return their
  // scaled (x, y) positions in [-500, 500]. The fitted model is intentionally
  // discarded: subset experiments are local-scope projections that the live
  // global model wouldn't produce (full-corpus variance dominates the global
  // axes, so a sub-tree experiment compresses into a tiny patch when projected
  // through the global PCA). Returning null lets the endpoint convert the
  // too-small case into HTTP 400 without a thrown error.
  //
  // Side-effect-free: does NOT mutate `layout_meta`, `layout_version`, the
  // global PCA model, file rows, or clusters. The caller writes the returned
  // positions to `files.x/y` itself (with a synthetic negative version) so the
  // renderer's `/api/map/positions?since=N` delta picks them up but the
  // numbered-version lineage stays untouched.
  trainSubset(fileIds: string[]): Map<string, [number, number]> | null {
    if (fileIds.length < SUBSET_PCA_MIN) return null
    const files = fileIds
      .map(id => this.db.get(id))
      .filter((f): f is NonNullable<ReturnType<FileIndex['get']>> =>
        f !== null && f.embedding !== null
      )
    if (files.length < SUBSET_PCA_MIN) return null

    const embeddings = files.map(f => f.embedding!)
    const pca = StarPca.train(embeddings)
    const rawPositions = embeddings.map(e => pca.project(e))
    const { scaled } = scalePositions(rawPositions, 1000)

    const out = new Map<string, [number, number]>()
    for (let i = 0; i < files.length; i++) {
      const [x, y] = scaled[i]
      const [jx, jy] = jitterFor(files[i].id)
      out.set(files[i].id, [x + jx, y + jy])
    }
    return out
  }
}
