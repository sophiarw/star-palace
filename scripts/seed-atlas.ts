import { mkdirSync, statSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { createHash } from 'crypto'
import { FileIndex, type IndexedFile } from '../src/daemon/db/FileIndex'
import { AtlasStore } from '../src/daemon/atlas/AtlasStore'
import { categoryFromPath, mimeFromPath } from '../src/daemon/index/extractors/category'

const root = resolve('.atlas-dev'), library = join(root, 'library')
mkdirSync(library, { recursive: true })
const db = new FileIndex({ dbPath: join(root, 'index.db') }), atlas = new AtlasStore(db)
const galaxy = db.getOrCreateGalaxy(library, 'Personal library')
const topics = [
  { region: 'Research', names: ['How places become memories', 'Notes on attention', 'Reading list perception'], tags: ['cognition', 'spatial memory'], intro: 'We remember more than a name. We remember the place where we found it.' },
  { region: 'Projects', names: ['An atlas for everyday work', 'Interface study', 'Prototype observations'], tags: ['design', 'atlas'], intro: 'A space for finding things, following connections, and getting back to work.' },
  { region: 'Writing', names: ['The shape of a thought', 'Field journal', 'Essay fragments'], tags: ['writing', 'ideas'], intro: 'A thought begins as a fragment. Its place beside another fragment can reveal a relationship.' },
  { region: 'Reference', names: ['A small guide to typography', 'Color and contrast', 'Keyboard patterns'], tags: ['reference', 'design'], intro: 'Useful notes to return to as a project takes shape.' },
]
function add(path: string, text: string, tags: string[] = []): void {
  mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, text)
  const info = statSync(path), id = createHash('sha1').update(`${galaxy.id}\0${path}`).digest('hex').slice(0, 16)
  const file: IndexedFile = { id, name: path.split('/').pop()!, path, platform: 'local', category: categoryFromPath(path), mimeType: mimeFromPath(path), size: info.size, createdAt: info.birthtimeMs, modifiedAt: info.mtimeMs,
    embedding: null, contentHash: null, x: null, y: null, z: null, clusterId: null, galaxyId: galaxy.id, layoutVersion: 0,
    firstSeen: Date.now(), viewCount: 0, isPinned: false, starType: null, pinAlpha: null, pinBeta: null, pinAxisA: null, pinAxisB: null, pinnedAt: null,
    osUseCount: null, osLastUsed: null, importanceScore: null, tags, embeddingStrategy: null }
  db.upsert(file)
}
for (const topic of topics) for (let i = 0; i < 30; i++) {
  const title = topic.names[i % topic.names.length] + (i > 2 ? ` ${i - 1}` : '')
  const text = `# ${title}\n\n${topic.intro}\n\n## Landmarks before detail\n\nA familiar landscape gives information a second identity. A note can be the one beside the research papers, just below the collection of sketches. Those relationships become useful when the landscape remains stable.\n\n> A good map lets you return without having to search again.\n\n## The next useful step\n\nThe first view reveals a few distinctive places. As we move closer, their contents become visible. Recognition grows from a useful hierarchy of places and things.\n\n## Working notes\n\n- Preserve the reader’s place.\n- Let the surrounding material remain available.\n- Give the current task a clear foreground.\n`
  add(join(library, topic.region, title.replace(/ /g, '-').toLowerCase() + '.md'), text, topic.tags)
}
add(join(library, 'Reference', 'analysis.v2_final.md'), '# Long document\n\n' + 'Background observations and unrelated examples.\n'.repeat(800) + '\n## A late discovery\n\nThe copper lantern is the distinctive landmark at the end of this document.\n', ['long-document'])
add(join(library, 'Projects', 'inventory.csv'), 'Product,Quantity,Notes\n' + Array.from({ length: 1500 }, (_, i) => `Item ${i + 1},${i % 37},"A sample, with punctuation"`).join('\n'))
add(join(library, 'Projects', 'camera.ts'), '// Preserve the point under the pointer while zooming.\nexport function zoomAt(camera: { x: number; y: number; zoom: number }, factor: number) {\n  return { ...camera, zoom: Math.max(0.01, camera.zoom * factor) }\n}\n')
add(join(library, 'Reference', 'orbital-study.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect width="900" height="700" fill="#101925"/><g fill="none" stroke="#b5c4b1" stroke-width="2"><ellipse cx="450" cy="350" rx="280" ry="140"/><ellipse cx="450" cy="350" rx="180" ry="270" transform="rotate(35 450 350)"/></g><circle cx="450" cy="350" r="32" fill="#e4c897"/><circle cx="680" cy="270" r="11" fill="#a4baca"/></svg>')
while (atlas.syncBatch()) { /* complete fixture placement before serving */ }
console.log(`Atlas fixture: ${db.count()} files in ${root}`)
db.close()
