import { mkdirSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { cpus, totalmem, platform, release } from 'os'
import { monitorEventLoopDelay } from 'perf_hooks'
import { FileIndex, type IndexedFile } from '../src/daemon/db/FileIndex'
import { AtlasStore } from '../src/daemon/atlas/AtlasStore'
import { AtlasService } from '../src/daemon/atlas/service'
import { EmbeddingEngine } from '../src/daemon/embedding/EmbeddingEngine'
import type { OllamaClient } from '../src/daemon/embedding/OllamaClient'

const dir = resolve('.atlas-benchmark', `run-${Date.now()}`)
mkdirSync(dir, { recursive: true })
const db = new FileIndex({ dbPath: join(dir, 'index.db') }), atlas = new AtlasStore(db)
const galaxy = db.getOrCreateGalaxy('/synthetic-library', 'Scale fixture')
const percentile = (values: number[], p: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]
const report: Record<string, unknown> = { timestamp: new Date().toISOString(), node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0].model, ramGiB: totalmem() / 2 ** 30, dimension: 768, measurements: [] }
const vector = new Float32Array(768); vector[0] = 1
const engine = new EmbeddingEngine({ embed: async () => Array.from(vector) } as unknown as OllamaClient)
const service = new AtlasService(atlas, engine)
const body = 'A working note about navigation, attention, and the shape of a useful library. '.repeat(12)
let previous = 0
async function main(): Promise<void> {
  for (const count of [10_000, 50_000, 100_000]) {
    const start = performance.now(), delays = monitorEventLoopDelay({ resolution: 10 }); delays.enable()
    const slices: number[] = []
    for (let offset = previous; offset < count; offset += 64) {
      const slice = performance.now()
      db.db.transaction(() => {
        for (let i = offset; i < Math.min(count, offset + 64); i++) {
          const id = String(i).padStart(8, '0'), folder = ['Research', 'Projects', 'Writing', 'Reference'][i % 4]
          const file: IndexedFile = { id, name: `note-${id}.md`, path: `/synthetic-library/${folder}/note-${id}.md`, platform: 'local', mimeType: 'text/markdown', category: 'document', size: body.length, createdAt: 1, modifiedAt: 2,
            embedding: vector, contentHash: id, x: null, y: null, z: null, clusterId: null, galaxyId: galaxy.id, layoutVersion: 0, firstSeen: 1, viewCount: 0, isPinned: false, starType: null,
            pinAlpha: null, pinBeta: null, pinAxisA: null, pinAxisB: null, pinnedAt: null, osUseCount: null, osLastUsed: null, importanceScore: null, tags: ['working-notes'], embeddingStrategy: 'content-only' }
          db.upsert(file)
        }
      })()
      atlas.syncBatch(64)
      db.db.transaction(() => {
        for (let i = offset; i < Math.min(count, offset + 64); i++) atlas.setText(String(i).padStart(8, '0'), body + (i % 997 === 0 ? ' A distinctive copper lantern.' : ''), 'ready', `2:${body.length}`)
      })()
      slices.push(performance.now() - slice)
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    const buildMs = performance.now() - start
    delays.disable()
    const summaryStart = performance.now(), summary = atlas.summary(), summaryMs = performance.now() - summaryStart
    const search: Record<string, { p50: number; p95: number; hits: number }> = {}
    for (const query of [`note-${String(count - 1).padStart(8, '0')}.md`, '"copper lantern"', 'navigation', 'absentwatermelon']) {
      const times: number[] = []; let hits = 0
      for (let n = 0; n < 25; n++) { const t = performance.now(); hits = atlas.lexical(query, {}, 50).length; times.push(performance.now() - t) }
      search[query] = { p50: percentile(times, .5), p95: percentile(times, .95), hits }
    }
    const semanticStart = performance.now(); const related = await service.related('fixture meaning', {}, 50); const semanticMs = performance.now() - semanticStart
    const neighborhood = summary.regions.find(r => r.kind === 'neighborhood')!
    const files = atlas.list({ neighborhoodId: neighborhood.id })
    writeFileSync(join(dir, `scene-${count}.json`), JSON.stringify({ summary, files }))
    const result = { count, added: count - previous, buildMs, sliceP95: percentile(slices, .95), eventLoopP99: delays.percentile(99) / 1e6, summaryMs, summaryBytes: Buffer.byteLength(JSON.stringify(summary)), regions: summary.regions.filter(r => r.kind === 'region').length, neighborhoods: summary.regions.filter(r => r.kind === 'neighborhood').length, search, semanticMs, semanticHits: related.length, rssMiB: process.memoryUsage().rss / 2 ** 20 }
    ;(report.measurements as unknown[]).push(result)
    console.log(JSON.stringify(result))
    writeFileSync(join(dir, 'backend.json'), JSON.stringify(report, null, 2))
    previous = count
  }
  console.log(`Report: ${dir}`)
  service.stop(); db.close()
}
void main().catch(error => { console.error(error); service.stop(); db.close(); process.exitCode = 1 })
