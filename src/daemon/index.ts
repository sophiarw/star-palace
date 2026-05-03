import express from 'express'
import cors from 'cors'
import { homedir } from 'os'
import { join, basename } from 'path'
import { mkdirSync } from 'fs'
import { readFile, stat } from 'fs/promises'
import { openInDefaultApp } from './util/openInDefaultApp'
import { FileIndex } from './db/FileIndex'
import { HnswIndex } from './ann/HnswIndex'
import { OllamaClient } from './embedding/OllamaClient'
import { EmbeddingEngine } from './embedding/EmbeddingEngine'
import { Relayouter } from './layout/Relayouter'
import { PC_COUNT } from './layout/Pca'
import { projectOnAxis } from './math/pinMath'
import { LAYOUT_THRESHOLD } from '../shared/types'
import { indexPath } from './pipeline/Insert'
import type { MapStats, ViewportResult, SearchResult, FileContent, StarType } from '../shared/types'
import { DAEMON_PORT, CONSTELLATION_PALETTE, VIEW_BYTES, isStarType } from '../shared/types'

const RAW_MIME_ALLOW = /^image\/(png|jpeg|gif|webp|svg\+xml)$/

const DATA_DIR = process.env.STARPALACE_DIR ?? join(homedir(), '.starpalace')
const DB_PATH = process.env.STARPALACE_DB ?? join(DATA_DIR, 'index.db')
const HNSW_PATH = join(DATA_DIR, 'hnsw.bin')

mkdirSync(DATA_DIR, { recursive: true })

export const db = new FileIndex({ dbPath: DB_PATH })
export const hnsw = new HnswIndex({ persistPath: HNSW_PATH })
hnsw.load()

const ollamaClient = new OllamaClient()
export const embedEngine = new EmbeddingEngine(ollamaClient)
export const relayouter = new Relayouter(db)
relayouter.loadExisting()

// F3 migration: if persisted model has fewer than PC_COUNT components, retrain
// once at startup so /api/map/projection can serve the full PC matrix.
//
// Scale migration: legacy PcaModel JSON predates per-axis scale persistence.
// projectOne returns raw PCA values without that scale, so post-train inserts
// would land at sub-unit coords (visually stacked at the world origin). One
// retrain rewrites every position with the new transform and persists scale.
const needsRetrain =
  relayouter.isReady &&
  db.countWithEmbeddings() >= LAYOUT_THRESHOLD &&
  (relayouter.componentCount < PC_COUNT || relayouter.needsScaleMigration)

if (needsRetrain) {
  const reason = relayouter.componentCount < PC_COUNT
    ? `components ${relayouter.componentCount} → ${PC_COUNT}`
    : 'missing scale params'
  console.log(`[layout] Retraining PCA (${reason})…`)
  try {
    relayouter.train()
    console.log(`[layout] Retrain complete.`)
  } catch (err) {
    console.warn(`[layout] Retrain failed: ${String(err)}`)
  }
}

export const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

// --- Health ---
// Cache Ollama availability for OLLAMA_HEALTH_TTL_MS so the renderer's 10 s
// poll doesn't fire a 3 s blocking probe every tick when Ollama is slow or
// down.
const OLLAMA_HEALTH_TTL_MS = 5_000
let cachedOllamaOk = false
let cachedOllamaAt = 0
let inflightOllamaCheck: Promise<boolean> | null = null

async function getOllamaAvailability(): Promise<boolean> {
  const now = Date.now()
  if (now - cachedOllamaAt < OLLAMA_HEALTH_TTL_MS) return cachedOllamaOk
  if (inflightOllamaCheck) return inflightOllamaCheck
  inflightOllamaCheck = ollamaClient.isAvailable()
    .then(ok => {
      cachedOllamaOk = ok
      cachedOllamaAt = Date.now()
      return ok
    })
    .finally(() => { inflightOllamaCheck = null })
  return inflightOllamaCheck
}

app.get('/api/health', async (_req, res) => {
  const ollamaOk = await getOllamaAvailability()
  res.json({
    ok: true,
    indexed: db.count(),
    indexedWithEmbedding: db.countWithEmbeddings(),
    layoutVersion: relayouter.currentVersion,
    ollamaAvailable: ollamaOk,
  })
})

// --- Index a directory ---
// F9: a request body with `galaxyName` creates / reuses that named galaxy.
// Without one we default to basename(path) so each indexed root becomes its
// own galaxy automatically.
app.post('/api/index', async (req, res) => {
  const { path: rootPath, galaxyName } = req.body as { path?: string; galaxyName?: string }
  if (!rootPath) return res.status(400).json({ error: 'path required' })
  try {
    const fallbackName = basename(rootPath) || rootPath
    const name = ((galaxyName ?? '').trim() || fallbackName).slice(0, 80)
    const galaxy = db.getOrCreateGalaxy(rootPath, name)
    const stats = await indexPath(rootPath, {
      db, hnsw, embedEngine, relayouter, galaxyId: galaxy.id,
    })
    hnsw.save()
    res.json({ ...stats, galaxyId: galaxy.id, galaxyName: galaxy.name })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- Galaxies (F9) ---
app.get('/api/galaxies', (_req, res) => {
  res.json({ galaxies: db.listGalaxies() })
})

// --- Viewport query ---
app.get('/api/map/viewport', (req, res) => {
  const x1 = parseFloat(req.query.x1 as string ?? '-Infinity')
  const y1 = parseFloat(req.query.y1 as string ?? '-Infinity')
  const x2 = parseFloat(req.query.x2 as string ?? 'Infinity')
  const y2 = parseFloat(req.query.y2 as string ?? 'Infinity')

  const stars = db.listInViewport(x1, y1, x2, y2)
  const clusters = db.getClusters()
  const result: ViewportResult = { stars, clusters }
  res.json(result)
})

// --- All stars (for initial full-sky load) ---
app.get('/api/map/all', (_req, res) => {
  const stars = db.listInViewport(-Infinity, -Infinity, Infinity, Infinity)
  const clusters = db.getClusters()
  res.json({ stars, clusters })
})

// --- Projection (F3 PC dial) ---
app.get('/api/map/projection', (_req, res) => {
  if (!relayouter.isReady) {
    return res.json({ componentCount: 0, files: [] })
  }
  const files = relayouter.getAllProjections()
  res.json({
    componentCount: relayouter.componentCount,
    files,
  })
})

// --- Stats ---
app.get('/api/map/stats', (_req, res) => {
  const meta = db.getLatestLayoutMeta()
  const stats: MapStats = {
    total: db.count(),
    indexedWithEmbedding: db.countWithEmbeddings(),
    layoutVersion: relayouter.currentVersion,
    lastRefitAt: meta?.computed_at ?? null,
    clusterCount: db.getClusters().length,
  }
  res.json(stats)
})

// --- Tag manual star type override ---
app.post('/api/file/:id/star-type', (req, res) => {
  const body = req.body as { starType?: unknown }
  let starType: StarType | null
  if (body.starType === null || body.starType === undefined) {
    starType = null
  } else if (isStarType(body.starType)) {
    starType = body.starType
  } else {
    return res.status(400).json({ error: 'invalid starType' })
  }
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  db.setStarType(req.params.id, starType)
  res.json({ ok: true, starType })
})

// --- Pin a star at PC-space coordinates (F4) ---
// Body: { x, y, axisA, axisB }
//   x, y       — TARGET coordinates in *PC space* on the chosen axis pair.
//                Renderer is the only thing that knows its current min/max
//                normalisation, so it inverts the scaling locally and posts
//                the raw PC coords.
//   axisA, axisB — PC indices (0..componentCount-1) active at pin time.
//
// Daemon stores α = x − natural_pc[axisA], β = y − natural_pc[axisB].
// PC eigenvectors are orthonormal so the offset only manifests on those two
// axes; on any other PC pair the natural projection wins (see
// applyPinOffset in pinMath.ts).
app.post('/api/file/:id/pin', (req, res) => {
  const body = req.body as { x?: unknown; y?: unknown; axisA?: unknown; axisB?: unknown }
  if (typeof body.x !== 'number' || !Number.isFinite(body.x)) {
    return res.status(400).json({ error: 'x must be a finite number' })
  }
  if (typeof body.y !== 'number' || !Number.isFinite(body.y)) {
    return res.status(400).json({ error: 'y must be a finite number' })
  }
  if (!Number.isInteger(body.axisA) || !Number.isInteger(body.axisB)) {
    return res.status(400).json({ error: 'axisA, axisB must be integers' })
  }
  if (!relayouter.isReady) {
    return res.status(409).json({ error: 'no PCA model trained yet' })
  }
  const componentCount = relayouter.componentCount
  if ((body.axisA as number) < 0 || (body.axisA as number) >= componentCount) {
    return res.status(400).json({ error: `axisA out of range [0, ${componentCount})` })
  }
  if ((body.axisB as number) < 0 || (body.axisB as number) >= componentCount) {
    return res.status(400).json({ error: `axisB out of range [0, ${componentCount})` })
  }
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })

  const model = relayouter.getModel()!
  const axisA = body.axisA as number
  const axisB = body.axisB as number

  // natural projection on the saved axes; null embedding (binary/media)
  // collapses to (0, 0) so α = target.
  let naturalA = 0
  let naturalB = 0
  if (file.embedding) {
    naturalA = projectOnAxis(file.embedding, model.components[axisA], model.mean)
    naturalB = projectOnAxis(file.embedding, model.components[axisB], model.mean)
  }
  const alpha = (body.x as number) - naturalA
  const beta = (body.y as number) - naturalB
  db.setPin(req.params.id, alpha, beta, axisA, axisB, Date.now())
  res.json({ ok: true, alpha, beta, axisA, axisB })
})

// --- Unpin a star (F4) — clears all 5 pin columns + is_pinned ---
app.post('/api/file/:id/unpin', (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  db.clearPin(req.params.id)
  res.json({ ok: true })
})

// --- Open file in OS default app ---
app.post('/api/file/:id/open', async (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  try {
    await openInDefaultApp(file.path)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- Force relayout ---
// Relayouter.train() is intentionally synchronous (PCA + DB tx run in-process)
// so the handler doesn't need `await`; we keep the handler async only because
// Express types tolerate it.
app.post('/api/relayout', (_req, res) => {
  try {
    relayouter.train()
    hnsw.save()
    res.json({ ok: true, layoutVersion: relayouter.currentVersion, nodeCount: db.countWithEmbeddings() })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- Search ---
app.post('/api/search', async (req, res) => {
  const { query, limit } = req.body as { query?: string; limit?: number }
  if (!query) return res.status(400).json({ error: 'query required' })

  try {
    const embedResult = await embedEngine.embed(query)
    const k = limit ?? 20
    const knnResults = hnsw.searchKNN(embedResult.embedding, k)

    const results: SearchResult[] = []
    for (const r of knnResults) {
      const file = db.get(r.id)
      if (!file || file.x === null || file.y === null) continue
      results.push({
        id: r.id,
        x: file.x,
        y: file.y,
        score: 1 - r.distance,
        name: file.name,
        path: file.path,
      })
    }
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- File metadata ---
app.get('/api/file/:id', (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  db.incrementViewCount(req.params.id)
  const { embedding: _emb, ...safeFile } = file
  res.json(safeFile)
})

// --- File content for in-app viewer (text only; capped at VIEW_BYTES) ---
app.get('/api/file/:id/content', async (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })

  if (file.category === 'media') {
    const payload: FileContent = { content: null, mimeType: file.mimeType, truncated: false, size: file.size }
    return res.json(payload)
  }

  try {
    const onDisk = await stat(file.path)
    if (onDisk.size === 0) {
      const payload: FileContent = { content: '', mimeType: file.mimeType, truncated: false, size: 0 }
      return res.json(payload)
    }
    const buf = await readFile(file.path)
    const truncated = buf.length > VIEW_BYTES
    const slice = truncated ? buf.subarray(0, VIEW_BYTES) : buf
    const payload: FileContent = {
      content: slice.toString('utf8'),
      mimeType: file.mimeType,
      truncated,
      size: onDisk.size,
    }
    res.json(payload)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- Raw file bytes (image-only allowlist) — bypasses Vite CSP for <img src> ---
app.get('/api/file/:id/raw', (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  if (!RAW_MIME_ALLOW.test(file.mimeType)) {
    return res.status(415).json({ error: 'unsupported media type' })
  }
  res.sendFile(file.path)
})

// --- Neighborhood ---
app.get('/api/file/:id/neighborhood', (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })

  const edges = db.getEdgesFrom(req.params.id)
  const neighbors = edges.map(e => {
    const neighbor = db.get(e.dstId)
    if (!neighbor) return null
    const { embedding: _emb, ...safe } = neighbor
    return { file: safe, weight: e.weight }
  }).filter(Boolean)

  const clusterColor = file.clusterId !== null
    ? CONSTELLATION_PALETTE[db.getCluster(file.clusterId)?.colorIndex ?? 0]
    : null

  res.json({ file: { ...file, embedding: undefined }, neighbors, clusterColor })
})

export function startDaemon(port = DAEMON_PORT): void {
  app.listen(port, '127.0.0.1', () => {
    console.log(`Star Palace daemon listening on http://127.0.0.1:${port}`)
    console.log(`  DB: ${DB_PATH}`)
    console.log(`  Stars indexed: ${db.count()} (${db.countWithEmbeddings()} with embeddings)`)
    if (!relayouter.isReady) {
      console.log(`  Layout: not yet trained (need ${db.countWithEmbeddings()} / 200 embeddings)`)
    } else {
      console.log(`  Layout: version ${relayouter.currentVersion}`)
    }
  })
}

// Allow direct execution
if (require.main === module) {
  startDaemon()
}
