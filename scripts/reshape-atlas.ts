import { realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { FileIndex } from '../src/daemon/db/FileIndex'
import { AtlasStore } from '../src/daemon/atlas/AtlasStore'

// Development review helper: never reshape the primary library implicitly.
const dbPath = realpathSync(resolve(process.argv[2] ?? ''))
const reviewRoot = realpathSync(process.cwd())
if (!['.atlas-dev', '.atlas-real'].some(dir => dbPath.startsWith(resolve(reviewRoot, dir) + sep))) {
  throw new Error('Pass an isolated database inside .atlas-dev or .atlas-real. Stop its daemon first.')
}
async function main(): Promise<void> {
  const db = new FileIndex({ dbPath })
  try {
    const backup = dbPath + '.before-organic-' + Date.now()
    await db.db.backup(backup)
    const snapshot = new AtlasStore(db).reshapeOrganic()
    console.log(JSON.stringify({ backup, snapshot, files: db.count() }))
  } finally { db.close() }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
