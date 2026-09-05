import { FileIndex } from '../src/daemon/db/FileIndex'
import { AtlasStore } from '../src/daemon/atlas/AtlasStore'
import { AtlasService } from '../src/daemon/atlas/service'
import { EmbeddingEngine } from '../src/daemon/embedding/EmbeddingEngine'
import { OllamaClient } from '../src/daemon/embedding/OllamaClient'
import { readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const root = join('.atlas-benchmark', readdirSync('.atlas-benchmark').filter(p => p.startsWith('run-')).sort().at(-1)!)
const db = new FileIndex({ dbPath: join(root, 'index.db') }), store = new AtlasStore(db)
class FixtureClient extends OllamaClient { async embed(): Promise<Float32Array> { const v = new Float32Array(768); v[0] = 1; return v } }
const service = new AtlasService(store, new EmbeddingEngine(new FixtureClient()))
async function main(): Promise<void> {
  const samples: number[] = []
  for (let i = 0; i < 12; i++) { const start = performance.now(); await service.related('fixture', {}, 50); samples.push(performance.now() - start) }
  const warm = samples.slice(1).sort((a, b) => a - b)
  const report = { count: db.count(), modelTimeIncluded: false, firstMs: samples[0], warmP50: warm[Math.floor(warm.length * .5)], warmP95: warm[Math.floor(warm.length * .95)], samples }
  console.log(JSON.stringify(report)); writeFileSync(join(root, 'semantic-warm.json'), JSON.stringify(report, null, 2)); service.stop(); db.close()
}
void main()
