import Database from 'better-sqlite3'
import type {
  FileNode, FileCategory, FavoriteAppearance, Star, StarType, Edge, Cluster, Galaxy, GalaxySummary,
  Collection, CollectionKind, CollectionSummary,
} from '../../shared/types'
import { DEFAULT_GALAXY_NAME, COLLECTION_DEFAULT_SIMILARITY_FLOOR, CONSTELLATION_PALETTE } from '../../shared/types'
import { galaxySpiralOffset } from './galaxySpiral'

export interface IndexedFile extends FileNode {
  // star-palace fields
  embedding: Float32Array | null
  contentHash: string | null
  x: number | null
  y: number | null
  z: number | null
  clusterId: number | null
  galaxyId: number | null
  layoutVersion: number
  firstSeen: number
  viewCount: number
  isPinned: boolean
  isFavorite?: boolean
  favoriteAppearance?: FavoriteAppearance
  starType: StarType | null
  // F4: pin coefficients in embedding-delta space (all NULL until pinned).
  pinAlpha: number | null
  pinBeta: number | null
  pinAxisA: number | null
  pinAxisB: number | null
  pinnedAt: number | null
  // F10 — OS-derived usage signals + denormalised composite. NULL until first
  // walker pass writes them; importance_score is recomputed on every re-index.
  osUseCount: number | null
  osLastUsed: number | null
  importanceScore: number | null
  // B1 — manual tags + the strategy used to build the prompt that produced
  // `embedding`. Both nullable: legacy rows have NULL embeddingStrategy
  // (treated as 'content-only'); tags is null until the user assigns any.
  // Schema layer keeps `embeddingStrategy` typed as plain string so we don't
  // import the StrategyId union here — db code stays unaware of the registry.
  tags: string[] | null
  embeddingStrategy: string | null
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
    // Explicit favorites are authored metadata. They do not reuse positional
    // pins or legacy manual star types, and indexing cannot overwrite them.
    if (!this.hasColumn('files', 'is_favorite')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN (0,1));`)
    }
    if (!this.hasColumn('files', 'favorite_appearance')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN favorite_appearance TEXT NOT NULL DEFAULT 'pulsar' CHECK(favorite_appearance IN ('pulsar','black-hole'));`)
    }

    // F9 — galaxies. One row per indexed root path; each gets a deterministic
    // origin offset on the spiral so they live as separate spatial clusters.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS galaxies (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        root_path   TEXT NOT NULL UNIQUE,
        origin_x    REAL NOT NULL,
        origin_y    REAL NOT NULL,
        created_at  INTEGER NOT NULL
      );
    `)
    if (!this.hasColumn('files', 'galaxy_id')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN galaxy_id INTEGER REFERENCES galaxies(id);`)
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_files_galaxy ON files(galaxy_id);`)

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

    // F10 — usage-driven classification fields. NULL on existing rows; first
    // walker pass after upgrade backfills os_use_count/os_last_used (Spotlight
    // / atime) and Insert pipeline writes importance_score.
    if (!this.hasColumn('files', 'os_use_count')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN os_use_count INTEGER;`)
    }
    if (!this.hasColumn('files', 'os_last_used')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN os_last_used INTEGER;`)
    }
    if (!this.hasColumn('files', 'importance_score')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN importance_score REAL;`)
    }

    // F5 — virtual collections. `collections` holds the named group; `members`
    // is a join table from collection → file id. UNIQUE(name) lets the
    // endpoint return 409 on rename conflicts. CHECK constraint enforces the
    // 'static' / 'dynamic' kind union at insert time (matches CollectionKind).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        name             TEXT NOT NULL UNIQUE,
        kind             TEXT NOT NULL CHECK (kind IN ('static','dynamic')),
        query            TEXT,
        similarity_floor REAL,
        color_index      INTEGER NOT NULL,
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        evaluated_at     INTEGER
      );
      CREATE TABLE IF NOT EXISTS collection_members (
        collection_id INTEGER NOT NULL,
        file_id       TEXT NOT NULL,
        added_at      INTEGER NOT NULL,
        PRIMARY KEY (collection_id, file_id)
      );
      CREATE INDEX IF NOT EXISTS idx_cm_file ON collection_members(file_id);
    `)

    // B1 — per-file tags + embedding-strategy provenance. Tags are stored as
    // a JSON-encoded string[] (or NULL when the user hasn't tagged the file).
    // embedding_strategy records which prompt-construction strategy produced
    // the current `embedding`; NULL on legacy rows means "treat as content-
    // only" (the historical behaviour). Both columns survive re-index via
    // COALESCE in the upsert ON CONFLICT clause below.
    if (!this.hasColumn('files', 'tags')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN tags TEXT;`)
    }
    if (!this.hasColumn('files', 'embedding_strategy')) {
      this.db.exec(`ALTER TABLE files ADD COLUMN embedding_strategy TEXT;`)
    }

    // B1 — global k/v settings. Today only `default_strategy` lives here;
    // future single-row config (active model, similarity floors, etc.) can
    // ride along without another migration. Seeded with 'content-only' so
    // brand-new daemons keep legacy embedding behaviour until B3's UI flips
    // it. INSERT OR IGNORE makes the seed idempotent across restarts.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `)
    this.db.prepare(
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`
    ).run('default_strategy', 'content-only')

    // B1 — embedding-experiment snapshots. Created here so B2's experiment
    // endpoints have a place to land; B1 itself never writes to these.
    // `snapshot_id` is the experiment label (UUID or human-friendly slug),
    // `scope_path` lets a snapshot cover only a sub-tree, `note` is free-form
    // user annotation. Per-file rows live in `embedding_snapshot_files` keyed
    // by (snapshot_id, file_id) so B2 can rebuild a full alternative galaxy
    // without touching the live `files` table.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_snapshots (
        snapshot_id TEXT PRIMARY KEY,
        created_at  INTEGER NOT NULL,
        strategy    TEXT NOT NULL,
        scope_path  TEXT,
        note        TEXT
      );
      CREATE TABLE IF NOT EXISTS embedding_snapshot_files (
        snapshot_id     TEXT NOT NULL,
        file_id         TEXT NOT NULL,
        embedding       BLOB NOT NULL,
        content_hash    TEXT,
        x               REAL,
        y               REAL,
        layout_version  INTEGER,
        PRIMARY KEY (snapshot_id, file_id)
      );
      CREATE INDEX IF NOT EXISTS idx_esf_snapshot ON embedding_snapshot_files(snapshot_id);
    `)
    // B2 — capture the prior embedding_strategy alongside each snapshot row so
    // a revert restores the (embedding, strategy) tuple atomically. Without
    // this, a revert would leave embedding_strategy pointing at the experiment
    // strategy even though the embedding bytes are the pre-experiment ones.
    if (!this.hasColumn('embedding_snapshot_files', 'prior_strategy')) {
      this.db.exec(`ALTER TABLE embedding_snapshot_files ADD COLUMN prior_strategy TEXT;`)
    }

    // Backfill: ensure a "default" galaxy at the spiral origin, then assign any
    // legacy file rows (galaxy_id IS NULL) to it. Idempotent.
    this.ensureDefaultGalaxy()
  }

  private ensureDefaultGalaxy(): void {
    const existing = this.db.prepare(
      `SELECT id FROM galaxies WHERE name = ? AND origin_x = 0 AND origin_y = 0`
    ).get(DEFAULT_GALAXY_NAME) as { id: number } | undefined

    let defaultId: number
    if (existing) {
      defaultId = existing.id
    } else {
      // Use a sentinel root path so the UNIQUE constraint can't fight us when
      // the user later tries to index "/" or some other real root.
      const result = this.db.prepare(
        `INSERT INTO galaxies (name, root_path, origin_x, origin_y, created_at)
         VALUES (?, ?, 0, 0, ?)`
      ).run(DEFAULT_GALAXY_NAME, `__default__:${DEFAULT_GALAXY_NAME}`, Date.now())
      defaultId = result.lastInsertRowid as number
    }

    // Backfill any legacy files (created before this column existed)
    this.db.prepare(`UPDATE files SET galaxy_id = ? WHERE galaxy_id IS NULL`).run(defaultId)
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
        cluster_id, galaxy_id, layout_version, first_seen, view_count, is_pinned, star_type, is_favorite, favorite_appearance,
        os_use_count, os_last_used, importance_score,
        tags, embedding_strategy
      ) VALUES (
        @id, @path, @platform, @name, @mime_type, @category, @size,
        @created_at, @modified_at, 0,
        @embedding, @content_hash, @x, @y, @z,
        @cluster_id, @galaxy_id, @layout_version, @first_seen, @view_count, @is_pinned, @star_type, @is_favorite, @favorite_appearance,
        @os_use_count, @os_last_used, @importance_score,
        @tags, @embedding_strategy
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
        galaxy_id = COALESCE(excluded.galaxy_id, files.galaxy_id),
        layout_version = excluded.layout_version,
        -- F10: usage signals + composite score are recomputed on every walker
        -- pass, so we always overwrite them with the freshest values. NULLs in
        -- excluded mean "still no signal" — overwriting with NULL is correct.
        os_use_count = excluded.os_use_count,
        os_last_used = excluded.os_last_used,
        importance_score = excluded.importance_score,
        -- B1: tags + embedding_strategy survive re-index the same way
        -- star_type/pin coefficients do — caller passes NULL when it has no
        -- new value, COALESCE keeps whatever the row already had. Forgetting
        -- this would wipe user tags on every walker pass.
        embedding_strategy = COALESCE(excluded.embedding_strategy, files.embedding_strategy),
        tags               = COALESCE(excluded.tags, files.tags)
        -- star_type, is_favorite, and favorite_appearance intentionally not updated; authored metadata persists across re-index
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
      galaxy_id: file.galaxyId,
      layout_version: file.layoutVersion,
      first_seen: file.firstSeen,
      view_count: file.viewCount,
      is_pinned: file.isPinned ? 1 : 0,
      star_type: file.starType,
      is_favorite: file.isFavorite ? 1 : 0,
      favorite_appearance: file.favoriteAppearance ?? 'pulsar',
      os_use_count: file.osUseCount,
      os_last_used: file.osLastUsed,
      importance_score: file.importanceScore,
      tags: file.tags === null ? null : JSON.stringify(file.tags),
      embedding_strategy: file.embeddingStrategy,
    })
  }

  setFavorite(id: string, isFavorite: boolean, appearance?: FavoriteAppearance): boolean {
    if (typeof isFavorite !== 'boolean' || (appearance !== undefined && appearance !== 'pulsar' && appearance !== 'black-hole')) throw new Error('Invalid favorite state')
    const result = this.db.prepare(`UPDATE files SET is_favorite=?, favorite_appearance=COALESCE(?,favorite_appearance)
      WHERE id=? AND (is_favorite != ? OR favorite_appearance != COALESCE(?,favorite_appearance))`)
      .run(isFavorite ? 1 : 0, appearance ?? null, id, isFavorite ? 1 : 0, appearance ?? null)
    return result.changes > 0
  }

  updatePosition(id: string, x: number, y: number, layoutVersion: number): void {
    this.db.prepare(`
      UPDATE files SET x = ?, y = ?, layout_version = ? WHERE id = ?
    `).run(x, y, layoutVersion, id)
  }

  // Positions for files with layout_version > since. Returns just the
  // (id, x, y, layoutVersion) tuple — the renderer patches existing star
  // rows in place, preserving Star object identity for files that didn't
  // move so memoised consumers don't rebuild downstream maps.
  listPositionsSince(since: number): { id: string; x: number; y: number; layoutVersion: number }[] {
    const rows = this.db.prepare(`
      SELECT id, x, y, layout_version
      FROM files
      WHERE x IS NOT NULL AND y IS NOT NULL AND layout_version > ?
    `).all(since) as { id: string; x: number; y: number; layout_version: number }[]
    return rows.map(r => ({ id: r.id, x: r.x, y: r.y, layoutVersion: r.layout_version }))
  }

  updateCluster(id: string, clusterId: number | null): void {
    this.db.prepare(`UPDATE files SET cluster_id = ? WHERE id = ?`).run(clusterId, id)
  }

  // B1 — strategy parameter records which prompt-construction strategy
  // produced this embedding. Pass null only for legacy/test paths that don't
  // know (it's then preserved in `embedding_strategy` by COALESCE in the
  // upsert; here a direct UPDATE writes whatever the caller passes).
  updateEmbedding(
    id: string,
    embedding: Float32Array,
    contentHash: string,
    strategy: string | null = null
  ): void {
    this.db.prepare(`
      UPDATE files SET embedding = ?, content_hash = ?, embedding_strategy = ? WHERE id = ?
    `).run(Buffer.from(embedding.buffer), contentHash, strategy, id)
  }

  incrementViewCount(id: string): void {
    this.db.prepare(`UPDATE files SET view_count = view_count + 1 WHERE id = ?`).run(id)
  }

  setStarType(id: string, starType: StarType | null): void {
    this.db.prepare(`UPDATE files SET star_type = ? WHERE id = ?`).run(starType, id)
  }

  // B1 — manual tags. Stored as JSON-encoded string[] in TEXT; null clears.
  setTags(id: string, tags: string[] | null): void {
    const encoded = tags === null ? null : JSON.stringify(tags)
    this.db.prepare(`UPDATE files SET tags = ? WHERE id = ?`).run(encoded, id)
  }

  getTags(id: string): string[] | null {
    const row = this.db.prepare(`SELECT tags FROM files WHERE id = ?`).get(id) as
      | { tags: string | null }
      | undefined
    if (!row) return null
    return parseTags(row.tags)
  }

  // B1 — global default strategy lookup. Returns the seeded value
  // ('content-only') on a fresh DB; the column is non-nullable in practice
  // because migrate() seeds it via INSERT OR IGNORE. Falls back to
  // 'content-only' if a hand-edit ever wipes the row, so callers never need
  // to handle null.
  getDefaultStrategy(): string {
    const row = this.db.prepare(
      `SELECT value FROM app_settings WHERE key = 'default_strategy'`
    ).get() as { value: string | null } | undefined
    return row?.value ?? 'content-only'
  }

  setDefaultStrategy(id: string): void {
    // INSERT OR REPLACE in case the row was deleted out-of-band; cheaper than
    // a SELECT-then-INSERT/UPDATE branch.
    this.db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('default_strategy', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(id)
  }

  // User-managed ignore list. Stored as the raw newline-delimited gitignore
  // source (same syntax users already know). Empty string == no extra rules.
  getIgnorePatterns(): string {
    const row = this.db.prepare(
      `SELECT value FROM app_settings WHERE key = 'ignore_patterns'`
    ).get() as { value: string | null } | undefined
    return row?.value ?? ''
  }

  setIgnorePatterns(source: string): void {
    this.db.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('ignore_patterns', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(source)
  }

  // Sweep helper: every indexed file paired with its galaxy's root_path so
  // a gitignore matcher can be applied with the same relative-to-root
  // semantics the walker uses. Files with no galaxy_id (legacy backfill,
  // pre-F9) come back with rootPath = null and the caller can decide whether
  // to match against an empty root or skip them.
  listFilesForSweep(): { id: string; path: string; rootPath: string | null }[] {
    const rows = this.db.prepare(`
      SELECT f.id AS id, f.path AS path, g.root_path AS root_path
      FROM files f
      LEFT JOIN galaxies g ON g.id = f.galaxy_id
    `).all() as { id: string; path: string; root_path: string | null }[]
    return rows.map(r => ({ id: r.id, path: r.path, rootPath: r.root_path }))
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

  // B2 — files whose `path` starts with `prefix`. We match
  // `LIKE prefix || '%'` so both `/foo/bar` (the dir itself) and
  // `/foo/bar/baz.txt` qualify when prefix is `/foo/bar`. `embeddedOnly` is
  // the experiment-endpoint default — re-embedding a never-embedded row would
  // be a noop because the snapshot needs an old vector to capture.
  // Wildcards in the user-supplied prefix are escaped so a path containing
  // `%` or `_` doesn't match unintended siblings.
  listFilesUnderPath(prefix: string, opts: { embeddedOnly?: boolean } = {}): IndexedFile[] {
    const escaped = prefix.replace(/[\\%_]/g, ch => `\\${ch}`)
    const stmt = opts.embeddedOnly
      ? this.db.prepare(`SELECT * FROM files WHERE path LIKE ? ESCAPE '\\' AND embedding IS NOT NULL`)
      : this.db.prepare(`SELECT * FROM files WHERE path LIKE ? ESCAPE '\\'`)
    const rows = stmt.all(`${escaped}%`) as DbRow[]
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

  // F9 — Galaxies
  getOrCreateGalaxy(rootPath: string, name: string): Galaxy {
    const existing = this.db.prepare(`SELECT * FROM galaxies WHERE root_path = ?`).get(rootPath) as GalaxyRow | undefined
    if (existing) return rowToGalaxy(existing)

    // Spiral slot = count of existing user galaxies + 1. The default galaxy
    // (sentinel root path) is excluded so the first user galaxy lands at
    // slot 1 (origin), keeping single-corpus demos centered. Default and
    // first user overlap at origin; default only ever holds legacy backfill
    // rows — empty in the fresh-DB common case.
    const userTotal = (this.db.prepare(
      `SELECT COUNT(*) AS c FROM galaxies WHERE root_path NOT LIKE '__default__:%'`
    ).get() as { c: number }).c
    const slot = userTotal + 1
    const [originX, originY] = galaxySpiralOffset(slot)
    const result = this.db.prepare(
      `INSERT INTO galaxies (name, root_path, origin_x, origin_y, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(name, rootPath, originX, originY, Date.now())
    const id = result.lastInsertRowid as number
    return { id, name, rootPath, originX, originY, createdAt: Date.now() }
  }

  getGalaxy(id: number): Galaxy | null {
    const row = this.db.prepare(`SELECT * FROM galaxies WHERE id = ?`).get(id) as GalaxyRow | undefined
    return row ? rowToGalaxy(row) : null
  }

  listGalaxies(): GalaxySummary[] {
    const rows = this.db.prepare(`
      SELECT g.*, COALESCE(COUNT(f.id), 0) AS member_count
      FROM galaxies g
      LEFT JOIN files f ON f.galaxy_id = g.id
      GROUP BY g.id
      ORDER BY g.id
    `).all() as (GalaxyRow & { member_count: number })[]
    return rows.map(r => ({ ...rowToGalaxy(r), memberCount: r.member_count }))
  }

  // F5 — Collections (virtual groupings of files).
  //
  // createCollection rolls the row + initial members into a single transaction
  // so partial inserts don't leave a named collection with no members. The
  // unique-name constraint at the SQLite level surfaces as a thrown
  // SqliteError; the API layer catches it and returns 409.
  createCollection(opts: {
    name: string
    kind: CollectionKind
    query?: string | null
    similarityFloor?: number | null
    fileIds?: string[]
    colorIndex?: number
  }): Collection {
    const now = Date.now()
    const colorIndex = opts.colorIndex ?? this.nextCollectionColorIndex()
    const query = opts.kind === 'dynamic' ? (opts.query ?? null) : null
    const floor = opts.kind === 'dynamic'
      ? (opts.similarityFloor ?? COLLECTION_DEFAULT_SIMILARITY_FLOOR)
      : null

    const tx = this.db.transaction(() => {
      const result = this.db.prepare(
        `INSERT INTO collections (name, kind, query, similarity_floor, color_index, created_at, updated_at, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`
      ).run(opts.name, opts.kind, query, floor, colorIndex, now, now)
      const id = result.lastInsertRowid as number

      const ids = opts.fileIds ?? []
      if (ids.length > 0) {
        const insertMember = this.db.prepare(
          `INSERT OR IGNORE INTO collection_members (collection_id, file_id, added_at) VALUES (?, ?, ?)`
        )
        for (const fid of ids) insertMember.run(id, fid, now)
      }
      return id
    })
    const id = tx()
    return this.getCollection(id)!
  }

  // Cycle through the constellation palette modulo its length so distinct
  // collections look visually different on the map. Caller may also pass an
  // explicit colorIndex into createCollection to override.
  private nextCollectionColorIndex(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM collections`).get() as { c: number }
    return row.c % CONSTELLATION_PALETTE.length
  }

  listCollections(): CollectionSummary[] {
    const rows = this.db.prepare(`
      SELECT c.*, COALESCE(COUNT(m.file_id), 0) AS member_count
      FROM collections c
      LEFT JOIN collection_members m ON m.collection_id = c.id
      GROUP BY c.id
      ORDER BY c.id
    `).all() as (CollectionRow & { member_count: number })[]
    return rows.map(r => ({ ...rowToCollection(r), memberCount: r.member_count }))
  }

  getCollection(id: number): Collection | null {
    const row = this.db.prepare(`SELECT * FROM collections WHERE id = ?`).get(id) as CollectionRow | undefined
    return row ? rowToCollection(row) : null
  }

  getCollectionMembers(id: number): string[] {
    const rows = this.db.prepare(
      `SELECT file_id FROM collection_members WHERE collection_id = ? ORDER BY added_at ASC`
    ).all(id) as { file_id: string }[]
    return rows.map(r => r.file_id)
  }

  // INSERT OR IGNORE makes this idempotent across duplicate calls — the
  // PRIMARY KEY (collection_id, file_id) prevents dupes and the IGNORE
  // suppresses the conflict error.
  addCollectionMembers(id: number, fileIds: string[]): void {
    if (fileIds.length === 0) return
    const now = Date.now()
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO collection_members (collection_id, file_id, added_at) VALUES (?, ?, ?)`
    )
    const tx = this.db.transaction(() => {
      for (const fid of fileIds) stmt.run(id, fid, now)
      this.db.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).run(now, id)
    })
    tx()
  }

  removeCollectionMember(id: number, fileId: string): void {
    const now = Date.now()
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `DELETE FROM collection_members WHERE collection_id = ? AND file_id = ?`
      ).run(id, fileId)
      this.db.prepare(`UPDATE collections SET updated_at = ? WHERE id = ?`).run(now, id)
    })
    tx()
  }

  // Atomic replace: delete-all + insert-all in one transaction so a refresh
  // never exposes a half-applied membership set to readers. Used by the
  // dynamic-refresh endpoint after re-running the query.
  setCollectionMembership(id: number, fileIds: string[]): { added: string[]; removed: string[] } {
    const now = Date.now()
    const before = new Set(this.getCollectionMembers(id))
    const after = new Set(fileIds)
    const added: string[] = []
    const removed: string[] = []
    for (const fid of after) if (!before.has(fid)) added.push(fid)
    for (const fid of before) if (!after.has(fid)) removed.push(fid)

    const insertStmt = this.db.prepare(
      `INSERT OR IGNORE INTO collection_members (collection_id, file_id, added_at) VALUES (?, ?, ?)`
    )
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM collection_members WHERE collection_id = ?`).run(id)
      for (const fid of fileIds) insertStmt.run(id, fid, now)
      this.db.prepare(
        `UPDATE collections SET updated_at = ?, evaluated_at = ? WHERE id = ?`
      ).run(now, now, id)
    })
    tx()
    return { added, removed }
  }

  deleteCollection(id: number): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM collection_members WHERE collection_id = ?`).run(id)
      this.db.prepare(`DELETE FROM collections WHERE id = ?`).run(id)
    })
    tx()
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
  galaxy_id: number | null
  layout_version: number
  first_seen: number
  view_count: number
  is_pinned: number
  is_favorite: number
  favorite_appearance: FavoriteAppearance
  star_type: string | null
  pin_alpha: number | null
  pin_beta: number | null
  pin_axis_a: number | null
  pin_axis_b: number | null
  pinned_at: number | null
  os_use_count: number | null
  os_last_used: number | null
  importance_score: number | null
  tags: string | null
  embedding_strategy: string | null
}

interface GalaxyRow {
  id: number
  name: string
  root_path: string
  origin_x: number
  origin_y: number
  created_at: number
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

interface CollectionRow {
  id: number
  name: string
  kind: string
  query: string | null
  similarity_floor: number | null
  color_index: number
  created_at: number
  updated_at: number
  evaluated_at: number | null
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

// B1 — defensive JSON parse: a hand-edit or older corrupt row could leave
// non-array JSON in the column; treat anything other than a string array as
// "no tags" so a malformed row never crashes the daemon.
function parseTags(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    if (!parsed.every(t => typeof t === 'string')) return null
    return parsed
  } catch {
    return null
  }
}

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
    galaxyId: row.galaxy_id,
    layoutVersion: row.layout_version,
    firstSeen: row.first_seen,
    viewCount: row.view_count,
    isPinned: row.is_pinned === 1,
    isFavorite: row.is_favorite === 1,
    favoriteAppearance: row.favorite_appearance,
    starType: row.star_type as StarType | null,
    pinAlpha: row.pin_alpha,
    pinBeta: row.pin_beta,
    pinAxisA: row.pin_axis_a,
    pinAxisB: row.pin_axis_b,
    pinnedAt: row.pinned_at,
    osUseCount: row.os_use_count,
    osLastUsed: row.os_last_used,
    importanceScore: row.importance_score,
    tags: parseTags(row.tags),
    embeddingStrategy: row.embedding_strategy,
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
    galaxyId: row.galaxy_id,
    layoutVersion: row.layout_version,
    firstSeen: row.first_seen,
    viewCount: row.view_count,
    isPinned: row.is_pinned === 1,
    isFavorite: row.is_favorite === 1,
    favoriteAppearance: row.favorite_appearance,
    starType: row.star_type as StarType | null,
    pinAlpha: row.pin_alpha,
    pinBeta: row.pin_beta,
    pinAxisA: row.pin_axis_a,
    pinAxisB: row.pin_axis_b,
    pinnedAt: row.pinned_at,
    osUseCount: row.os_use_count,
    osLastUsed: row.os_last_used,
    importanceScore: row.importance_score,
  }
}

function rowToGalaxy(row: GalaxyRow): Galaxy {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    originX: row.origin_x,
    originY: row.origin_y,
    createdAt: row.created_at,
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

function rowToCollection(row: CollectionRow): Collection {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CollectionKind,
    query: row.query,
    similarityFloor: row.similarity_floor,
    colorIndex: row.color_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evaluatedAt: row.evaluated_at,
  }
}
