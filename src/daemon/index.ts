import express from 'express'
import cors from 'cors'
import { homedir } from 'os'
import { join, basename } from 'path'
import { mkdirSync } from 'fs'
import { stat } from 'fs/promises'
import { openInDefaultApp, revealInFileExplorer } from './util/openInDefaultApp'
import { FileIndex } from './db/FileIndex'
import { HnswIndex } from './ann/HnswIndex'
import { OllamaClient } from './embedding/OllamaClient'
import { EmbeddingEngine } from './embedding/EmbeddingEngine'
import { Relayouter } from './layout/Relayouter'
import { PC_COUNT } from './layout/Pca'
import { projectOnAxis } from './math/pinMath'
import { LAYOUT_THRESHOLD } from '../shared/types'
import { indexPath } from './pipeline/Insert'
import { buildIgnoreMatcher } from './index/ignoreMatcher'
import { progressStore } from './index/progressStore'
import type { ProgressState } from './index/progressStore'
import type { MapStats, ViewportResult, SearchResult, FileContent, StarType, CollectionKind } from '../shared/types'
import { DAEMON_PORT, CONSTELLATION_PALETTE, isStarType } from '../shared/types'
import { STRATEGIES, isStrategyId, STRATEGY_IDS } from './embedding/strategies'
import {
  runExperiment,
  getExperimentPositions,
  promoteExperiment,
  revertExperiment,
  reembedRestOfCorpus,
  reindexFile,
} from './embedding/experiments'
import { listSnapshots } from './embedding/snapshots'
import { prepareLabMix, mixLab, releaseLabMix } from './embedding/labMix'
import { searchSpotlight, SpotlightUnavailable } from './search/spotlight'
import { AtlasStore } from './atlas/AtlasStore'
import { AtlasService } from './atlas/service'
import { atlasRoutes } from './atlas/routes'
import { TextHistory } from './history/TextHistory'
import { textHistoryRoutes } from './history/routes'
import { updateRoutes } from './util/updateRoutes'
import { dirname, resolve } from 'node:path'

const RAW_MIME_ALLOW = /^(image\/(png|jpeg|gif|webp|avif|bmp|svg\+xml)|application\/pdf)$/

const DATA_DIR = process.env.STARPALACE_DIR ?? join(homedir(), '.starpalace')
const DB_PATH = process.env.STARPALACE_DB ?? join(DATA_DIR, 'index.db')
const HNSW_PATH = join(DATA_DIR, 'hnsw.bin')

mkdirSync(DATA_DIR, { recursive: true })

export const db = new FileIndex({ dbPath: DB_PATH })
export const hnsw = new HnswIndex({ persistPath: HNSW_PATH })
hnsw.load()

const ollamaClient = new OllamaClient({ baseUrl: process.env.STARPALACE_OLLAMA_URL })
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
  void relayouter.trainAsync().then(changed => {
    console.log(changed ? '[layout] Retrain complete.' : '[layout] Inputs changed; discarded stale training result.')
  }).catch(err => console.warn(`[layout] Retrain failed: ${String(err)}`))
}

export const app = express()
app.use(cors())
app.use(express.json({ limit: '5mb' }))

export const atlasStore = new AtlasStore(db)
export const atlasService = new AtlasService(atlasStore, embedEngine)
const updater = updateRoutes(() => progressStore.hasRunning())
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && updater.updating()) { res.status(409).json({ error: 'An update is in progress. Please wait for the app to restart.' }); return }
  next()
})
const textHistory = new TextHistory(atlasStore, join(dirname(resolve(DB_PATH)), 'text-history.git'))
app.use('/api/atlas/history', textHistoryRoutes(textHistory))
app.use('/api/atlas/update', updater)
app.use('/api/atlas', atlasRoutes(atlasService))

// B10 — body-parser surfaces SyntaxError/PayloadTooLargeError as Express's
// default HTML stack-trace page (which leaks absolute paths). Convert to a
// small JSON 400 so clients get a stable contract.
app.use((
  err: { type?: string; status?: number; message?: string } | null,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void => {
  if (!err) return next()
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'invalid JSON body' })
    return
  }
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'request body too large' })
    return
  }
  next(err)
})

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
//
// F17 — non-blocking: the response returns `{ jobId, galaxyId, galaxyName }`
// synchronously so the renderer can subscribe to `/api/index/progress` before
// the walker has emitted its first event. The actual walk runs detached; final
// stats arrive on the SSE stream's terminal frame (status='done'). This
// breaks the previous behaviour of returning `{ scanned, indexed, ... }` from
// the POST itself — callers (CLI script in particular) now read final stats
// via SSE or poll `progressStore.get(jobId)`.
app.post('/api/index', async (req, res) => {
  const { path: rootPath, galaxyName } = req.body as { path?: string; galaxyName?: string }
  if (typeof rootPath !== 'string' || !rootPath.trim()) return res.status(400).json({ error: 'path required' })
  if (galaxyName !== undefined && typeof galaxyName !== 'string') return res.status(400).json({ error: 'Invalid source name' })
  try { if (!(await stat(rootPath)).isDirectory()) return res.status(400).json({ error: 'Choose a folder to index' }) }
  catch { return res.status(400).json({ error: 'Folder not found or unavailable' }) }

  if (updater.updating()) return res.status(409).json({ error: 'An update is in progress. Index after the app restarts.' })
  const fallbackName = basename(rootPath) || rootPath
  const name = ((galaxyName ?? '').trim() || fallbackName).slice(0, 80)
  let galaxy
  try {
    galaxy = db.getOrCreateGalaxy(rootPath, name)
  } catch (err) {
    return res.status(500).json({ error: String(err) })
  }

  // Register the job + capture the jobId BEFORE returning so the renderer can
  // open the SSE connection knowing the store has an entry. The walk itself
  // runs after the response — see the .then() chain below.
  const jobId = progressStore.start({ galaxyId: galaxy.id, galaxyName: galaxy.name })

  // Layer the user's ignore patterns on top of the walker's hardcoded
  // DEFAULT_IGNORE so files matching `node_modules/`, `*.log`, etc. never
  // enter the indexer.
  const ignoreMatcher = buildIgnoreMatcher(db.getIgnorePatterns())

  // Detach: don't await. Errors land in the progressStore as the terminal
  // 'error' frame so SSE subscribers see the failure cause.
  void indexPath(rootPath, {
    db, hnsw, embedEngine, relayouter, galaxyId: galaxy.id,
    walkOpts: { matcher: ignoreMatcher },
    progress: {
      tick: payload => progressStore.update(jobId, payload),
      shouldCancel: () => progressStore.isCancelled(jobId),
    },
  }).then(stats => {
    hnsw.save()
    const cancelled = progressStore.isCancelled(jobId)
    progressStore.finish(jobId, {
      status: cancelled ? 'cancelled' : 'done',
      scanned: stats.scanned,
      indexed: stats.indexed,
      skipped: stats.skipped,
      errors: stats.errors,
      total: stats.scanned,  // by walk-end, total === scanned
    })
  }).catch(err => {
    progressStore.finish(jobId, {
      status: 'error',
      errorMessage: String(err),
    })
  })

  res.json({ jobId, galaxyId: galaxy.id, galaxyName: galaxy.name })
})

// --- F17: SSE progress stream for a single index job ---
// Subscribes to progressStore and streams every state mutation as a JSON
// payload over Server-Sent Events. Stream terminates when the job hits a
// terminal status (done / error / cancelled) or after PROGRESS_IDLE_TIMEOUT_MS
// of no updates (defensive backstop in case the walker hangs).
const PROGRESS_IDLE_TIMEOUT_MS = 60_000

app.get('/api/index/progress', (req, res) => {
  const jobId = (req.query.jobId as string | undefined) ?? ''
  if (!jobId) return res.status(400).json({ error: 'jobId required' })

  const initial = progressStore.get(jobId)
  if (!initial) return res.status(404).json({ error: 'unknown jobId' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // disable nginx buffering if reverse-proxied
  res.flushHeaders?.()

  let closed = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function send(state: ProgressState): void {
    if (closed) return
    res.write(`data: ${JSON.stringify(state)}\n\n`)
  }

  function close(): void {
    if (closed) return
    closed = true
    if (idleTimer) clearTimeout(idleTimer)
    unsubscribe()
    try { res.end() } catch { /* already torn down */ }
  }

  function bumpIdle(): void {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(close, PROGRESS_IDLE_TIMEOUT_MS)
    if (typeof idleTimer.unref === 'function') idleTimer.unref()
  }

  // Push the current state as the first frame so a late subscriber doesn't
  // sit blank until the next walker tick.
  send(initial)
  bumpIdle()
  if (initial.status !== 'running') {
    // Job already finished before the subscriber arrived (cleanup hasn't run
    // yet). Send the terminal frame, then close.
    setImmediate(close)
  }

  const unsubscribe = progressStore.subscribe(jobId, state => {
    send(state)
    bumpIdle()
    if (state.status !== 'running') setImmediate(close)
  })

  req.on('close', close)
  req.on('error', close)
})

// --- F17: cancel an in-flight index job ---
// Flips the cooperative abort flag in the progressStore. The walker checks it
// between files; in-flight per-file work completes (so we never leave a
// half-written DB row), then the loop breaks and `progressStore.finish` runs
// with status='cancelled'.
app.delete('/api/index/progress/:jobId', (req, res) => {
  const ok = progressStore.cancel(req.params.jobId)
  if (!ok) return res.status(404).json({ error: 'unknown or already-finished jobId' })
  res.json({ ok: true })
})

// --- Galaxies (F9) ---
app.get('/api/galaxies', (_req, res) => {
  res.json({ galaxies: db.listGalaxies() })
})

// --- Collections (F5) ---
//
// Seven endpoints:
//   GET    /api/collections                       — list with member counts
//   POST   /api/collections                       — create static or dynamic
//   GET    /api/collections/:id                   — detail with member ids
//   POST   /api/collections/:id/members           — add file ids (static use)
//   DELETE /api/collections/:id/members/:fileId   — remove single member
//   POST   /api/collections/:id/refresh           — re-evaluate dynamic membership
//   DELETE /api/collections/:id                   — drop collection (members cascade)
//
// Validation policy: kind must be 'static' or 'dynamic'; dynamic creates
// require a non-empty query. Unique-name conflict surfaces from the
// collections.name UNIQUE constraint as a SqliteError → HTTP 409.

const COLLECTION_REFRESH_LIMIT = 200  // top-K candidates for hnsw search before floor cut

function isCollectionKind(value: unknown): value is CollectionKind {
  return value === 'static' || value === 'dynamic'
}

app.get('/api/collections', (_req, res) => {
  res.json({ collections: db.listCollections() })
})

app.post('/api/collections', (req, res) => {
  const body = req.body as {
    name?: unknown; kind?: unknown; query?: unknown;
    similarityFloor?: unknown; fileIds?: unknown; colorIndex?: unknown;
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'name required' })
  if (!isCollectionKind(body.kind)) {
    return res.status(400).json({ error: "kind must be 'static' or 'dynamic'" })
  }
  if (body.kind === 'dynamic') {
    const q = typeof body.query === 'string' ? body.query.trim() : ''
    if (!q) return res.status(400).json({ error: 'dynamic collection requires non-empty query' })
  }

  let fileIds: string[] | undefined
  if (Array.isArray(body.fileIds)) {
    fileIds = body.fileIds.filter((x): x is string => typeof x === 'string')
  }
  let similarityFloor: number | undefined
  if (typeof body.similarityFloor === 'number' && Number.isFinite(body.similarityFloor)) {
    similarityFloor = body.similarityFloor
  }
  let colorIndex: number | undefined
  if (typeof body.colorIndex === 'number' && Number.isInteger(body.colorIndex) && body.colorIndex >= 0) {
    colorIndex = body.colorIndex
  }

  try {
    const coll = db.createCollection({
      name,
      kind: body.kind,
      query: typeof body.query === 'string' ? body.query : null,
      similarityFloor,
      fileIds,
      colorIndex,
    })
    const memberCount = db.getCollectionMembers(coll.id).length
    res.json({ ...coll, memberCount })
  } catch (err) {
    const msg = String(err)
    if (/UNIQUE/i.test(msg)) {
      return res.status(409).json({ error: `collection name '${name}' already exists` })
    }
    res.status(500).json({ error: msg })
  }
})

app.get('/api/collections/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const coll = db.getCollection(id)
  if (!coll) return res.status(404).json({ error: 'not found' })
  const memberIds = db.getCollectionMembers(id)
  res.json({ ...coll, memberIds, memberCount: memberIds.length })
})

app.post('/api/collections/:id/members', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const coll = db.getCollection(id)
  if (!coll) return res.status(404).json({ error: 'not found' })

  const body = req.body as { fileIds?: unknown }
  if (!Array.isArray(body.fileIds)) return res.status(400).json({ error: 'fileIds must be an array' })
  const fileIds = body.fileIds.filter((x): x is string => typeof x === 'string')
  db.addCollectionMembers(id, fileIds)
  const memberIds = db.getCollectionMembers(id)
  res.json({ ok: true, memberCount: memberIds.length, memberIds })
})

app.delete('/api/collections/:id/members/:fileId', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const coll = db.getCollection(id)
  if (!coll) return res.status(404).json({ error: 'not found' })
  db.removeCollectionMember(id, req.params.fileId)
  res.json({ ok: true })
})

// Refresh re-runs the dynamic collection's saved query through the embedder
// + hnsw, filters by similarity floor, intersects with currently-projected
// stars (need an x/y to render the hull), and atomically replaces membership.
// Returns the {added, removed} delta so the renderer can flash the diff.
//
// 503 when Ollama is unreachable (graceful failure per spec edge case).
// 400 if the collection is static (refresh has no meaning).
app.post('/api/collections/:id/refresh', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const coll = db.getCollection(id)
  if (!coll) return res.status(404).json({ error: 'not found' })
  if (coll.kind !== 'dynamic') {
    return res.status(400).json({ error: 'only dynamic collections can refresh' })
  }
  if (!coll.query) {
    return res.status(400).json({ error: 'dynamic collection has no query' })
  }

  try {
    const embedResult = await embedEngine.embed(coll.query)
    const knnResults = hnsw.searchKNN(embedResult.embedding, COLLECTION_REFRESH_LIMIT)
    const floor = coll.similarityFloor ?? 0
    const newMembers: string[] = []
    for (const r of knnResults) {
      const sim = 1 - r.distance
      if (sim < floor) continue
      const file = db.get(r.id)
      if (!file || file.x === null || file.y === null) continue  // only positioned stars
      newMembers.push(r.id)
    }
    const diff = db.setCollectionMembership(id, newMembers)
    res.json({ ...diff, memberCount: newMembers.length })
  } catch (err) {
    const msg = String(err)
    // Ollama down: distinguish from a generic 500 so the UI can show
    // a friendly "refresh failed (embedder offline)" rather than crash.
    if (/Ollama|ECONNREFUSED|fetch failed/i.test(msg)) {
      return res.status(503).json({ error: 'embedder unavailable' })
    }
    res.status(500).json({ error: msg })
  }
})

app.delete('/api/collections/:id', (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' })
  const coll = db.getCollection(id)
  if (!coll) return res.status(404).json({ error: 'not found' })
  db.deleteCollection(id)
  res.json({ ok: true })
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

// --- Position delta (cheap layoutVersion-bump refresh) ---
//
// During a relayout the renderer used to refetch the full /api/map/all
// payload (~5 MB at 10 k stars) just to pick up new x/y values. This
// endpoint returns only the positions whose layout_version > the supplied
// `since` value, plus the current cluster set (cluster centroids also
// shift on relayout). The renderer patches its star list in place so
// unchanged rows keep their object identity for downstream memos.
app.get('/api/map/positions', (req, res) => {
  const since = parseInt(req.query.since as string ?? '0', 10) || 0
  const positions = db.listPositionsSince(since)
  const clusters = db.getClusters()
  res.json({ version: relayouter.currentVersion, positions, clusters })
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

app.get('/api/file/:id/tags', (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  res.json({ tags: file.tags ?? [] })
})

app.post('/api/file/:id/tags', (req, res) => {
  const body = req.body as { tags?: unknown }
  if (!Array.isArray(body.tags) || body.tags.some(t => typeof t !== 'string')) {
    return res.status(400).json({ error: 'invalid tags (expected string[])' })
  }
  const tags = (body.tags as string[]).map(t => t.trim()).filter(t => t.length > 0)
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  db.setTags(req.params.id, tags.length === 0 ? null : tags)
  res.json({ ok: true, tags })
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

// --- Reveal file in OS file explorer (F14) ---
// macOS: highlights file in Finder (`open -R`).
// Windows: opens the parent folder with the file selected (`explorer /select,`).
// Linux: opens the parent directory (xdg-open has no native "select file" flag).
app.post('/api/file/:id/reveal', async (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  try {
    await revealInFileExplorer(file.path)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- Force relayout ---
// PCA fitting runs off-thread; publishing coordinates remains transactional.
app.post('/api/relayout', async (_req, res) => {
  try {
    await relayouter.trainAsync()
    hnsw.save()
    res.json({ ok: true, layoutVersion: relayouter.currentVersion, nodeCount: db.countWithEmbeddings() })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// --- Search ---
app.post('/api/search', async (req, res) => {
  const body = req.body as { query?: unknown; limit?: unknown; collectionId?: unknown }

  // B3, B5 — query must be a non-empty string. Anything else (arrays,
  // numbers, booleans, objects, whitespace-only) is a 400, not a 500.
  if (typeof body.query !== 'string' || body.query.trim() === '') {
    return res.status(400).json({ error: 'query must be a non-empty string' })
  }
  const query = body.query

  // B4, B6 — limit must be a non-negative integer if supplied.
  let limitN = 20
  if (body.limit !== undefined && body.limit !== null) {
    if (typeof body.limit !== 'number' || !Number.isFinite(body.limit) ||
        !Number.isInteger(body.limit) || body.limit < 0) {
      return res.status(400).json({ error: 'limit must be a non-negative integer' })
    }
    limitN = body.limit
  }

  // B7 — collectionId must be a non-negative integer if supplied.
  let collectionId: number | null = null
  if (body.collectionId !== undefined && body.collectionId !== null) {
    if (typeof body.collectionId !== 'number' || !Number.isInteger(body.collectionId) ||
        body.collectionId < 0) {
      return res.status(400).json({ error: 'collectionId must be a non-negative integer' })
    }
    collectionId = body.collectionId
  }

  try {
    if (limitN === 0) return res.json({ results: [] })

    let memberSet: Set<string> | null = null
    if (collectionId !== null) {
      const coll = db.getCollection(collectionId)
      if (!coll) return res.status(404).json({ error: 'collection not found' })
      memberSet = new Set(db.getCollectionMembers(collectionId))
    }

    const embedResult = await embedEngine.embed(query)
    const queryVec = embedResult.embedding

    const results: SearchResult[] = []
    if (memberSet) {
      // B1 — collection-scoped: score every member directly so members ranked
      // deeper than the global HNSW's top-k still surface. Collections are
      // bounded by their member count, so the dot-product loop is cheap even
      // for the largest cohorts. Embeddings are L2-normalised (see
      // EmbeddingEngine.embed) so the dot product equals cosine similarity.
      const scored: { id: string; score: number }[] = []
      for (const id of memberSet) {
        const file = db.get(id)
        if (!file || file.x === null || file.y === null || !file.embedding) continue
        let dot = 0
        const v = file.embedding
        for (let i = 0; i < v.length; i++) dot += queryVec[i] * v[i]
        scored.push({ id, score: dot })
      }
      scored.sort((a, b) => b.score - a.score)
      for (const s of scored.slice(0, limitN)) {
        const file = db.get(s.id)!
        results.push({
          id: s.id,
          x: file.x!,
          y: file.y!,
          score: s.score,
          name: file.name,
          path: file.path,
          galaxyId: file.galaxyId,
          isPinned: file.isPinned,
          pinAlpha: file.pinAlpha,
          pinBeta: file.pinBeta,
          pinAxisA: file.pinAxisA,
          pinAxisB: file.pinAxisB,
        })
      }
    } else {
      const knnResults = hnsw.searchKNN(queryVec, limitN)
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
          galaxyId: file.galaxyId,
          isPinned: file.isPinned,
          pinAlpha: file.pinAlpha,
          pinBeta: file.pinBeta,
          pinAxisA: file.pinAxisA,
          pinAxisB: file.pinAxisB,
        })
        if (results.length >= limitN) break
      }
    }
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// B11 — non-POST methods on /api/search should be 405, not Express's HTML 404.
app.all('/api/search', (_req, res) => {
  res.set('Allow', 'POST')
  res.status(405).json({ error: 'method not allowed; use POST' })
})

// Spotlight-backed literal search. macOS only; non-macOS callers receive
// 501 and the renderer falls back to the semantic /api/search.
app.post('/api/search/spotlight', async (req, res) => {
  const body = req.body as { query?: unknown; limit?: unknown; collectionId?: unknown; galaxyId?: unknown }

  if (typeof body.query !== 'string' || body.query.trim() === '') {
    return res.status(400).json({ error: 'query must be a non-empty string' })
  }
  const query = body.query

  let limitN = 30
  if (body.limit !== undefined && body.limit !== null) {
    if (typeof body.limit !== 'number' || !Number.isFinite(body.limit) ||
        !Number.isInteger(body.limit) || body.limit < 0) {
      return res.status(400).json({ error: 'limit must be a non-negative integer' })
    }
    limitN = body.limit
  }

  let collectionId: number | null = null
  if (body.collectionId !== undefined && body.collectionId !== null) {
    if (typeof body.collectionId !== 'number' || !Number.isInteger(body.collectionId) ||
        body.collectionId < 0) {
      return res.status(400).json({ error: 'collectionId must be a non-negative integer' })
    }
    collectionId = body.collectionId
  }

  let galaxyId: number | null = null
  if (body.galaxyId !== undefined && body.galaxyId !== null) {
    if (typeof body.galaxyId !== 'number' || !Number.isInteger(body.galaxyId) ||
        body.galaxyId < 0) {
      return res.status(400).json({ error: 'galaxyId must be a non-negative integer' })
    }
    galaxyId = body.galaxyId
  }

  if (collectionId !== null) {
    const coll = db.getCollection(collectionId)
    if (!coll) return res.status(404).json({ error: 'collection not found' })
  }

  try {
    const results = await searchSpotlight({ db }, { query, limit: limitN, collectionId, galaxyId })
    res.json({ results })
  } catch (err) {
    if (err instanceof SpotlightUnavailable) {
      return res.status(501).json({ error: 'spotlight-unavailable', reason: err.reason })
    }
    res.status(500).json({ error: String(err) })
  }
})

app.all('/api/search/spotlight', (_req, res) => {
  res.set('Allow', 'POST')
  res.status(405).json({ error: 'method not allowed; use POST' })
})

// --- File metadata ---
app.get('/api/file/:id', (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  db.incrementViewCount(req.params.id)
  const { embedding: _emb, ...safeFile } = file
  res.json(safeFile)
})

// Shared worker extraction also serves the retained advanced reader.
app.get('/api/file/:id/content', async (req, res) => {
  const file = db.get(req.params.id)
  if (!file) return res.status(404).json({ error: 'not found' })
  try {
    await atlasService.text(file.id)
    const doc = atlasStore.document(file.id)
    const payload: FileContent = { content: file.category === 'media' ? null : doc?.text ?? '', mimeType: file.mimeType,
      size: file.size, truncated: doc?.status === 'truncated' }
    return res.json(payload)
  } catch (error) { return res.status(500).json({ error: String(error) }) }
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

// --- B2: embedding experiments / snapshots ---
//
// Five GET / POST endpoints back the lab UI in B3:
//   GET  /api/embedding/strategies                        — registry + active default
//   POST /api/embedding/default                           — flip default_strategy
//   POST /api/embedding/experiment                        — re-embed a sub-tree
//   GET  /api/embedding/experiment/:id/positions          — subset PCA result
//   POST /api/embedding/experiment/:id/promote            — adopt + background re-embed
//   POST /api/embedding/experiment/:id/revert             — restore prior embeddings/positions
//   GET  /api/embedding/snapshots                         — history listing
//   POST /api/file/:id/reindex                            — single-file re-embed
//
// All write paths preserve the Insert-pipeline ordering invariants (HNSW
// search before SQL tx, addPoint after commit) — see
// src/daemon/embedding/experiments.ts for the shared helper.

app.get('/api/embedding/strategies', (_req, res) => {
  const list = STRATEGY_IDS
    .filter(id => !STRATEGIES[id].hidden)
    .map(id => ({
      id,
      label: STRATEGIES[id].label,
      description: STRATEGIES[id].description,
    }))
  const rawDefault = db.getDefaultStrategy()
  res.json({
    strategies: list,
    default: isStrategyId(rawDefault) ? rawDefault : 'content-only',
  })
})

app.post('/api/embedding/default', (req, res) => {
  const body = req.body as { strategy?: unknown }
  if (!isStrategyId(body.strategy)) {
    return res.status(400).json({ error: 'strategy must be a known StrategyId' })
  }
  db.setDefaultStrategy(body.strategy)
  res.json({ ok: true, strategy: body.strategy })
})

// User-managed ignore list. Stored as raw gitignore source so users see the
// same syntax they already know. Patterns apply to every future index walk
// AND, on save, sweep already-indexed files: anything now matching the rules
// is removed from `files`, `edges`, and the HNSW graph so contaminated rows
// from a prior index don't keep showing up in the renderer.
app.get('/api/settings/ignore-patterns', (_req, res) => {
  res.json({ patterns: db.getIgnorePatterns() })
})

app.put('/api/settings/ignore-patterns', (req, res) => {
  const body = req.body as { patterns?: unknown }
  if (typeof body.patterns !== 'string') {
    return res.status(400).json({ error: 'patterns must be a string (gitignore source)' })
  }
  db.setIgnorePatterns(body.patterns)

  const matcher = buildIgnoreMatcher(body.patterns)
  let removed = 0
  if (matcher.active) {
    const candidates = db.listFilesForSweep()
    for (const c of candidates) {
      // Files indexed before F9 (no galaxy_id) have no root to be relative to;
      // skip them rather than risk a confusing match against an empty root.
      if (!c.rootPath) continue
      if (!matcher.matches(c.path, c.rootPath)) continue
      db.delete(c.id)
      hnsw.markDelete(c.id)
      removed++
    }
    if (removed > 0) hnsw.save()
  }
  res.json({ ok: true, removed })
})

app.post('/api/embedding/experiment', async (req, res) => {
  const body = req.body as { scopePath?: unknown; strategy?: unknown; note?: unknown }
  if (typeof body.scopePath !== 'string' || !body.scopePath.trim()) {
    return res.status(400).json({ error: 'scopePath must be a non-empty string' })
  }
  if (!isStrategyId(body.strategy)) {
    return res.status(400).json({ error: 'strategy must be a known StrategyId' })
  }
  const note = typeof body.note === 'string' ? body.note : undefined

  try {
    const result = await runExperiment(
      { db, hnsw, embedEngine, relayouter },
      { scopePath: body.scopePath, strategy: body.strategy, note }
    )
    if ('ok' in result) {
      hnsw.save()
      return res.json({ snapshotId: result.snapshotId, affectedIds: result.affectedIds })
    }
    if (result.code === 'too-few-files') {
      return res.status(400).json({ error: result.message, count: result.count })
    }
    if (result.code === 'invalid-strategy') {
      return res.status(400).json({ error: result.message })
    }
    if (result.code === 'subset-pca-failed') {
      return res.status(500).json({ error: result.message })
    }
    return res.status(500).json({ error: 'unknown experiment failure' })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/embedding/experiment/:id/positions', (req, res) => {
  const result = getExperimentPositions(db, req.params.id)
  if ('code' in result) return res.status(404).json({ error: 'snapshot not found' })
  res.json(result)
})

app.post('/api/embedding/experiment/:id/promote', (req, res) => {
  const result = promoteExperiment(db, req.params.id)
  if ('code' in result) return res.status(404).json({ error: 'snapshot not found' })

  // Kick the corpus-wide re-embed in the background. The progressStore is
  // built around the walker's tick payload shape, so we adapt our (processed,
  // total, currentId) frame onto its (scanned, indexed, currentPath) fields:
  // `scanned == processed`, `indexed == processed - errors`, `currentPath ==
  // currentId`. Saves us inventing a new SSE channel.
  const jobId = progressStore.start({ galaxyId: null, galaxyName: null })
  const excludeIds = new Set<string>()  // affected ids already match the new strategy
  void reembedRestOfCorpus(
    { db, hnsw, embedEngine, excludeIds, newStrategy: result.snapshot.strategy },
    {
      tick: ({ processed, total, currentId }) => {
        progressStore.update(jobId, {
          scanned: processed,
          indexed: processed,
          currentPath: currentId,
          total,
        })
      },
    }
  ).then(({ processed, total, errors }) => {
    hnsw.save()
    progressStore.finish(jobId, {
      status: 'done',
      scanned: processed,
      indexed: processed - errors,
      errors,
      total,
    })
  }).catch(err => {
    progressStore.finish(jobId, { status: 'error', errorMessage: String(err) })
  })

  res.json({ ok: true, jobId })
})

app.post('/api/embedding/experiment/:id/revert', async (req, res) => {
  // ?relayout=false skips the post-revert global PCA retrain — used by
  // batched reverts that intend to retrain once at the end.
  const relayout = req.query.relayout !== 'false'
  const result = await revertExperiment({ db, hnsw, relayouter }, req.params.id, { relayout })
  if ('code' in result) return res.status(404).json({ error: 'snapshot not found' })
  hnsw.save()
  res.json({
    ok: true,
    restored: result.restoredCount,
    skipped: result.skippedCount,
    layoutVersion: relayouter.currentVersion,
  })
})

app.get('/api/embedding/snapshots', (_req, res) => {
  res.json(listSnapshots(db))
})

// --- live-mix lab ---
//   POST   /api/embedding/lab/prepare   — embed scope under N channels, cache
//   POST   /api/embedding/lab/mix       — slider-driven recompute
//   DELETE /api/embedding/lab/:prepId   — release workbench
//
// Workbenches live in-memory only (see labMix.ts). Prepare is the slow call;
// mix is pure arithmetic over cached vectors so a slider drag is sub-50 ms.

app.post('/api/embedding/lab/prepare', async (req, res) => {
  try {
    const scopePath = String(req.body?.scopePath ?? '')
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String) : []
    if (!scopePath) {
      return res.status(400).json({ error: 'scopePath required' })
    }
    const result = await prepareLabMix(
      { db, embedEngine },
      { scopePath, channels: channels as never }
    )
    if ('code' in result) {
      const status = result.code === 'invalid-channel' ? 400 : 400
      return res.status(status).json({ error: result.message, code: result.code })
    }
    res.json({
      prepId: result.prepId,
      fileIds: result.fileIds,
      channels: result.channels,
      count: result.count,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.post('/api/embedding/lab/mix', (req, res) => {
  try {
    const prepId = String(req.body?.prepId ?? '')
    const weights = (req.body?.weights ?? {}) as Record<string, number>
    if (!prepId) {
      return res.status(400).json({ error: 'prepId required' })
    }
    const result = mixLab({ prepId, weights })
    if ('code' in result) {
      if (result.code === 'not-found') return res.status(404).json({ error: 'not found' })
      return res.status(400).json({ error: result.message, code: result.code })
    }
    res.json({ positions: result.positions })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.delete('/api/embedding/lab/:prepId', (req, res) => {
  const ok = releaseLabMix(req.params.prepId)
  if (!ok) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

app.post('/api/file/:id/reindex', async (req, res) => {
  try {
    const result = await reindexFile({ db, hnsw, embedEngine }, req.params.id)
    if ('code' in result) {
      if (result.code === 'not-found') return res.status(404).json({ error: 'not found' })
      if (result.code === 'read-failed') return res.status(500).json({ error: result.message })
    } else {
      hnsw.save()
      return res.json({ ok: true, embedded: result.embedded })
    }
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

export function startDaemon(port = Number(process.env.STARPALACE_PORT) || DAEMON_PORT): void {
  atlasStore.syncBatch(64)
  atlasService.start()
  textHistory.start()
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
