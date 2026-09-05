import { TerminalEditorError } from '../../src/daemon/util/openInTerminalEditor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import express from 'express'
import request from 'supertest'
import { FileIndex } from '../../src/daemon/db/FileIndex'
import { AtlasStore } from '../../src/daemon/atlas/AtlasStore'
import { AtlasService } from '../../src/daemon/atlas/service'
import { atlasRoutes } from '../../src/daemon/atlas/routes'
import { TextExtractor } from '../../src/daemon/index/extractors/text'
import { EmbeddingEngine } from '../../src/daemon/embedding/EmbeddingEngine'
import type { OllamaClient } from '../../src/daemon/embedding/OllamaClient'

let db: FileIndex, store: AtlasStore, service: AtlasService, dir: string
const vector = new Float32Array(768); vector[0] = 1
const embed = vi.fn(async () => vector)
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-test-'))
  db = new FileIndex({ dbPath: ':memory:' }); store = new AtlasStore(db)
  service = new AtlasService(store, new EmbeddingEngine({ embed } as unknown as OllamaClient))
  embed.mockClear()
})
afterEach(() => { service.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) })
function add(id: string, embedding: Float32Array | null = null): void {
  const path = join(dir, `${id}.md`); writeFileSync(path, `# ${id}\nThe copper lantern is here.`)
  db.db.prepare(`INSERT INTO files(id,name,path,platform,category,mime_type,size,created_at,modified_at,first_seen,embedding)
    VALUES(?,?,?,'local','document','text/markdown',50,1,2,1,?)`).run(id, `${id}.md`, path, embedding ? Buffer.from(embedding.buffer) : null)
  store.syncBatch()
}
const app = () => express().use(express.json()).use('/atlas', atlasRoutes(service))

describe('Atlas HTTP and asynchronous retrieval', () => {
  it('edits only the indexed file resolved from its id and returns launcher errors', async () => {
    add('paper')
    const edit = vi.fn(async (_file: import('../../src/shared/atlas').AtlasFile) => ({ editor: 'nvim' as const }))
    const server = express().use(express.json()).use('/atlas', atlasRoutes(service, edit))
    expect((await request(server).post('/atlas/file/missing/edit').send({ path: '/etc/passwd' })).status).toBe(404)
    expect(edit).not.toHaveBeenCalled()
    const response = await request(server).post('/atlas/file/paper/edit').send({ path: '/etc/passwd', command: 'unexpected' })
    expect(response.body).toEqual({ editor: 'nvim' })
    expect(edit.mock.calls[0]?.[0]).toMatchObject({ id: 'paper', path: join(dir, 'paper.md') })
    edit.mockRejectedValueOnce(new TerminalEditorError('No editor installed', 503))
    expect((await request(server).post('/atlas/file/paper/edit').send({})).body).toEqual({ error: 'No editor installed' })
  })

  it('validates section editor coordinates before invoking the launcher', async () => {
    add('paper')
    const edit = vi.fn(async (_file: import('../../src/shared/atlas').AtlasFile, _section?: import('../../src/shared/section').EditorSection) => ({ editor: 'vim' as const }))
    const server = express().use(express.json()).use('/atlas', atlasRoutes(service, edit))
    for (const body of [{ line: '+!bad', sourceLine: '# paper' }, { line: 0, sourceLine: '# paper' }, { line: 1 }, { line: 1, sourceLine: 'a\nb' }]) expect((await request(server).post('/atlas/file/paper/edit').send(body)).status).toBe(400)
    expect(edit).not.toHaveBeenCalled()
    expect((await request(server).post('/atlas/file/paper/edit').set('Origin', 'https://example.com').send({ line: 1, sourceLine: '# paper', contentHash: 'a'.repeat(64) })).status).toBe(403)
    expect((await request(server).post('/atlas/file/paper/edit').send({ line: 1, sourceLine: '# paper', contentHash: 'a'.repeat(64) })).status).toBe(200)
    expect(edit.mock.calls[0]?.[1]).toEqual({ line: 1, sourceLine: '# paper', contentHash: 'a'.repeat(64) })
  })

  it('refreshes edited Markdown text and metadata without embedding or changing its place and favorite', async () => {
    add('paper'); store.pin('paper', 12, 34); store.favorite('paper', true, 'pulsar')
    await service.text('paper')
    const previous = store.file('paper')!
    writeFileSync(previous.path, '# Renamed heading\nA newly saved passage.')
    const response = await request(app()).post('/atlas/file/paper/refresh-text').send({})
    expect(response.status).toBe(200)
    expect(response.body.file).toMatchObject({ x: previous.x, y: previous.y, isPinned: true, isFavorite: true, favoriteAppearance: 'pulsar' })
    expect(store.document('paper')?.text).toContain('newly saved passage')
    expect(store.lexical('newly saved passage', {}, 20)).toHaveLength(1)
    expect(embed).not.toHaveBeenCalled()
    expect((await request(app()).post('/atlas/file/paper/refresh-text').set('Origin', 'https://example.com').send({})).status).toBe(403)
  })

  it('validates favorite mutations and returns consistent typed marker metadata', async () => {
    add('paper')
    const original = store.file('paper')!, before = store.revision
    for (const body of [{}, { isFavorite: 'true' }, { isFavorite: 1 }, { isFavorite: true, favoriteAppearance: 'nebula' }, { isFavorite: true, favoriteAppearance: null }, { isFavorite: true, favoriteAppearance: {} }]) {
      expect((await request(app()).post('/atlas/file/paper/favorite').send(body)).status).toBe(400)
    }
    expect(store.revision).toBe(before)
    expect((await request(app()).post('/atlas/file/missing/favorite').send({ isFavorite: true })).status).toBe(404)
    const result = await request(app()).post('/atlas/file/paper/favorite').send({ isFavorite: true, favoriteAppearance: 'black-hole' })
    expect(result.status).toBe(200)
    expect(result.body.file).toMatchObject({ isFavorite: true, favoriteAppearance: 'black-hole', x: original.x, y: original.y, isPinned: false, starType: null })
    const summary = await request(app()).get('/atlas/summary')
    expect(summary.body.markers[0]).toMatchObject({ isFavorite: true, favoriteAppearance: 'black-hole', size: original.size })
    const removed = await request(app()).post('/atlas/file/paper/favorite').send({ isFavorite: false })
    expect(removed.body.file).toMatchObject({ isFavorite: false, favoriteAppearance: 'black-hole' })
  })

  it('serves names and on-demand extracted text without a model', async () => {
    add('paper')
    const found = await request(app()).post('/atlas/search').send({ query: 'paper', mode: 'exact' })
    expect(found.status).toBe(200); expect(found.body.results[0].file.id).toBe('paper'); expect(embed).not.toHaveBeenCalled()
    const text = await request(app()).get('/atlas/file/paper/text')
    expect(text.status).toBe(200); expect(text.body.content).toContain('copper lantern')
  })
  it('rejects invalid scopes and coordinates instead of silently broadening', async () => {
    add('paper')
    for (const body of [{ query: 'paper', galaxyIds: [true] }, { query: 'paper', limit: -1 }, { query: 'paper', category: 'invalid' }]) {
      expect((await request(app()).post('/atlas/search').send(body)).status).toBe(400)
    }
    expect((await request(app()).post('/atlas/file/paper/pin').send({ x: '5', y: 1 })).status).toBe(400)
    expect((await request(app()).post('/atlas/search').send({ query: 'paper', collectionId: 999 })).status).toBe(404)
    expect((await request(app()).post('/atlas/search').send({ query: 'paper', galaxyIds: [] })).body.results).toEqual([])
  })
  it('retrieves actual viewport files with filters and includes pins outside their original region', async () => {
    add('paper'); add('other'); store.pin('paper', 30000, -40000)
    const query = { minX: '29900', maxX: '30100', minY: '-40100', maxY: '-39900' }
    const response = await request(app()).get('/atlas/viewport').query(query)
    expect(response.status).toBe(200)
    expect(response.body.files.map((f: { id: string }) => f.id)).toEqual(['paper'])
    expect((await request(app()).get('/atlas/viewport').query({ ...query, category: 'media' })).body.files).toEqual([])
    for (const invalid of [{}, { ...query, minX: 'NaN' }, { ...query, maxX: 'Infinity' }, { ...query, minY: '0' }]) {
      expect((await request(app()).get('/atlas/viewport').query(invalid)).status).toBe(400)
    }
  })
  it('preserves a backup before restoring a snapshot through HTTP', async () => {
    add('paper'); const original = store.file('paper')!
    const snapshot = await request(app()).post('/atlas/snapshots').send({ name: 'Before' })
    await request(app()).post('/atlas/file/paper/pin').send({ x: 30000, y: 40000 })
    expect((await request(app()).post(`/atlas/snapshots/${snapshot.body.id}/restore`)).status).toBe(200)
    expect(store.file('paper')?.x).toBe(original.x); expect(store.snapshots()).toHaveLength(2)
  })
  it('filters vectors before selection, caches query embeddings and honors cancellation', async () => {
    add('one', vector); add('two', vector); db.setTags('two', ['chosen']); store.syncBatch()
    expect((await service.related('meaning', { tag: 'chosen' }, 1)).map(h => h.file.id)).toEqual(['two'])
    expect(await service.related('meaning', {}, 10, () => true)).toEqual([])
    expect(embed).toHaveBeenCalledTimes(1)
  })
  it('reports semantic unavailability while lexical search remains usable', async () => {
    add('paper'); embed.mockRejectedValueOnce(new Error('offline'))
    const response = await request(app()).post('/atlas/search').send({ query: 'paper', mode: 'related' })
    expect(response.body.semanticAvailable).toBe(false)
    expect(store.lexical('paper', {}, 10)).toHaveLength(1)
  })
})

it('extracts bounded text, rejects binary data, and survives unreadable files', async () => {
  const extractor = new TextExtractor()
  try {
    const text = join(dir, 'long.txt'), binary = join(dir, 'binary.txt')
    writeFileSync(text, 'a'.repeat(2 * 1024 * 1024 + 10)); writeFileSync(binary, Buffer.from([1, 0, 2, 3]))
    const first = extractor.extract(text), duplicate = extractor.extract(text)
    expect(first).toBe(duplicate)
    const newer = extractor.extract(text, 'new-revision')
    expect(newer).not.toBe(first)
    await newer
    const result = await first
    expect(result.status).toBe('truncated'); expect(result.text.length).toBe(2 * 1024 * 1024)
    expect((await extractor.extract(binary)).text).toBe('')
    expect((await extractor.extract(join(dir, 'missing.pdf'))).status).toBe('unavailable')
    writeFileSync(join(dir, 'fine.md'), 'A readable note')
    expect((await extractor.extract(join(dir, 'fine.md'))).text).toBe('A readable note')
  } finally { extractor.close() }
})
