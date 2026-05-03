import Database from 'better-sqlite3'
import type { FileNode, FileCategory, Star, StarType, Edge, Cluster } from '../../shared/types'

export interface IndexedFile extends FileNode {
  // star-palace fields
  embedding: Float32Array | null
  contentHash: string | null
  x: number | null
  y: number | null
  z: number | null
  clusterId: number | null
  layoutVersion: number
  firstSeen: number
  viewCount: number
  isPinned: boolean
  starType: StarType | null
  // F4: pin coefficients in embedding-delta space (all NULL until pinned).
  pinAlpha: number | null
  pinBeta: number | null
  pinAxisA: number | null
  pinAxisB: number | null
  pinnedAt: number | null
}

export interface FileIndexOptions {
  dbPath: string
}

export class FileIndex {
  readonly db: Database.Database

  constructor(opts: FileIndexOptions) {
    this.db = new Database(opts.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id              TEXT PRIMARY KEY,
        path            TEXT NOT NULL,
        platform        TEXT NOT NULL,
        name            TEXT NOT NULL,
        mime_type       TEXT NOT NULL,
        category        TEXT NOT NULL,
        size            INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        modified_at     INTEGER NOT NULL,
        stale           INTEGER NOT NULL DEFAULT 0,
        embedding       BLOB,
        content_hash    TEXT,
        x               REAL,
        y               REAL,
        z               REAL,
        cluster_id      INTEGER,
        layout_version  INTEGER NOT NULL DEFAULT 0,
        first_seen      INTEGER NOT NULL DEFAULT 0,
        view_count      INTEGER NOT NULL DEFAULT 0,
        is_pinned       INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_files_category  ON files(category);
      CREATE INDEX IF NOT EXISTS idx_files_stale     ON files(stale);
      CREATE INDEX IF NOT EXISTS idx_files_cluster   ON files(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_files_layout    ON files(layout_version);

      CREATE TABLE IF NOT EXISTS edges (
        src_id      TEXT NOT NULL,
        dst_id      TEXT NOT NULL,
        weight      REAL NOT NULL,
        engine      TEXT NOT NULL DEFAULT 'embedding',
        computed_at INTEGER NOT NULL,
        PRIMARY KEY (src_id, dst_id)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
      CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);

      CREATE TABLE IF NOT EXISTS clusters (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        color_index  INTEGER NOT NULL,
        centroid_x   REAL,
        centroid_y   REAL,
        member_count INTEGER NOT NULL DEFAULT 0,
        label        TEXT
      );

      CREATE TABLE IF NOT EXISTS layout_meta (
        version          INTEGER PRIMARY KEY,
        algorithm        TEXT NOT NULL,
        projection_model BLOB NOT NULL,
        computed_at      INTEGER NOT NULL,
        node_count       INTEGER NOT NULL,
        drift_score      REAL
      );
    `)

    // Additive migrations — safe to run on every startup
    if (!this.hasColumn('files', 'star_type')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN star_type TEXT;`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_files_star_type ON files(star_type);`)

    // F4 — pin coefficients (embedding-delta). All NULL until the user pins
    // a file. is_pinned existed pre-F4 (boot-time scaffold) so we leave it.
    if (!this.hasColumn('files', 'pin_alpha')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN pin_alpha REAL;`)
    }
    if (!this.hasColumn('files', 'pin_beta')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN pin_beta REAL;`)
    }
    if (!this.hasColumn('files', 'pin_axis_a')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN pin_axis_a INTEGER;`)
    }
    if (!this.hasColumn('files', 'pin_axis_b')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN pin_axis_b INTEGER;`)
    }
    if (!this.hasColumn('files', 'pinned_at')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN pinned_at INTEGER;`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_files_is_pinned ON files(is_pinned);`)
  }

  private hasColumn(table: string, col: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return rows.some(r => r.name === col)
  }

  upsert(file: Omit<IndexedFile, 'isStale'>): void {
    this.db.prepare(`
      INSERT INTO files (
        id, path, platform, name, mime_type, category, size,
        created_at, modified_at, stale,
        embedding, content_hash, x, y, z,
        cluster_id, layout_version, first_seen, view_count, is_pinned, star_type
      ) VALUES (
        @id, @path, @platform, @name, @mime_type, @category, @size,
        @created_at, @modified_at, 0,
        @embedding, @content_hash, @x, @y, @z,
        @cluster_id, @layout_version, @first_seen, @view_count, @is_pinned, @star_type
      )
      ON CONFLICT(id) DO UPDATE SET
        path = excluded.path,
        name = excluded.name,
        mime_type = excluded.mime_type,
        category = excluded.category,
        size = excluded.size,
        modified_at = excluded.modified_at,
        stale = 0,
        embedding = COALESCE(excluded.embedding, files.embedding),
        content_hash = COALESCE(excluded.content_hash, files.content_hash),
        x = COALESCE(excluded.x, files.x),
        y = COALESCE(excluded.y, files.y),
        cluster_id = COALESCE(excluded.cluster_id, files.cluster_id),
        layout_version = excluded.layout_version
        -- star_type intentionally not updated; manual tagging persists across re-index
    `).run({
      id: file.id,
      path: file.path,
      platform: file.platform,
      name: file.name,
      mime_type: file.mimeType,
      category: file.category,
      size: file.size,
      created_at: file.createdAt,
      modified_at: file.modifiedAt,
      embedding: file.embedding ? Buffer.from(file.embedding.buffer) : null,
      content_hash: file.contentHash,
      x: file.x,
      y: file.y,
      z: file.z,
      cluster_id: file.clusterId,
      layout_version: file.layoutVersion,
      first_seen: file.firstSeen,
      view_count: file.viewCount,
      is_pinned: file.isPinned ? 1 : 0,
      star_type: file.starType,
    })
  }

  updatePosition(id: string, x: number, y: number, layoutVersion: number): void {
    this.db.prepare(`
      UPDATE files SET x = ?, y = ?, layout_version = ? WHERE id = ?
    `).run(x, y, layoutVersion, id)
  }

  updateCluster(id: string, clusterId: number | null): void {
    this.db.prepare(`UPDATE files SET cluster_id = ? WHERE id = ?`).run(clusterId, id)
  }

  updateEmbedding(id: string, embedding: Float32Array, contentHash: string): void {
    this.db.prepare(`
      UPDATE files SET embedding = ?, content_hash = ? WHERE id = ?
    `).run(Buffer.from(embedding.buffer), contentHash, id)
  }

  incrementViewCount(id: string): void {
    this.db.prepare(`UPDATE files SET view_count = view_count + 1 WHERE id = ?`).run(id)
  }

  setStarType(id: string, starType: StarType | null): void {
    this.db.prepare(`UPDATE files SET star_type = ? WHERE id = ?`).run(starType, id)
  }

  // F4 — pin/unpin. Atomic; overwrites any prior pin coefficients.
  setPin(id: string, alpha: number, beta: number, axisA: number, axisB: number, at: number): void {
    this.db.prepare(`
      UPDATE files SET
        is_pinned   = 1,
        pin_alpha   = ?,
        pin_beta    = ?,
        pin_axis_a  = ?,
        pin_axis_b  = ?,
        pinned_at   = ?
      WHERE id = ?
    `).run(alpha, beta, axisA, axisB, at, id)
  }

  clearPin(id: string): void {
    this.db.prepare(`
      UPDATE files SET
        is_pinned   = 0,
        pin_alpha   = NULL,
        pin_beta    = NULL,
        pin_axis_a  = NULL,
        pin_axis_b  = NULL,
        pinned_at   = NULL
      WHERE id = ?
    `).run(id)
  }

  // F4 — list every currently-pinned file (used by Relayouter for sign-flip).
  listPinned(): IndexedFile[] {
    const rows = this.db.prepare(`SELECT * FROM files WHERE is_pinned = 1`).all() as DbRow[]
    return rows.map(rowToFile)
  }

  // F4 — atomic per-file α/β rewrite, used after a PCA retrain when an axis
  // sign-flipped. `flips[k] === -1` flips the sign on any pinned file whose
  // pin_axis_a or pin_axis_b equals k. `flips[k] === 0` is "axis unstable"
  // (close eigenvalues swapped order); leave the offset as-is and log.
  applyPinSignFlips(flips: number[]): void {
    if (flips.length === 0) return
    const pinned = this.listPinned()
    if (pinned.length === 0) return
    const updateStmt = this.db.prepare(`
      UPDATE files SET pin_alpha = ?, pin_beta = ? WHERE id = ?
    `)
    const tx = this.db.transaction(() => {
      for (const f of pinned) {
        if (f.pinAxisA === null || f.pinAxisB === null || f.pinAlpha === null || f.pinBeta === null) continue
        const flipA = flips[f.pinAxisA] ?? 1
        const flipB = flips[f.pinAxisB] ?? 1
        if (flipA === 0 || flipB === 0) {
          console.warn(`[F4] pin axis unstable for file ${f.id} (axisA=${f.pinAxisA} flip=${flipA}, axisB=${f.pinAxisB} flip=${flipB}); leaving offsets`)
          continue
        }
        if (flipA === 1 && flipB === 1) continue  // no change
        updateStmt.run(f.pinAlpha * flipA, f.pinBeta * flipB, f.id)
      }
    })
    tx()
  }

  get(id: string): IndexedFile | null {
    const row = this.db.prepare(`SELECT * FROM files WHERE id = ?`).get(id) as DbRow | undefined
    return row ? rowToFile(row) : null
  }

  getByPath(path: string): IndexedFile | null {
    const row = this.db.prepare(`SELECT * FROM files WHERE path = ?`).get(path) as DbRow | undefined
    return row ? rowToFile(row) : null
  }

  listByCategory(category: FileCategory): IndexedFile[] {
    const rows = this.db.prepare(`SELECT * FROM files WHERE category = ?`).all(category) as DbRow[]
    return rows.map(rowToFile)
  }

  listWithEmbeddings(): IndexedFile[] {
    const rows = this.db.prepare(`SELECT * FROM files WHERE embedding IS NOT NULL`).all() as DbRow[]
    return rows.map(rowToFile)
  }

  listInViewport(x1: number, y1: number, x2: number, y2: number): Star[] {
    const rows = this.db.prepare(`
      SELECT * FROM files
      WHERE x IS NOT NULL AND y IS NOT NULL
        AND x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
    `).all(x1, x2, y1, y2) as DbRow[]
    return rows.map(rowToStar)
  }

  count(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM files`).get() as { c: number }).c
  }

  countWithEmbeddings(): number {
    return (this.db.prepare(`SELECT COUNT(*) AS c FROM files WHERE embedding IS NOT NULL`).get() as { c: number }).c
  }

  markStale(id: string): void {
    this.db.prepare(`UPDATE files SET stale = 1 WHERE id = ?`).run(id)
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM files WHERE id = ?`).run(id)
    this.db.prepare(`DELETE FROM edges WHERE src_id = ? OR dst_id = ?`).run(id, id)
  }

  // Edges
  upsertEdge(edge: Edge): void {
    this.db.prepare(`
      INSERT INTO edges (src_id, dst_id, weight, engine, computed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(src_id, dst_id) DO UPDATE SET weight = excluded.weight, computed_at = excluded.computed_at
    `).run(edge.srcId, edge.dstId, edge.weight, edge.engine, edge.computedAt)
  }

  getEdgesFrom(srcId: string): Edge[] {
    const rows = this.db.prepare(`
      SELECT * FROM edges WHERE src_id = ? ORDER BY weight DESC
    `).all(srcId) as EdgeRow[]
    return rows.map(rowToEdge)
  }

  getEdgesTo(dstId: string): Edge[] {
    const rows = this.db.prepare(`
      SELECT * FROM edges WHERE dst_id = ? ORDER BY weight DESC
    `).all(dstId) as EdgeRow[]
    return rows.map(rowToEdge)
  }

  deleteEdgesFrom(srcId: string): void {
    this.db.prepare(`DELETE FROM edges WHERE src_id = ?`).run(srcId)
  }

  pruneEdgesFrom(srcId: string, keepCount: number): void {
    this.db.prepare(`
      DELETE FROM edges WHERE src_id = ? AND dst_id NOT IN (
        SELECT dst_id FROM edges WHERE src_id = ? ORDER BY weight DESC LIMIT ?
      )
    `).run(srcId, srcId, keepCount)
  }

  // Clusters
  upsertCluster(cluster: Omit<Cluster, 'id'> & { id?: number }): number {
    if (cluster.id !== undefined) {
      this.db.prepare(`
        INSERT INTO clusters (id, color_index, centroid_x, centroid_y, member_count, label)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          centroid_x = excluded.centroid_x,
          centroid_y = excluded.centroid_y,
          member_count = excluded.member_count
      `).run(cluster.id, cluster.colorIndex, cluster.centroidX, cluster.centroidY, cluster.memberCount, cluster.label)
      return cluster.id
    }
    const result = this.db.prepare(`
      INSERT INTO clusters (color_index, centroid_x, centroid_y, member_count, label)
      VALUES (?, ?, ?, ?, ?)
    `).run(cluster.colorIndex, cluster.centroidX, cluster.centroidY, cluster.memberCount, cluster.label)
    return result.lastInsertRowid as number
  }

  getClusters(): Cluster[] {
    const rows = this.db.prepare(`SELECT * FROM clusters ORDER BY id`).all() as ClusterRow[]
    return rows.map(rowToCluster)
  }

  getCluster(id: number): Cluster | null {
    const row = this.db.prepare(`SELECT * FROM clusters WHERE id = ?`).get(id) as ClusterRow | undefined
    return row ? rowToCluster(row) : null
  }

  clearClusters(): void {
    this.db.prepare(`DELETE FROM clusters`).run()
    this.db.prepare(`UPDATE files SET cluster_id = NULL`).run()
  }

  // Layout meta
  saveLayoutMeta(version: number, algorithm: string, model: Buffer, nodeCount: number): void {
    this.db.prepare(`
      INSERT INTO layout_meta (version, algorithm, projection_model, computed_at, node_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(version) DO UPDATE SET
        algorithm = excluded.algorithm,
        projection_model = excluded.projection_model,
        computed_at = excluded.computed_at,
        node_count = excluded.node_count
    `).run(version, algorithm, model, Date.now(), nodeCount)
  }

  getLatestLayoutMeta(): LayoutMetaRow | null {
    return this.db.prepare(`
      SELECT * FROM layout_meta ORDER BY version DESC LIMIT 1
    `).get() as LayoutMetaRow | null
  }

  close(): void {
    this.db.close()
  }
}

// --- DB row types ---

interface DbRow {
  id: string
  path: string
  platform: string
  name: string
  mime_type: string
  category: string
  size: number
  created_at: number
  modified_at: number
  stale: number
  embedding: Buffer | null
  content_hash: string | null
  x: number | null
  y: number | null
  z: number | null
  cluster_id: number | null
  layout_version: number
  first_seen: number
  view_count: number
  is_pinned: number
  star_type: string | null
  pin_alpha: number | null
  pin_beta: number | null
  pin_axis_a: number | null
  pin_axis_b: number | null
  pinned_at: number | null
}

interface EdgeRow {
  src_id: string
  dst_id: string
  weight: number
  engine: string
  computed_at: number
}

interface ClusterRow {
  id: number
  color_index: number
  centroid_x: number | null
  centroid_y: number | null
  member_count: number
  label: string | null
}

export interface LayoutMetaRow {
  version: number
  algorithm: string
  projection_model: Buffer
  computed_at: number
  node_count: number
  drift_score: number | null
}

// --- Row mappers ---

function rowToFile(row: DbRow): IndexedFile {
  return {
    id: row.id,
    path: row.path,
    platform: row.platform as FileNode['platform'],
    name: row.name,
    mimeType: row.mime_type,
    category: row.category as FileCategory,
    size: row.size,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    isStale: row.stale === 1,
    embedding: row.embedding
      ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
      : null,
    contentHash: row.content_hash,
    x: row.x,
    y: row.y,
    z: row.z,
    clusterId: row.cluster_id,
    layoutVersion: row.layout_version,
    firstSeen: row.first_seen,
    viewCount: row.view_count,
    isPinned: row.is_pinned === 1,
    starType: row.star_type as StarType | null,
    pinAlpha: row.pin_alpha,
    pinBeta: row.pin_beta,
    pinAxisA: row.pin_axis_a,
    pinAxisB: row.pin_axis_b,
    pinnedAt: row.pinned_at,
  }
}

function rowToStar(row: DbRow): Star {
  return {
    id: row.id,
    path: row.path,
    platform: row.platform as FileNode['platform'],
    name: row.name,
    mimeType: row.mime_type,
    category: row.category as FileCategory,
    size: row.size,
    createdAt: row.created_at,
    modifiedAt: row.modified_at,
    isStale: row.stale === 1,
    x: row.x!,
    y: row.y!,
    clusterId: row.cluster_id,
    layoutVersion: row.layout_version,
    firstSeen: row.first_seen,
    viewCount: row.view_count,
    isPinned: row.is_pinned === 1,
    starType: row.star_type as StarType | null,
    pinAlpha: row.pin_alpha,
    pinBeta: row.pin_beta,
    pinAxisA: row.pin_axis_a,
    pinAxisB: row.pin_axis_b,
    pinnedAt: row.pinned_at,
  }
}

function rowToEdge(row: EdgeRow): Edge {
  return {
    srcId: row.src_id,
    dstId: row.dst_id,
    weight: row.weight,
    engine: row.engine as Edge['engine'],
    computedAt: row.computed_at,
  }
}

function rowToCluster(row: ClusterRow): Cluster {
  return {
    id: row.id,
    colorIndex: row.color_index,
    centroidX: row.centroid_x,
    centroidY: row.centroid_y,
    memberCount: row.member_count,
    label: row.label,
  }
}
