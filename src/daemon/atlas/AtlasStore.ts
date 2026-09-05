import { fileExtension } from '../../shared/fileExtension'
import type { FavoriteAppearance } from '../../shared/types'
import { organicLayout, cloudOffset, LEGACY_ATLAS_SCALE, type LayoutFile } from './organicLayout'
import { celestialType } from '../../shared/celestial'
import type { StarType } from '../../shared/types'
import { createHash } from 'crypto'
import { basename, dirname, relative, sep } from 'path'
import type { FileIndex, IndexedFile } from '../db/FileIndex'
import type { AtlasFile, AtlasScope, AtlasRegion, AtlasSummary, AtlasHit, AtlasSnapshot, AtlasMarker } from '../../shared/atlas'
import { ATLAS_COLORS } from '../../shared/atlas'
import { folderConstellations, type FolderPoint } from './folderConstellations'
import { NebulaStore } from './NebulaStore'

const GROUP_CAP = 96
const REGION_CAP = 24
const CHUNK_SIZE = 4000
const CHUNK_OVERLAP = 300
type SqlValue = string | number
interface PositionRow { id: string; region_id: string; neighborhood_id: string; x: number; y: number; natural_x: number; natural_y: number; pinned: number }
interface RegionRow { id: string; parent_id: string | null; galaxy_id: number | null; label: string; kind: 'region' | 'neighborhood'; x: number; y: number; radius: number; color: string; member_count: number; group_key: string }

const identity = (value: string): string => createHash('sha1').update(value).digest('hex').slice(0, 16)

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
  private readonly nebulaStore: NebulaStore
  private folderGraph: { paths: Map<string, string>; links: ReturnType<typeof folderConstellations> } | null = null
  constructor(readonly index: FileIndex) {
    index.db.function('atlas_extension', { deterministic: true }, name => fileExtension(String(name)))
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
      CREATE TABLE IF NOT EXISTS atlas_object_types(id TEXT PRIMARY KEY, type TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS atlas_region_types(region_id TEXT NOT NULL,type TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(region_id,type));
      CREATE TABLE IF NOT EXISTS atlas_slots(id TEXT PRIMARY KEY, next_slot INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS atlas_dirty(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS atlas_documents(id TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', error TEXT, stamp TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS atlas_documents_status ON atlas_documents(status);
      CREATE TABLE IF NOT EXISTS atlas_extract_queue(id TEXT PRIMARY KEY);
      CREATE VIRTUAL TABLE IF NOT EXISTS atlas_fts USING fts5(file_id UNINDEXED, name, path, tags, body, offset UNINDEXED, tokenize='unicode61', prefix='2 3 4');
      CREATE VIRTUAL TABLE IF NOT EXISTS atlas_names USING fts5(name,path,tokenize='trigram');
      CREATE TABLE IF NOT EXISTS atlas_fts_rows(row_id INTEGER PRIMARY KEY, file_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS atlas_fts_rows_file ON atlas_fts_rows(file_id);
      INSERT OR IGNORE INTO atlas_fts_rows SELECT rowid,file_id FROM atlas_fts;
      CREATE TABLE IF NOT EXISTS atlas_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL, file_count INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS atlas_favorite_update AFTER UPDATE OF is_favorite,favorite_appearance ON files
      WHEN new.is_favorite != old.is_favorite OR new.favorite_appearance != old.favorite_appearance BEGIN
        UPDATE atlas_state SET revision=revision+1 WHERE id=1;
      END;
      CREATE TRIGGER IF NOT EXISTS atlas_name_delete BEFORE DELETE ON files BEGIN
        DELETE FROM atlas_names WHERE rowid=old.rowid;
      END;
      DROP TRIGGER IF EXISTS atlas_file_insert;
      DROP TRIGGER IF EXISTS atlas_file_update;
      DROP TRIGGER IF EXISTS atlas_file_delete;
      CREATE TRIGGER atlas_file_insert AFTER INSERT ON files BEGIN
        INSERT INTO atlas_dirty(id) VALUES(new.id) ON CONFLICT(id) DO NOTHING;
      END;
      CREATE TRIGGER IF NOT EXISTS atlas_file_update AFTER UPDATE OF name,path,tags,modified_at,size,embedding,star_type ON files BEGIN
        INSERT INTO atlas_dirty(id) VALUES(new.id) ON CONFLICT(id) DO NOTHING;
      END;
      CREATE TRIGGER IF NOT EXISTS atlas_file_delete AFTER DELETE ON files BEGIN
        INSERT INTO atlas_dirty(id) VALUES(old.id) ON CONFLICT(id) DO NOTHING;
      END;
      INSERT OR IGNORE INTO atlas_dirty SELECT id FROM files WHERE id NOT IN (SELECT id FROM atlas_positions) OR rowid NOT IN (SELECT rowid FROM atlas_names) OR id NOT IN (SELECT id FROM atlas_object_types);
    `)
    if (!(index.db.prepare('PRAGMA table_info(atlas_state)').all() as { name: string }[]).some(c => c.name === 'layout_epoch')) {
      index.db.exec('ALTER TABLE atlas_state ADD COLUMN layout_epoch INTEGER NOT NULL DEFAULT 0')
    }
    this.nebulaStore = new NebulaStore(index)
  }

  get revision(): number { return (this.index.db.prepare('SELECT revision FROM atlas_state WHERE id=1').get() as { revision: number }).revision }
  bump(): void { this.index.db.prepare('UPDATE atlas_state SET revision=revision+1 WHERE id=1').run() }

  syncBatch(limit = 64): number {
    const rows = this.index.db.prepare('SELECT id FROM atlas_dirty ORDER BY rowid LIMIT ?').all(limit) as { id: string }[]
    if (!rows.length) return 0
    this.index.db.transaction(() => {
      for (const { id } of rows) {
        const file = this.index.get(id)
        // Extraction, tags, and classifications do not change folder geometry.
        if (this.folderGraph && this.folderGraph.paths.get(id) !== file?.path) this.folderGraph = null
        if (file) {
          if (!this.position(id)) this.place(file)
          this.updateObjectType(id, celestialType(file))
          const row = this.index.db.prepare('SELECT rowid FROM files WHERE id=?').get(id) as { rowid: number }
          this.index.db.prepare('DELETE FROM atlas_names WHERE rowid=?').run(row.rowid)
          this.index.db.prepare('INSERT INTO atlas_names(rowid,name,path) VALUES(?,?,?)').run(row.rowid, file.name.toLowerCase(), file.path.toLowerCase())
          const doc = this.document(id)
          if (!doc) {
            this.index.db.prepare('INSERT OR IGNORE INTO atlas_documents(id) VALUES(?)').run(id)
            this.writeFts(file, '')
          } else this.writeFts(file, doc.text)
          if (!doc || doc.stamp !== `${file.modifiedAt}:${file.size}`) this.index.db.prepare('INSERT OR IGNORE INTO atlas_extract_queue VALUES(?)').run(id)
        } else {
          const previous = this.position(id)
          this.updateObjectType(id, null)
          if (previous) this.index.db.prepare('UPDATE atlas_regions SET member_count=max(0,member_count-1) WHERE id IN (?,?)').run(previous.region_id, previous.neighborhood_id)
          this.index.db.prepare('DELETE FROM atlas_positions WHERE id=?').run(id)
          this.index.db.prepare('DELETE FROM atlas_documents WHERE id=?').run(id)
          this.deleteFts(id)
          this.index.db.prepare('DELETE FROM atlas_extract_queue WHERE id=?').run(id)
        }
        this.index.db.prepare('DELETE FROM atlas_dirty WHERE id=?').run(id)
      }
      this.bump()
    })()
    return rows.length
  }

  private updateObjectType(id: string, type: StarType | null): void {
    const previous = (this.index.db.prepare('SELECT type FROM atlas_object_types WHERE id=?').get(id) as { type: StarType } | undefined)?.type
    if (previous === type) return
    const position = this.position(id)
    if (position) for (const region of [position.region_id, position.neighborhood_id]) {
      if (previous) this.index.db.prepare('UPDATE atlas_region_types SET count=max(0,count-1) WHERE region_id=? AND type=?').run(region, previous)
      if (type) this.index.db.prepare('INSERT INTO atlas_region_types(region_id,type,count) VALUES(?,?,1) ON CONFLICT(region_id,type) DO UPDATE SET count=count+1').run(region, type)
    }
    if (type) this.index.db.prepare('INSERT OR REPLACE INTO atlas_object_types VALUES(?,?)').run(id, type)
    else this.index.db.prepare('DELETE FROM atlas_object_types WHERE id=?').run(id)
  }

  private place(file: IndexedFile): void {
    this.folderGraph = null
    const galaxy = file.galaxyId === null ? null : this.index.db.prepare('SELECT name,root_path FROM galaxies WHERE id=?').get(file.galaxyId) as { name: string; root_path: string } | undefined
    const rel = galaxy && !galaxy.root_path.startsWith('__default__') ? relative(galaxy.root_path, file.path) : file.name
    const parts = rel.split(sep)
    const branch = parts.length > 1 ? parts[0] : 'Loose files'
    const key = `${file.galaxyId ?? 'local'}:${branch}`
    let region = this.index.db.prepare(`SELECT * FROM atlas_regions WHERE group_key=? AND kind='region'
      AND (SELECT count(*) FROM atlas_regions n WHERE n.parent_id=atlas_regions.id AND n.member_count < ?) > 0 ORDER BY rowid LIMIT 1`).get(key, GROUP_CAP) as RegionRow | undefined
    if (!region) region = this.index.db.prepare(`SELECT * FROM atlas_regions WHERE group_key=? AND kind='region'
      AND (SELECT count(*) FROM atlas_regions n WHERE n.parent_id=atlas_regions.id) < ? ORDER BY rowid LIMIT 1`).get(key, REGION_CAP) as RegionRow | undefined
    if (!region) {
      const count = (this.index.db.prepare("SELECT count(*) n FROM atlas_regions WHERE kind='region'").get() as { n: number }).n
      const siblings = (this.index.db.prepare("SELECT count(*) n FROM atlas_regions WHERE group_key=? AND kind='region'").get(key) as { n: number }).n
      const center = file.x !== null && file.y !== null ? { x: file.x * LEGACY_ATLAS_SCALE, y: file.y * LEGACY_ATLAS_SCALE } : cloudOffset(key + ':' + siblings, 3500 * Math.sqrt(siblings + 1))
      const { x, y } = center
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
    const folderKey = `${region.id}:${dirname(rel)}`
    if (!group) group = this.index.db.prepare('SELECT * FROM atlas_regions WHERE group_key IN (?,?,?,?,?,?) AND member_count < ? ORDER BY rowid LIMIT 1')
      .get(folderKey, ...['document', 'code', 'data', 'media', 'unknown'].map(type => folderKey + ':' + type), GROUP_CAP) as RegionRow | undefined
    if (!group) {
      const groups = (this.index.db.prepare('SELECT count(*) n FROM atlas_regions WHERE parent_id=?').get(region.id) as { n: number }).n
      if (groups >= REGION_CAP) group = this.index.db.prepare('SELECT * FROM atlas_regions WHERE parent_id=? AND member_count < ? ORDER BY member_count,rowid LIMIT 1').get(region.id, GROUP_CAP) as RegionRow | undefined
    }
    if (!group) {
      const slot = (this.index.db.prepare('SELECT count(*) n FROM atlas_regions WHERE parent_id=?').get(region.id) as { n: number }).n
      const { x: dx, y: dy } = cloudOffset(folderKey + ':' + slot, 600 * Math.sqrt(slot + 1))
      const label = dirname(rel) === '.' ? 'Mixed files' : basename(dirname(rel))
      group = { id: identity(`neighborhood:${region.id}:${slot}`), parent_id: region.id, galaxy_id: file.galaxyId,
        label: label.replace(/[-_]/g, ' '), kind: 'neighborhood', x: region.x + dx, y: region.y + dy, radius: 190,
        color: region.color, member_count: 0, group_key: folderKey }
      this.insertRegion(group)
    }
    this.index.db.prepare('INSERT OR IGNORE INTO atlas_slots(id,next_slot) VALUES(?,?)').run(group.id, group.member_count)
    const ordinal = (this.index.db.prepare('SELECT next_slot FROM atlas_slots WHERE id=?').get(group.id) as { next_slot: number }).next_slot
    this.index.db.prepare('UPDATE atlas_slots SET next_slot=next_slot+1 WHERE id=?').run(group.id)
    const offset = cloudOffset(file.id, 160 + Math.sqrt(ordinal) * 8)
    const related = this.index.db.prepare(`SELECT p.natural_x x,p.natural_y y FROM edges e
      JOIN atlas_positions p ON p.id=e.dst_id WHERE e.src_id=? ORDER BY e.weight DESC LIMIT 1`).get(file.id) as { x: number; y: number } | undefined
    const projected = file.x !== null && file.y !== null ? { x: file.x * LEGACY_ATLAS_SCALE, y: file.y * LEGACY_ATLAS_SCALE } : null
    const center = projected ?? related ?? group
    let x = center.x + (projected ? 0 : offset.x), y = center.y + (projected ? 0 : offset.y)
    // Only the new file moves when a location is crowded. Existing files never relax.
    const occupied = this.index.db.prepare('SELECT 1 FROM atlas_positions WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ? LIMIT 1')
    for (let attempt = 1; occupied.get(x - 9, x + 9, y - 9, y + 9); attempt++) {
      const jitter = cloudOffset(file.id + ':' + attempt, 24 * Math.sqrt(attempt))
      x = center.x + jitter.x; y = center.y + jitter.y
    }
    const legacyPin = file.isPinned ? JSON.stringify({ x: file.x, y: file.y, alpha: file.pinAlpha, beta: file.pinBeta, axisA: file.pinAxisA, axisB: file.pinAxisB, at: file.pinnedAt }) : null
    this.index.db.prepare(`INSERT INTO atlas_positions(id,region_id,neighborhood_id,natural_x,natural_y,x,y,pinned,legacy_pin) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(file.id, region.id, group.id, x, y, x, y, file.isPinned ? 1 : 0, legacyPin)
    this.index.db.prepare('UPDATE atlas_regions SET member_count=member_count+1 WHERE id IN (?,?)').run(region.id, group.id)
    for (const area of [region, group]) this.index.db.prepare('UPDATE atlas_regions SET radius=max(radius,?) WHERE id=?')
      .run(Math.hypot(x - area.x, y - area.y) + 60, area.id)
  }

  reshapeOrganic(): number {
    this.folderGraph = null
    const files = this.index.db.prepare('SELECT id,path,x,y FROM files ORDER BY id').all() as LayoutFile[]
    const neighbors = new Map<string, string[]>()
    for (const edge of this.index.db.prepare('SELECT src_id,dst_id FROM edges ORDER BY weight DESC').all() as { src_id: string; dst_id: string }[]) {
      const list = neighbors.get(edge.src_id) ?? []
      if (list.length < 6) list.push(edge.dst_id)
      neighbors.set(edge.src_id, list)
    }
    const points = organicLayout(files, neighbors)
    return this.index.db.transaction(() => {
      const snapshot = this.snapshot('Before organic arrangement')
      const update = this.index.db.prepare(`UPDATE atlas_positions SET natural_x=?,natural_y=?,
        x=CASE WHEN pinned=1 THEN x ELSE ? END,y=CASE WHEN pinned=1 THEN y ELSE ? END WHERE id=?`)
      for (const [id, p] of points) update.run(p.x, p.y, p.x, p.y, id)
      // Region labels describe the files; they do not dictate their positions.
      for (const area of this.index.db.prepare('SELECT * FROM atlas_regions').all() as RegionRow[]) {
        const column = area.kind === 'region' ? 'region_id' : 'neighborhood_id'
        const members = this.index.db.prepare(`SELECT natural_x x,natural_y y FROM atlas_positions WHERE ${column}=?`).all(area.id) as { x: number; y: number }[]
        if (!members.length) continue
        const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
        const x = median(members.map(p => p.x)), y = median(members.map(p => p.y))
        const radius = Math.max(100, ...members.map(p => Math.hypot(p.x - x, p.y - y) + 60))
        this.index.db.prepare('UPDATE atlas_regions SET x=?,y=?,radius=? WHERE id=?').run(x, y, radius, area.id)
      }
      this.index.db.exec('UPDATE atlas_state SET layout_epoch=layout_epoch+1')
      this.bump()
      return snapshot
    })()
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

  private deleteFts(id: string): void {
    // FTS UNINDEXED columns do not have a B-tree. Deleting by file_id would
    // scan the entire corpus for every update, making initial builds quadratic.
    this.index.db.prepare('DELETE FROM atlas_fts WHERE rowid IN (SELECT row_id FROM atlas_fts_rows WHERE file_id=?)').run(id)
    this.index.db.prepare('DELETE FROM atlas_fts_rows WHERE file_id=?').run(id)
  }

  private writeFts(file: IndexedFile, text: string): void {
    this.deleteFts(file.id)
    const insert = this.index.db.prepare('INSERT INTO atlas_fts(file_id,name,path,tags,body,offset) VALUES(?,?,?,?,?,?)')
    const track = this.index.db.prepare('INSERT INTO atlas_fts_rows(row_id,file_id) VALUES(?,?)')
    track.run(insert.run(file.id, file.name, file.path, (file.tags ?? []).join(' '), '', 0).lastInsertRowid, file.id)
    for (const c of chunkText(text)) track.run(insert.run(file.id, '', '', '', c.body, c.offset).lastInsertRowid, file.id)
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
    if (scope.extension !== undefined) { clauses.push('atlas_extension(f.name)=?'); args.push(scope.extension.toLowerCase()) }
    if (scope.collectionId !== undefined) { clauses.push('EXISTS(SELECT 1 FROM collection_members c WHERE c.file_id=f.id AND c.collection_id=?)'); args.push(scope.collectionId) }
    if (scope.tag) { clauses.push("EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(f.tags) THEN f.tags ELSE '[]' END) WHERE value=?)"); args.push(scope.tag) }
    return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', args }
  }

  summary(scope: AtlasScope = {}): AtlasSummary {
    const filter = this.scope(scope)
    const { extension: _extension, ...extensionScope } = scope
    const extensionFilter = this.scope(extensionScope)
    const extensions = this.index.db.prepare(`SELECT atlas_extension(f.name) extension,count(*) count FROM files f JOIN atlas_positions p ON p.id=f.id WHERE 1${extensionFilter.sql} GROUP BY extension ORDER BY extension`).all(...extensionFilter.args) as { extension: string; count: number }[]
    const counts = !filter.sql ? [] : this.index.db.prepare(`SELECT p.region_id,p.neighborhood_id,count(*) n FROM files f JOIN atlas_positions p ON p.id=f.id WHERE 1${filter.sql} GROUP BY p.region_id,p.neighborhood_id`).all(...filter.args) as { region_id: string; neighborhood_id: string; n: number }[]
    const memberCounts = new Map<string, number>()
    for (const c of counts) { memberCounts.set(c.neighborhood_id, c.n); memberCounts.set(c.region_id, (memberCounts.get(c.region_id) ?? 0) + c.n) }
    const regions = (this.index.db.prepare('SELECT * FROM atlas_regions WHERE member_count > 0 ORDER BY rowid').all() as RegionRow[])
      .filter(r => !filter.sql || memberCounts.has(r.id)).map(r => this.region(r, filter.sql ? memberCounts.get(r.id)! : r.member_count))
    const types = !filter.sql
      ? this.index.db.prepare('SELECT region_id,type,count FROM atlas_region_types WHERE count>0').all() as { region_id: string; type: StarType; count: number }[]
      : this.index.db.prepare(`SELECT p.region_id,p.neighborhood_id,o.type,count(*) count FROM files f JOIN atlas_positions p ON p.id=f.id JOIN atlas_object_types o ON o.id=f.id WHERE 1${filter.sql} GROUP BY p.region_id,p.neighborhood_id,o.type`).all(...filter.args) as { region_id: string; neighborhood_id: string; type: StarType; count: number }[]
    const byId = new Map(regions.map(r => [r.id, r]))
    for (const row of types) for (const id of 'neighborhood_id' in row ? [row.region_id, row.neighborhood_id as string] : [row.region_id]) {
      const region = byId.get(id)
      if (region) { region.objectTypes ??= {}; region.objectTypes[row.type] = (region.objectTypes[row.type] ?? 0) + row.count }
    }
    // Real, stable file positions at every zoom. Never invent replacement stars
    // for aggregates: hydration only adds detail to these same coordinates.
    const groups = regions.filter(r => r.kind === 'neighborhood')
    const sampleCount = Math.max(1, Math.floor(4096 / Math.max(1, groups.length)))
    const markerJoin = 'JOIN files f ON f.id=p.id'
    const sample = this.index.db.prepare(`SELECT p.id,p.x,p.y,p.region_id regionId,p.neighborhood_id neighborhoodId,o.type,f.size,f.modified_at modifiedAt,f.is_favorite isFavorite,f.favorite_appearance favoriteAppearance FROM atlas_positions p
      ${markerJoin} JOIN atlas_object_types o ON o.id=p.id
      WHERE p.neighborhood_id=?${filter.sql} ORDER BY p.rowid LIMIT ?`)
    const markers = regions.filter(r => r.kind === 'region').reduce((n, r) => n + r.count, 0) <= 4096
      ? this.index.db.prepare(`SELECT p.id,p.x,p.y,p.region_id regionId,p.neighborhood_id neighborhoodId,o.type,f.size,f.modified_at modifiedAt,f.is_favorite isFavorite,f.favorite_appearance favoriteAppearance FROM atlas_positions p ${markerJoin} JOIN atlas_object_types o ON o.id=p.id WHERE 1${filter.sql}`).all(...filter.args) as AtlasMarker[] : []
    const stride = Math.max(1, Math.ceil(groups.length / 4096))
    if (!markers.length) for (let i = 0; i < groups.length; i += stride) markers.push(...sample.all(groups[i].id, ...filter.args, sampleCount) as AtlasMarker[])
    const layoutEpoch = (this.index.db.prepare('SELECT layout_epoch FROM atlas_state WHERE id=1').get() as { layout_epoch: number }).layout_epoch
    return { extensions, layoutEpoch, nebulaEpoch: this.nebulaStore.epoch, markers: markers.map(marker => ({ ...marker, isFavorite: Boolean(marker.isFavorite) })), revision: this.revision, total: this.index.count(), positioned: regions.filter(r => r.kind === 'region').reduce((n, r) => n + r.count, 0),
      searchable: (this.index.db.prepare("SELECT count(*) n FROM atlas_documents WHERE status != 'pending'").get() as { n: number }).n,
      pending: (this.index.db.prepare('SELECT count(*) n FROM atlas_dirty').get() as { n: number }).n, regions,
      nebulae: this.nebulaStore.groups(new Set(markers.map(marker => marker.id))) }
  }

  private region(r: RegionRow, count = r.member_count): AtlasRegion { return { id: r.id, parentId: r.parent_id, galaxyId: r.galaxy_id, label: r.label, kind: r.kind, x: r.x, y: r.y, radius: r.radius, color: r.color, count } }

  file(id: string): AtlasFile | null {
    const f = this.index.get(id), p = this.position(id)
    if (!f || !p) return null
    const { embedding, contentHash: _hash, z: _z, embeddingStrategy: _strategy, ...rest } = f
    return { ...rest, isFavorite: f.isFavorite ?? false, favoriteAppearance: f.favoriteAppearance ?? 'pulsar', x: p.x, y: p.y, tags: f.tags ?? [], isPinned: p.pinned === 1, regionId: p.region_id,
      neighborhoodId: p.neighborhood_id, hasEmbedding: embedding !== null, extractionStatus: (this.index.db.prepare('SELECT status FROM atlas_documents WHERE id=?').get(id) as { status: string } | undefined)?.status ?? 'pending' }
  }

  list(scope: AtlasScope = {}, offset = 0, limit = 100): { files: AtlasFile[]; total: number; revision: number } {
    const filter = this.scope(scope)
    const base = `FROM files f JOIN atlas_positions p ON p.id=f.id WHERE 1${filter.sql}`
    const total = (this.index.db.prepare(`SELECT count(*) n ${base}`).get(...filter.args) as { n: number }).n
    const ids = this.index.db.prepare(`SELECT f.id ${base} ORDER BY f.name COLLATE NOCASE,f.id LIMIT ? OFFSET ?`).all(...filter.args, limit, offset) as { id: string }[]
    return { files: ids.map(({ id }) => this.file(id)!).filter(Boolean), total, revision: this.revision }
  }

  viewport(scope: AtlasScope, bounds: { minX: number; minY: number; maxX: number; maxY: number }, limit = 500): AtlasFile[] {
    const filter = this.scope(scope)
    const ids = this.index.db.prepare(`SELECT p.id FROM atlas_positions p JOIN files f ON f.id=p.id
      WHERE p.x BETWEEN ? AND ? AND p.y BETWEEN ? AND ?${filter.sql} ORDER BY p.id LIMIT ?`)
      .all(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, ...filter.args, limit) as { id: string }[]
    if (ids.length && !this.folderGraph) {
      const points = this.index.db.prepare('SELECT f.id,f.path,p.x,p.y FROM files f JOIN atlas_positions p ON p.id=f.id').all() as FolderPoint[]
      this.folderGraph = { paths: new Map(points.map(point => [point.id, point.path])), links: folderConstellations(points) }
    }
    return ids.map(({ id }) => {
      const file = this.file(id)
      return file ? { ...file, folderLinks: this.folderGraph?.links.get(id) ?? [] } : null
    }).filter((file): file is AtlasFile & { folderLinks: NonNullable<AtlasFile['folderLinks']> } => file !== null)
  }

  lexical(query: string, scope: AtlasScope, limit: number): AtlasHit[] {
    const filter = this.scope(scope), normalized = query.trim().replace(/^"|"$/g, '')
    if (!normalized) return []
    const needle = '*' + normalized.toLowerCase().replace(/[?*[]/g, char => '[' + char + ']') + '*'
    const direct = this.index.db.prepare(`SELECT f.id FROM (
      SELECT rowid FROM atlas_names WHERE name GLOB ?
      UNION SELECT rowid FROM atlas_names WHERE path GLOB ?
      UNION SELECT f.rowid FROM galaxies g JOIN files f ON f.galaxy_id=g.id WHERE lower(g.name) GLOB ?
      UNION SELECT f.rowid FROM atlas_regions r JOIN atlas_positions p ON p.region_id=r.id JOIN files f ON f.id=p.id WHERE lower(r.label) GLOB ?
      UNION SELECT f.rowid FROM atlas_regions r JOIN atlas_positions p ON p.neighborhood_id=r.id JOIN files f ON f.id=p.id WHERE lower(r.label) GLOB ?
    ) candidates JOIN files f ON f.rowid=candidates.rowid JOIN atlas_positions p ON p.id=f.id WHERE 1${filter.sql}
      ORDER BY (lower(f.name)=lower(?)) DESC,(lower(f.name) GLOB ?) DESC,(lower(f.path) GLOB ?) DESC,length(f.path),f.name COLLATE NOCASE,f.id LIMIT ?`)
      .all(needle, needle, needle, needle, needle, ...filter.args, normalized, needle, needle, limit) as { id: string }[]
    const hits = new Map<string, AtlasHit>()
    for (const { id } of direct) {
      const file = this.file(id)!
      const nameHit = file.name.toLowerCase().includes(normalized.toLowerCase()), pathHit = file.path.toLowerCase().includes(normalized.toLowerCase())
      hits.set(id, { file, score: file.name.toLowerCase() === normalized.toLowerCase() ? 100 : nameHit ? 90 : pathHit ? 70 : 60, reason: nameHit ? 'name' : 'path', snippet: nameHit || pathHit ? file.path : `Atlas label match for “${normalized}” · ${file.path}`, offset: 0 })
    }
    const match = ftsQuery(query)
    if (match) {
      // Scope is applied before candidates are ranked. Each file contributes
      // its best passage, so long documents cannot consume the result budget.
      const rows = this.index.db.prepare(`SELECT file_id, snippet(atlas_fts,4,'','', ' … ',32) excerpt, offset,
        highlight(atlas_fts,1,char(1),char(2)) name_match, highlight(atlas_fts,2,char(1),char(2)) path_match,
        highlight(atlas_fts,3,char(1),char(2)) tags_match, rank FROM atlas_fts
        JOIN files f ON f.id=atlas_fts.file_id JOIN atlas_positions p ON p.id=f.id
        WHERE atlas_fts MATCH ?${filter.sql} AND rank MATCH 'bm25(0,10,3,6,1,0)'
        ORDER BY rank`).iterate(match, ...filter.args)
      for (const item of rows) {
        if (hits.size >= limit) break
        const row = item as { file_id: string; excerpt: string; offset: number; name_match: string; path_match: string; tags_match: string; rank: number }
        if (hits.has(row.file_id)) continue
        const reason = row.name_match.includes('\x01') ? 'name' : row.tags_match.includes('\x01') ? 'tags' : row.path_match.includes('\x01') ? 'path' : 'content'
        const file = this.file(row.file_id)!
        hits.set(row.file_id, { file, score: (reason === 'name' ? 85 : 50) - row.rank, reason, snippet: row.excerpt || this.document(row.file_id)?.text.slice(0, 220) || file.path, offset: Number(row.offset) })
      }
    }
    return [...hits.values()].sort((a, b) => b.score - a.score || (a.reason === 'path' && b.reason === 'path' ? a.file.path.length - b.file.path.length : 0) || a.file.name.localeCompare(b.file.name)).slice(0, limit)
  }

  vectorBatch(scope: AtlasScope, after: string, limit = 256): { id: string; embedding: Float32Array }[] {
    const filter = this.scope(scope)
    const rows = this.index.db.prepare(`SELECT f.id,f.embedding FROM files f JOIN atlas_positions p ON p.id=f.id WHERE f.embedding IS NOT NULL AND f.id > ?${filter.sql} ORDER BY f.id LIMIT ?`).all(after, ...filter.args, limit) as { id: string; embedding: Buffer }[]
    return rows.map(r => ({ id: r.id, embedding: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4) }))
  }

  favorite(id: string, isFavorite: boolean, appearance?: FavoriteAppearance): boolean {
    if (!this.position(id) || !this.index.get(id)) return false
    this.index.setFavorite(id, isFavorite, appearance)
    return true
  }

  pin(id: string, x: number | null, y: number | null): boolean {
    if (!this.position(id)) return false
    this.folderGraph = null
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
    this.folderGraph = null
    const data = JSON.parse(snapshot.payload) as { positions: PositionRow[]; regions: RegionRow[] }
    this.index.db.transaction(() => {
      for (const r of data.regions) this.index.db.prepare('UPDATE atlas_regions SET label=?,x=?,y=?,radius=? WHERE id=?').run(r.label, r.x, r.y, r.radius, r.id)
      for (const p of data.positions) this.index.db.prepare('UPDATE atlas_positions SET x=?,y=?,natural_x=?,natural_y=?,pinned=? WHERE id=?').run(p.x, p.y, p.natural_x, p.natural_y, p.pinned, p.id)
      this.index.db.exec('UPDATE atlas_state SET layout_epoch=layout_epoch+1')
      this.bump()
    })()
    return true
  }
}
