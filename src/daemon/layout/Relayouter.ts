import type { FileIndex } from '../db/FileIndex'
import { StarPca, scalePositions, type PcaModel } from './Pca'
import { recomputeClusters, updateClusterCentroids } from './clustering'
import { detectSignFlips } from '../math/pinMath'
import { LAYOUT_THRESHOLD, type ProjectionFile } from '../../shared/types'

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

  // Project a single embedding using the current model (no re-fit)
  projectOne(embedding: Float32Array): [number, number] | null {
    if (!this.pca) return null
    return this.pca.project(embedding)
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

    // Project all and scale to [-500, 500]
    const rawPositions = embeddings.map(e => this.pca!.project(e))
    const scaled = scalePositions(rawPositions, 1000)

    this.layoutVersion++

    // Write positions + bump layout_version per file
    const updateStmt = this.db.db.prepare(`
      UPDATE files SET x = ?, y = ?, layout_version = ? WHERE id = ?
    `)
    const updateAll = this.db.db.transaction(() => {
      for (let i = 0; i < files.length; i++) {
        const [x, y] = scaled[i]
        updateStmt.run(x, y, this.layoutVersion, files[i].id)
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
}
