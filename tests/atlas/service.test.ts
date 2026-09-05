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
