import type { FileIndex, IndexedFile } from '../db/FileIndex'
import { Worker } from 'worker_threads'
import { join } from 'path'
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
  private training: Promise<boolean> | null = null

  constructor(db: FileIndex) {
    this.db = db
    db.db.exec(`
      CREATE TABLE IF NOT EXISTS layout_input_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO layout_input_revision(id) VALUES(1);
      CREATE TRIGGER IF NOT EXISTS layout_vector_insert AFTER INSERT ON files WHEN new.embedding IS NOT NULL BEGIN
        UPDATE layout_input_revision SET revision=revision+1 WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS layout_vector_update AFTER UPDATE OF embedding ON files WHEN old.embedding IS NOT new.embedding BEGIN
        UPDATE layout_input_revision SET revision=revision+1 WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS layout_vector_delete AFTER DELETE ON files WHEN old.embedding IS NOT NULL BEGIN
        UPDATE layout_input_revision SET revision=revision+1 WHERE id=1;
      END;
    `)
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

    const pca = StarPca.train(embeddings)
    const rawPositions = embeddings.map(e => pca.project(e))
    return this.applyTraining(files, pca, rawPositions)
  }

  /** Fit/project in a worker; publish only if its inputs and active model still match. */
  trainAsync(): Promise<boolean> {
    if (this.training) return this.training
    const files = this.db.listWithEmbeddings()
    if (files.length < LAYOUT_THRESHOLD) return Promise.resolve(false)
    const revision = this.inputRevision(), version = this.layoutVersion
    const worker = new Worker(join(__dirname, 'pca-worker.cjs'), { workerData: { vectors: files.map(f => f.embedding) } })
    this.training = new Promise<boolean>((resolve, reject) => {
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error('PCA training timed out')) }, 120_000)
      worker.once('message', (result: { model: PcaModel; positions: [number, number][]; error?: string }) => {
        clearTimeout(timer)
        if (result.error) { reject(new Error(result.error)); return }
        if (revision !== this.inputRevision() || version !== this.layoutVersion) { resolve(false); return }
        try { resolve(this.applyTraining(files, StarPca.deserialize(Buffer.from(JSON.stringify(result.model))), result.positions)) }
        catch (error) { reject(error) }
      })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`PCA worker exited (${code})`)) })
    }).finally(() => { this.training = null })
    return this.training
  }

  private inputRevision(): number {
    return (this.db.db.prepare('SELECT revision FROM layout_input_revision WHERE id=1').get() as { revision: number }).revision
  }

  private applyTraining(files: IndexedFile[], pca: StarPca, rawPositions: [number, number][]): boolean {
    const oldComponents = this.pca?.toJSON().components ?? null
    const { scaled, params } = scalePositions(rawPositions, 1000)
    pca.setScale(params)
    const version = this.layoutVersion + 1
    const update = this.db.db.prepare('UPDATE files SET x=?,y=?,layout_version=? WHERE id=?')
    this.db.db.transaction(() => {
      if (oldComponents) this.db.applyPinSignFlips(detectSignFlips(oldComponents, pca.toJSON().components))
      for (let i = 0; i < files.length; i++) {
        const [jx, jy] = jitterFor(files[i].id)
        update.run(scaled[i][0] + jx, scaled[i][1] + jy, version, files[i].id)
      }
      this.db.saveLayoutMeta(version, 'pca', pca.serialize(), files.length)
    })()
    this.pca = pca; this.layoutVersion = version

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
    const ids = files.map(f => f.id)
    const embeddings = files.map(f => f.embedding!)
    return projectVectors(ids, embeddings)
  }
}

// Pure helper: given parallel arrays of ids and unit-length embeddings, fit a
// one-shot PCA and return scaled (x, y) positions. Same math as the body of
// `trainSubset` — separated out so live-mix and other ephemeral projections can
// reuse it without round-tripping through the database.
export function projectVectors(
  ids: string[],
  vectors: Float32Array[]
): Map<string, [number, number]> | null {
  if (vectors.length < SUBSET_PCA_MIN) return null
  if (ids.length !== vectors.length) {
    throw new Error(`projectVectors: ids/vectors length mismatch (${ids.length} vs ${vectors.length})`)
  }
  const pca = StarPca.train(vectors)
  const rawPositions = vectors.map(e => pca.project(e))
  const { scaled } = scalePositions(rawPositions, 1000)

  const out = new Map<string, [number, number]>()
  for (let i = 0; i < ids.length; i++) {
    const [x, y] = scaled[i]
    const [jx, jy] = jitterFor(ids[i])
    out.set(ids[i], [x + jx, y + jy])
  }
  return out
}
