import { createHash } from 'crypto'
import { basename, dirname, relative, sep } from 'path'
import type { FileIndex, IndexedFile } from '../db/FileIndex'
import type { AtlasFile, AtlasScope, AtlasRegion, AtlasSummary, AtlasHit, AtlasSnapshot } from '../../shared/atlas'
import { ATLAS_COLORS } from '../../shared/atlas'

const GROUP_CAP = 96
const REGION_CAP = 24
const CHUNK_SIZE = 4000
const CHUNK_OVERLAP = 300
type SqlValue = string | number
interface PositionRow { id: string; region_id: string; neighborhood_id: string; x: number; y: number; natural_x: number; natural_y: number; pinned: number }
interface RegionRow { id: string; parent_id: string | null; galaxy_id: number | null; label: string; kind: 'region' | 'neighborhood'; x: number; y: number; radius: number; color: string; member_count: number; group_key: string }

const identity = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 16)
export function spiralSlot(index: number, step: number): [number, number] {
  if (index === 0) return [0, 0]
  const ring = Math.ceil((Math.sqrt(index + 1) - 1) / 2)
  const side = ring * 2, offset = index - (2 * ring - 1) ** 2
  const edge = Math.floor(offset / side), n = offset % side
  const pairs: [number, number][] = [[ring, -ring + n], [ring - n, ring], [-ring, ring - n], [-ring + n, -ring]]
  return [pairs[edge][0] * step, pairs[edge][1] * step]
}

export function chunkText(text: string): { body: string; offset: number }[] {
  const chunks: { body: string; offset: number }[] = []
  for (let offset = 0; offset < text.length; offset += CHUNK_SIZE - CHUNK_OVERLAP) {
    chunks.push({ body: text.slice(offset, offset + CHUNK_SIZE), offset })
    if (offset + CHUNK_SIZE >= text.length) break
  }
  return chunks
}

/** User text is always quoted, never interpolated as an FTS expression. */
export function ftsQuery(query: string): string {
  const phrases = query.match(/"[^"]+"|[\p{L}\p{N}_]+/gu) ?? []
  return phrases.slice(0, 24).map(word => word.startsWith('"')
    ? '"' + word.slice(1, -1).replace(/"/g, '""') + '"'
    : '"' + word + '"*').join(' AND ')
}

export class AtlasStore {
  constructor(readonly index: FileIndex) {
    index.db.exec(`
      CREATE TABLE IF NOT EXISTS atlas_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1);
      INSERT OR IGNORE INTO atlas_state(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS atlas_regions (
        id TEXT PRIMARY KEY, parent_id TEXT, galaxy_id INTEGER, label TEXT NOT NULL,
        kind TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, radius REAL NOT NULL,
        color TEXT NOT NULL, member_count INTEGER NOT NULL DEFAULT 0, group_key TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS atlas_regions_parent ON atlas_regions(parent_id);
      CREATE INDEX IF NOT EXISTS atlas_regions_group ON atlas_regions(group_key);
      CREATE TABLE IF NOT EXISTS atlas_positions (
        id TEXT PRIMARY KEY, region_id TEXT NOT NULL, neighborhood_id TEXT NOT NULL,
        natural_x REAL NOT NULL, natural_y REAL NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0, legacy_pin TEXT
      );
      CREATE INDEX IF NOT EXISTS atlas_positions_region ON atlas_positions(region_id);
      CREATE INDEX IF NOT EXISTS atlas_positions_neighborhood ON atlas_positions(neighborhood_id);
      CREATE INDEX IF NOT EXISTS atlas_positions_xy ON atlas_positions(x,y);
      CREATE TABLE IF NOT EXISTS atlas_slots(id TEXT PRIMARY KEY, next_slot INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS atlas_dirty(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS atlas_documents(id TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', error TEXT, stamp TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS atlas_extract_queue(id TEXT PRIMARY KEY);
      CREATE VIRTUAL TABLE IF NOT EXISTS atlas_fts USING fts5(file_id UNINDEXED, name, path, tags, body, offset UNINDEXED, tokenize='unicode61', prefix='2 3 4');
      CREATE TABLE IF NOT EXISTS atlas_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL, file_count INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS atlas_file_insert AFTER INSERT ON files BEGIN
        INSERT OR IGNORE INTO atlas_dirty VALUES(new.id);
      END;
      CREATE TRIGGER IF NOT EXISTS atlas_file_update AFTER UPDATE OF name,path,tags,modified_at,size,embedding,star_type ON files BEGIN
        INSERT OR IGNORE INTO atlas_dirty VALUES(new.id);
      END;
      CREATE TRIGGER IF NOT EXISTS atlas_file_delete AFTER DELETE ON files BEGIN
        INSERT OR IGNORE INTO atlas_dirty VALUES(old.id);
      END;
      INSERT OR IGNORE INTO atlas_dirty SELECT id FROM files WHERE id NOT IN (SELECT id FROM atlas_positions);
    `)
  }

  get revision(): number { return (this.index.db.prepare('SELECT revision FROM atlas_state WHERE id=1').get() as { revision: number }).revision }
  bump(): void { this.index.db.prepare('UPDATE atlas_state SET revision=revision+1 WHERE id=1').run() }

  syncBatch(limit = 64): number {
    const rows = this.index.db.prepare('SELECT id FROM atlas_dirty ORDER BY rowid LIMIT ?').all(limit) as { id: string }[]
    if (!rows.length) return 0
    this.index.db.transaction(() => {
      for (const { id } of rows) {
        const file = this.index.get(id)
        if (file) {
          if (!this.position(id)) this.place(file)
          const doc = this.document(id)
          if (!doc) {
            this.index.db.prepare('INSERT OR IGNORE INTO atlas_documents(id) VALUES(?)').run(id)
            this.writeFts(file, '')
          } else this.writeFts(file, doc.text)
          if (!doc || doc.stamp !== `${file.modifiedAt}:${file.size}`) this.index.db.prepare('INSERT OR IGNORE INTO atlas_extract_queue VALUES(?)').run(id)
        } else {
          const previous = this.position(id)
          if (previous) this.index.db.prepare('UPDATE atlas_regions SET member_count=max(0,member_count-1) WHERE id IN (?,?)').run(previous.region_id, previous.neighborhood_id)
          this.index.db.prepare('DELETE FROM atlas_positions WHERE id=?').run(id)
          this.index.db.prepare('DELETE FROM atlas_documents WHERE id=?').run(id)
          this.index.db.prepare('DELETE FROM atlas_fts WHERE file_id=?').run(id)
          this.index.db.prepare('DELETE FROM atlas_extract_queue WHERE id=?').run(id)
        }
        this.index.db.prepare('DELETE FROM atlas_dirty WHERE id=?').run(id)
      }
      this.bump()
    })()
    return rows.length
  }

  private place(file: IndexedFile): void {
    const galaxy = file.galaxyId === null ? null : this.index.db.prepare('SELECT name,root_path FROM galaxies WHERE id=?').get(file.galaxyId) as { name: string; root_path: string } | undefined
    const rel = galaxy && !galaxy.root_path.startsWith('__default__') ? relative(galaxy.root_path, file.path) : file.name
    const parts = rel.split(sep)
    const branch = parts.length > 1 ? parts[0] : file.category
    const key = `${file.galaxyId ?? 'local'}:${branch}`
    let region = this.index.db.prepare(`SELECT * FROM atlas_regions WHERE group_key=? AND kind='region'
      AND (SELECT count(*) FROM atlas_regions n WHERE n.parent_id=atlas_regions.id AND n.member_count < ?) > 0 ORDER BY rowid LIMIT 1`).get(key, GROUP_CAP) as RegionRow | undefined
    if (!region) region = this.index.db.prepare(`SELECT * FROM atlas_regions WHERE group_key=? AND kind='region'
      AND (SELECT count(*) FROM atlas_regions n WHERE n.parent_id=atlas_regions.id) < ? ORDER BY rowid LIMIT 1`).get(key, REGION_CAP) as RegionRow | undefined
    if (!region) {
      const count = (this.index.db.prepare("SELECT count(*) n FROM atlas_regions WHERE kind='region'").get() as { n: number }).n
      const siblings = (this.index.db.prepare("SELECT count(*) n FROM atlas_regions WHERE group_key=? AND kind='region'").get(key) as { n: number }).n
      const [x, y] = spiralSlot(count, 3200)
      region = { id: identity(`region:${key}:${siblings}`), parent_id: null, galaxy_id: file.galaxyId,
        label: branch.replace(/[-_]/g, ' ') + (siblings ? ` · ${siblings + 1}` : ''), kind: 'region', x, y, radius: 1350,
        color: ATLAS_COLORS[count % ATLAS_COLORS.length], member_count: 0, group_key: key }
      this.insertRegion(region)
    }
    // Follow a strong already-placed semantic neighbor, but bound group size
    // and retain source context. Bridges cannot merge entire components.
    let group = this.index.db.prepare(`SELECT n.* FROM edges e JOIN atlas_positions p ON p.id=e.dst_id
      JOIN atlas_regions n ON n.id=p.neighborhood_id
      WHERE e.src_id=? AND e.weight >= 0.55 AND n.parent_id=? AND n.member_count < ?
      ORDER BY e.weight DESC LIMIT 1`).get(file.id, region.id, GROUP_CAP) as RegionRow | undefined
    const folderKey = `${region.id}:${dirname(rel)}:${file.category}`
    if (!group) group = this.index.db.prepare('SELECT * FROM atlas_regions WHERE group_key=? AND member_count < ? ORDER BY rowid LIMIT 1').get(folderKey, GROUP_CAP) as RegionRow | undefined
    if (!group) {
      const groups = (this.index.db.prepare('SELECT count(*) n FROM atlas_regions WHERE parent_id=?').get(region.id) as { n: number }).n
      if (groups >= REGION_CAP) group = this.index.db.prepare('SELECT * FROM atlas_regions WHERE parent_id=? AND member_count < ? ORDER BY member_count,rowid LIMIT 1').get(region.id, GROUP_CAP) as RegionRow | undefined
    }
    if (!group) {
      const slot = (this.index.db.prepare('SELECT count(*) n FROM atlas_regions WHERE parent_id=?').get(region.id) as { n: number }).n
      const [dx, dy] = spiralSlot(slot, 450)
      const label = dirname(rel) === '.' ? file.category : basename(dirname(rel))
      group = { id: identity(`neighborhood:${region.id}:${slot}`), parent_id: region.id, galaxy_id: file.galaxyId,
        label: label.replace(/[-_]/g, ' '), kind: 'neighborhood', x: region.x + dx, y: region.y + dy, radius: 190,
        color: region.color, member_count: 0, group_key: folderKey }
      this.insertRegion(group)
    }
    this.index.db.prepare('INSERT OR IGNORE INTO atlas_slots(id,next_slot) VALUES(?,?)').run(group.id, group.member_count)
    const ordinal = (this.index.db.prepare('SELECT next_slot FROM atlas_slots WHERE id=?').get(group.id) as { next_slot: number }).next_slot
    this.index.db.prepare('UPDATE atlas_slots SET next_slot=next_slot+1 WHERE id=?').run(group.id)
    const angle = ordinal * 2.399963229728653
    const radius = 16 * Math.sqrt(ordinal + 1)
    const x = group.x + Math.cos(angle) * radius, y = group.y + Math.sin(angle) * radius
    const legacyPin = file.isPinned ? JSON.stringify({ x: file.x, y: file.y, alpha: file.pinAlpha, beta: file.pinBeta, axisA: file.pinAxisA, axisB: file.pinAxisB, at: file.pinnedAt }) : null
    this.index.db.prepare(`INSERT INTO atlas_positions(id,region_id,neighborhood_id,natural_x,natural_y,x,y,pinned,legacy_pin) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(file.id, region.id, group.id, x, y, x, y, file.isPinned ? 1 : 0, legacyPin)
    this.index.db.prepare('UPDATE atlas_regions SET member_count=member_count+1 WHERE id IN (?,?)').run(region.id, group.id)
  }

  private insertRegion(r: RegionRow): void {
    this.index.db.prepare(`INSERT INTO atlas_regions(id,parent_id,galaxy_id,label,kind,x,y,radius,color,member_count,group_key)
      VALUES(@id,@parent_id,@galaxy_id,@label,@kind,@x,@y,@radius,@color,@member_count,@group_key)`).run(r)
  }

  position(id: string): PositionRow | undefined { return this.index.db.prepare('SELECT * FROM atlas_positions WHERE id=?').get(id) as PositionRow | undefined }
  document(id: string): { text: string; status: string; error: string | null; stamp: string } | undefined {
    return this.index.db.prepare('SELECT text,status,error,stamp FROM atlas_documents WHERE id=?').get(id) as { text: string; status: string; error: string | null; stamp: string } | undefined
  }
  needsExtraction(limit = 8): { id: string; path: string; size: number; modified_at: number }[] {
    return this.index.db.prepare(`SELECT f.id,f.path,f.size,f.modified_at FROM atlas_extract_queue q JOIN files f ON f.id=q.id LIMIT ?`).all(limit) as { id: string; path: string; size: number; modified_at: number }[]
  }

  setText(id: string, text: string, status: string, stamp: string, error: string | null = null): boolean {
    const file = this.index.get(id)
    if (!file || `${file.modifiedAt}:${file.size}` !== stamp) return false
    this.index.db.transaction(() => {
      this.index.db.prepare('INSERT OR REPLACE INTO atlas_documents(id,text,status,error,stamp) VALUES(?,?,?,?,?)').run(id, text, status, error, stamp)
      this.writeFts(file, text)
      this.index.db.prepare('DELETE FROM atlas_extract_queue WHERE id=?').run(id)
      this.bump()
    })()
    return true
  }

  private writeFts(file: IndexedFile, text: string): void {
    this.index.db.prepare('DELETE FROM atlas_fts WHERE file_id=?').run(file.id)
    const insert = this.index.db.prepare('INSERT INTO atlas_fts(file_id,name,path,tags,body,offset) VALUES(?,?,?,?,?,?)')
    insert.run(file.id, file.name, file.path, (file.tags ?? []).join(' '), '', 0)
    for (const c of chunkText(text)) insert.run(file.id, '', '', '', c.body, c.offset)
  }

  private scope(scope: AtlasScope): { sql: string; args: SqlValue[] } {
    const clauses: string[] = [], args: SqlValue[] = []
    if (scope.galaxyIds) {
      if (!scope.galaxyIds.length) clauses.push('0')
      else { clauses.push(`f.galaxy_id IN (${scope.galaxyIds.map(() => '?').join(',')})`); args.push(...scope.galaxyIds) }
    }
    for (const [value, column] of [[scope.regionId, 'p.region_id'], [scope.neighborhoodId, 'p.neighborhood_id'], [scope.category, 'f.category']] as const) {
      if (value !== undefined) { clauses.push(`${column}=?`); args.push(value) }
    }
    if (scope.collectionId !== undefined) { clauses.push('EXISTS(SELECT 1 FROM collection_members c WHERE c.file_id=f.id AND c.collection_id=?)'); args.push(scope.collectionId) }
    if (scope.tag) { clauses.push("EXISTS(SELECT 1 FROM json_each(COALESCE(f.tags,'[]')) WHERE value=?)"); args.push(scope.tag) }
    return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args }
  }

  summary(scope: AtlasScope = {}): AtlasSummary {
    const filter = this.scope(scope)
    const counts = this.index.db.prepare(`SELECT p.region_id,p.neighborhood_id,count(*) n FROM files f JOIN atlas_positions p ON p.id=f.id WHERE 1${filter.sql} GROUP BY p.region_id,p.neighborhood_id`).all(...filter.args) as { region_id: string; neighborhood_id: string; n: number }[]
    const memberCounts = new Map<string, number>()
    for (const c of counts) { memberCounts.set(c.neighborhood_id, c.n); memberCounts.set(c.region_id, (memberCounts.get(c.region_id) ?? 0) + c.n) }
    const regions = (this.index.db.prepare('SELECT * FROM atlas_regions WHERE member_count > 0 ORDER BY rowid').all() as RegionRow[])
      .filter(r => memberCounts.has(r.id)).map(r => this.region(r, memberCounts.get(r.id)!))
    return { revision: this.revision, total: this.index.count(), positioned: counts.reduce((n, c) => n + c.n, 0),
      searchable: (this.index.db.prepare("SELECT count(*) n FROM atlas_documents WHERE status != 'pending'").get() as { n: number }).n,
      pending: (this.index.db.prepare('SELECT count(*) n FROM atlas_dirty').get() as { n: number }).n, regions }
  }

  private region(r: RegionRow, count = r.member_count): AtlasRegion { return { id: r.id, parentId: r.parent_id, galaxyId: r.galaxy_id, label: r.label, kind: r.kind, x: r.x, y: r.y, radius: r.radius, color: r.color, count } }

  file(id: string): AtlasFile | null {
    const f = this.index.get(id), p = this.position(id)
    if (!f || !p) return null
    const { embedding, contentHash: _hash, z: _z, embeddingStrategy: _strategy, ...rest } = f
    return { ...rest, x: p.x, y: p.y, tags: f.tags ?? [], isPinned: p.pinned === 1, regionId: p.region_id,
      neighborhoodId: p.neighborhood_id, hasEmbedding: embedding !== null, extractionStatus: this.document(id)?.status ?? 'pending' }
  }

  list(scope: AtlasScope = {}, offset = 0, limit = 100): { files: AtlasFile[]; total: number; revision: number } {
    const filter = this.scope(scope)
    const base = `FROM files f JOIN atlas_positions p ON p.id=f.id WHERE 1${filter.sql}`
    const total = (this.index.db.prepare(`SELECT count(*) n ${base}`).get(...filter.args) as { n: number }).n
    const ids = this.index.db.prepare(`SELECT f.id ${base} ORDER BY f.name COLLATE NOCASE,f.id LIMIT ? OFFSET ?`).all(...filter.args, limit, offset) as { id: string }[]
    return { files: ids.map(({ id }) => this.file(id)!).filter(Boolean), total, revision: this.revision }
  }

  lexical(query: string, scope: AtlasScope, limit: number): AtlasHit[] {
    const filter = this.scope(scope), normalized = query.trim().replace(/^"|"$/g, '')
    const needle = `%${normalized.replace(/[\\%_]/g, '\\$&')}%`
    const direct = this.index.db.prepare(`SELECT f.id FROM files f JOIN atlas_positions p ON p.id=f.id WHERE
      (f.name LIKE ? ESCAPE '\\' OR f.path LIKE ? ESCAPE '\\')${filter.sql}
      ORDER BY (lower(f.name)=lower(?)) DESC,(f.name LIKE ? ESCAPE '\\') DESC,length(f.name),f.id LIMIT ?`)
      .all(needle, needle, ...filter.args, normalized, needle, limit) as { id: string }[]
    const hits = new Map<string, AtlasHit>()
    for (const { id } of direct) {
      const file = this.file(id)!
      const nameHit = file.name.toLowerCase().includes(normalized.toLowerCase())
      hits.set(id, { file, score: file.name.toLowerCase() === normalized.toLowerCase() ? 100 : nameHit ? 90 : 70, reason: nameHit ? 'name' : 'path', snippet: file.path, offset: 0 })
    }
    const match = ftsQuery(query)
    if (match) {
      // Scope is applied before candidates are ranked. Each file contributes
      // its best passage, so long documents cannot consume the result budget.
      const rows = this.index.db.prepare(`SELECT file_id, snippet(atlas_fts,4,'','', ' … ',32) excerpt, offset, atlas_fts.tags, rank FROM atlas_fts
        JOIN files f ON f.id=atlas_fts.file_id JOIN atlas_positions p ON p.id=f.id
        WHERE atlas_fts MATCH ?${filter.sql} AND rank MATCH 'bm25(0,10,3,6,1,0)'
        ORDER BY rank`).iterate(match, ...filter.args)
      for (const item of rows) {
        if (hits.size >= limit) break
        const row = item as { file_id: string; excerpt: string; offset: number; tags: string; rank: number }
        if (hits.has(row.file_id)) continue
        hits.set(row.file_id, { file: this.file(row.file_id)!, score: 50 - row.rank, reason: row.tags ? 'tags' : 'content', snippet: row.excerpt || this.file(row.file_id)!.path, offset: Number(row.offset) })
      }
    }
    return [...hits.values()].sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name)).slice(0, limit)
  }

  vectorBatch(scope: AtlasScope, after: string, limit = 256): { id: string; embedding: Float32Array }[] {
    const filter = this.scope(scope)
    const rows = this.index.db.prepare(`SELECT f.id,f.embedding FROM files f JOIN atlas_positions p ON p.id=f.id WHERE f.embedding IS NOT NULL AND f.id > ?${filter.sql} ORDER BY f.id LIMIT ?`).all(after, ...filter.args, limit) as { id: string; embedding: Buffer }[]
    return rows.map(r => ({ id: r.id, embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4) }))
  }

  pin(id: string, x: number | null, y: number | null): boolean {
    if (!this.position(id)) return false
    this.index.db.prepare('UPDATE atlas_positions SET x=COALESCE(?,natural_x),y=COALESCE(?,natural_y),pinned=? WHERE id=?').run(x, y, x === null ? 0 : 1, id)
    this.bump(); return true
  }
  renameRegion(id: string, label: string): boolean {
    const result = this.index.db.prepare('UPDATE atlas_regions SET label=? WHERE id=?').run(label, id)
    if (result.changes) this.bump()
    return result.changes > 0
  }
  snapshots(): AtlasSnapshot[] {
    return (this.index.db.prepare('SELECT id,name,created_at,file_count FROM atlas_snapshots ORDER BY id DESC').all() as { id: number; name: string; created_at: number; file_count: number }[])
      .map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, count: r.file_count }))
  }
  snapshot(name: string): number {
    const positions = this.index.db.prepare('SELECT * FROM atlas_positions').all(), regions = this.index.db.prepare('SELECT * FROM atlas_regions').all()
    return Number(this.index.db.prepare('INSERT INTO atlas_snapshots(name,created_at,payload,file_count) VALUES(?,?,?,?)').run(name, Date.now(), JSON.stringify({ positions, regions }), positions.length).lastInsertRowid)
  }
  restore(id: number): boolean {
    const snapshot = this.index.db.prepare('SELECT payload FROM atlas_snapshots WHERE id=?').get(id) as { payload: string } | undefined
    if (!snapshot) return false
    const data = JSON.parse(snapshot.payload) as { positions: PositionRow[]; regions: RegionRow[] }
    this.index.db.transaction(() => {
      for (const r of data.regions) this.index.db.prepare('UPDATE atlas_regions SET label=? WHERE id=?').run(r.label, r.id)
      for (const p of data.positions) this.index.db.prepare('UPDATE atlas_positions SET x=?,y=?,pinned=? WHERE id=?').run(p.x, p.y, p.pinned, p.id)
      this.bump()
    })()
    return true
  }
}
