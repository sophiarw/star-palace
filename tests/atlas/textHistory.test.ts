import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, utimes, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import request from 'supertest'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import { AtlasStore } from '../../src/daemon/atlas/AtlasStore'
import { TextHistory, decodeHistoryText, historyEligibility } from '../../src/daemon/history/TextHistory'
import { textHistoryRoutes } from '../../src/daemon/history/routes'

let directory: string, db: FileIndex, store: AtlasStore, history: TextHistory, galaxy: number
async function save(path: string, text: string | Buffer) { await writeFile(path, text); const past = new Date(Date.now() - 10000); await utimes(path, past, past) }
async function add(id: string, name = id + '.md', text = '# First draft\n') {
  const path = join(directory, name); await save(path, text)
  db.db.prepare("INSERT INTO files(id,name,path,platform,category,mime_type,size,created_at,modified_at,first_seen,galaxy_id) VALUES(?,?,?,'local','document','text/plain',?,1,2,1,?)").run(id, name, path, Buffer.byteLength(text), galaxy)
  store.syncBatch(); return path
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'starpalace-history-'))
  db = new FileIndex({ dbPath: join(directory, 'index.db') }); store = new AtlasStore(db)
  galaxy = db.getOrCreateGalaxy(directory, 'Writing').id
  history = new TextHistory(store, join(directory, 'archive.git'))
})
afterEach(async () => { history.stop(); db.close(); await rm(directory, { recursive: true, force: true }) })
describe('Private text history', () => {
  it('captures versions, updates lexical search, and recovers exact bytes without overwriting originals', async () => {
    const original = '\ufeff# First draft\r\n', path = await add('draft', 'draft $(`literal`).md', original)
    await history.enable(galaxy, true)
    const position = store.position('draft')
    expect(await history.capture('draft')).toBe(true)
    const first = (await history.versions('draft')).versions[0]
    await save(path, '# Revised\nOrion constellation\n')
    expect(await history.capture('draft')).toBe(true)
    const versions = (await history.versions('draft')).versions
    expect(versions).toHaveLength(2)
    expect((await history.version('draft', versions[0].id)).diff).toContain('+Orion constellation')
    const copy = await history.restoreCopy('draft', first.id)
    expect(await readFile(copy, 'utf8')).toBe(original)
    expect(await readFile(path, 'utf8')).toContain('Revised')
    expect(store.lexical('Orion', {}, 10).map(h => h.file.id)).toContain('draft')
    expect(store.position('draft')).toEqual(position)
  })
  it('deduplicates unchanged saves and concurrent capture, survives restart and respects pause', async () => {
    const path = await add('draft'); await history.enable(galaxy, true)
    await Promise.all([history.capture('draft'), history.capture('draft')])
    expect((await history.versions('draft')).versions).toHaveLength(1)
    await history.enable(galaxy, false); await save(path, 'While paused\n')
    expect(await history.capture('draft')).toBe(false)
    const restarted = new TextHistory(store, history.directory)
    await restarted.enable(galaxy, true); await restarted.capture('draft')
    expect((await restarted.versions('draft')).versions).toHaveLength(2)
    expect(await restarted.capture('draft')).toBe(false)
  })
  it('detects atomic editor replacement and keeps authored metadata', async () => {
    const path = await add('code', 'script.py', 'print(1)\n'); await history.enable(galaxy, true)
    store.favorite('code', true, 'black-hole'); db.setTags('code', ['keep'])
    await history.capture('code'); await save(path + '.tmp', 'print(2)\n'); await rename(path + '.tmp', path)
    await history.capture('code')
    expect((await history.versions('code')).versions).toHaveLength(2)
    expect(store.file('code')).toMatchObject({ isFavorite: true, favoriteAppearance: 'black-hole', tags: ['keep'] })
  })
  it('rejects binaries, oversized text, symlinks and versions belonging to another file', async () => {
    expect(historyEligibility('image.jpg', 1)).not.toBeNull()
    expect(historyEligibility('large.py', 2 * 1024 * 1024)).not.toBeNull()
    expect(() => decodeHistoryText(Buffer.from([255]))).toThrow()
    expect(() => decodeHistoryText(Buffer.from([0]))).toThrow()
    const path = await add('binary', 'binary.py', 'placeholder'); await save(path, Buffer.from([0, 1, 2])); await history.enable(galaxy, true)
    expect(await history.capture('binary')).toBe(false)
    const target = await add('target'); const link = await add('link'); await rm(link); await symlink(target, link)
    await expect(history.capture('link')).rejects.toThrow()
    await history.capture('target'); const hash = (await history.versions('target')).versions[0].id
    await expect(history.version('binary', hash)).rejects.toThrow()
    await expect(history.version('target', '--help')).rejects.toThrow()
  })
  it('refuses capture over its storage budget and leaves existing content intact', async () => {
    const path = await add('draft'); const limited = new TextHistory(store, history.directory, 0)
    await limited.enable(galaxy, true)
    await expect(limited.capture('draft')).rejects.toThrow('budget')
    expect((await limited.versions('draft')).versions).toHaveLength(0)
    expect(await readFile(path, 'utf8')).toContain('First draft')
  })
  it('requires a local origin and JSON for archive mutations', async () => {
    const app = express().use(express.json()).use('/history', textHistoryRoutes(history))
    expect((await request(app).post('/history/source/' + galaxy).set('Origin', 'https://unrelated.example').send({ enabled: true })).status).toBe(403)
    expect((await request(app).post('/history/source/' + galaxy).type('form').send('enabled=true')).status).toBe(415)
    expect((await request(app).post('/history/source/' + galaxy).set('Origin', 'http://127.0.0.1:5174').send({ enabled: true })).status).toBe(200)
  })
})
