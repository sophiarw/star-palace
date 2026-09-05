import { FileIndex } from '../src/daemon/db/FileIndex'
import { AtlasStore } from '../src/daemon/atlas/AtlasStore'
import { createHash } from 'crypto'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

// Audit only the explicitly isolated backup, never the primary database.
const db = new FileIndex({ dbPath: resolve('.atlas-real/index.db') })
const hash = (sql: string): string => createHash('sha256').update(JSON.stringify(db.db.prepare(sql).all())).digest('hex')
const baseline = { files: hash('SELECT * FROM files ORDER BY id'), collections: hash('SELECT * FROM collections ORDER BY id'), members: hash('SELECT * FROM collection_members ORDER BY collection_id,file_id') }
const start = performance.now(), atlas = new AtlasStore(db)
const slices: number[] = []
async function main(): Promise<void> {
  for (;;) { const t = performance.now(); const changed = atlas.syncBatch(32); slices.push(performance.now() - t); if (!changed) break; await new Promise<void>(resolve => setImmediate(resolve)) }
  const summary = atlas.summary()
  writeFileSync('.atlas-real/scene.json', JSON.stringify({ summary, files: atlas.list({ neighborhoodId: summary.regions.find(r => r.kind === 'neighborhood')!.id }) }))
  const report = { total: summary.total, positioned: summary.positioned, regions: summary.regions.filter(r => r.kind === 'region').length, neighborhoods: summary.regions.filter(r => r.kind === 'neighborhood').length,
    largestNeighborhood: Math.max(...summary.regions.filter(r => r.kind === 'neighborhood').map(r => r.count)), migrationMs: performance.now() - start, maxSliceMs: Math.max(...slices),
    coordinateDuplicates: db.db.prepare('SELECT count(*) n FROM (SELECT x,y FROM atlas_positions GROUP BY x,y HAVING count(*) > 1)').get(),
    withoutEmbedding: db.db.prepare('SELECT count(*) n FROM files WHERE embedding IS NULL').get(),
    userDataUnchanged: baseline.files === hash('SELECT * FROM files ORDER BY id') && baseline.collections === hash('SELECT * FROM collections ORDER BY id') && baseline.members === hash('SELECT * FROM collection_members ORDER BY collection_id,file_id') }
  writeFileSync('.atlas-real/audit.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); db.close()
}
void main()
