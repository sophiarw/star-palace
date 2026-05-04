// Seed the audit DB. Assumes daemon is already running with STARPALACE_DIR /
// STARPALACE_DB pointed at the audit data dir (see scripts/dev-audit.sh).
//
// 1. Wait for daemon
// 2. POST /api/index against audit-corpus/
// 3. POST /api/relayout (PCA train) — auto-train fires too, this is belt+braces
// 4. GET /api/map/all, parse filename → star_type, POST /api/file/:id/star-type
//
// Idempotent: re-running just re-asserts star types.

import { resolve, basename } from 'path'
import { existsSync } from 'fs'
import type { Star } from '../src/shared/types'
import { AUDIT_TOTAL, parseAuditCorpusType } from '../src/shared/auditCorpus'

const DAEMON_URL = `http://127.0.0.1:${process.env.DAEMON_PORT ?? 7373}`
const CORPUS_PATH = resolve(process.cwd(), 'audit-corpus')

async function waitForDaemon(retries = 30, delay = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${DAEMON_URL}/api/health`)
      if (res.ok) {
        const body = await res.json() as { ok: boolean; ollamaAvailable: boolean }
        if (!body.ollamaAvailable) {
          console.warn('\nWARNING: Ollama not reachable at localhost:11434')
          console.warn('  Run: ollama serve && ollama pull nomic-embed-text\n')
        }
        return
      }
    } catch { /* retry */ }
    process.stdout.write('.')
    await new Promise(r => setTimeout(r, delay))
  }
  throw new Error(`Daemon not reachable after ${retries}s. Start it with: npm run dev:daemon`)
}

async function main(): Promise<void> {
  if (!existsSync(CORPUS_PATH)) {
    console.error(`Corpus not found at ${CORPUS_PATH}`)
    console.error('Run: node scripts/build-audit-corpus.mjs')
    process.exit(1)
  }

  console.log('Waiting for daemon...')
  await waitForDaemon()
  console.log(' OK')

  console.log(`\nIndexing ${CORPUS_PATH}...`)
  const start = Date.now()
  const indexRes = await fetch(`${DAEMON_URL}/api/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: CORPUS_PATH }),
  })
  if (!indexRes.ok) {
    console.error('Index failed:', indexRes.status, await indexRes.text())
    process.exit(1)
  }
  const { jobId } = await indexRes.json() as { jobId: string; galaxyId: number; galaxyName: string }
  console.log(`Index job: ${jobId}`)

  // /api/index is async since F17 — poll /api/map/stats until embedding count
  // stops growing for several consecutive ticks.
  const TARGET = AUDIT_TOTAL
  let lastEmbedded = -1
  let stable = 0
  let lastTotal = 0
  for (let i = 0; i < 600; i++) {
    await new Promise(r => setTimeout(r, 500))
    const s = await fetch(`${DAEMON_URL}/api/map/stats`).then(r => r.json()) as {
      total: number; indexedWithEmbedding: number; layoutVersion: number
    }
    lastTotal = s.total
    if (s.indexedWithEmbedding === lastEmbedded) stable++
    else { stable = 0; lastEmbedded = s.indexedWithEmbedding }
    process.stdout.write(`\r  scanned=${s.total} embedded=${s.indexedWithEmbedding} layoutV=${s.layoutVersion}    `)
    if (s.indexedWithEmbedding >= TARGET) break
    if (stable >= 6) break  // 3s of no progress = walker done
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\nIndex done in ${elapsed}s — total=${lastTotal} embedded=${lastEmbedded}`)

  console.log('\nForcing PCA layout train...')
  const relayoutRes = await fetch(`${DAEMON_URL}/api/relayout`, { method: 'POST' })
  if (!relayoutRes.ok) {
    console.error('Relayout failed:', relayoutRes.status, await relayoutRes.text())
  } else {
    const layout = await relayoutRes.json() as { layoutVersion: number; nodeCount: number }
    console.log(`Layout v${layout.layoutVersion} on ${layout.nodeCount} nodes`)
  }

  console.log('\nFetching all stars...')
  const mapRes = await fetch(`${DAEMON_URL}/api/map/all`)
  const { stars } = await mapRes.json() as { stars: Star[] }
  console.log(`Stars in DB: ${stars.length}`)

  console.log('\nAssigning star types...')
  let ok = 0
  let skip = 0
  let fail = 0
  for (const star of stars) {
    const fname = basename(star.path)
    const starType = parseAuditCorpusType(fname)
    if (!starType) { skip++; continue }
    const r = await fetch(`${DAEMON_URL}/api/file/${star.id}/star-type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starType }),
    })
    if (r.ok) ok++
    else { fail++; console.warn(`  ${fname} -> ${starType}: ${r.status} ${await r.text()}`) }
  }
  console.log(`Star types assigned: ${ok} ok, ${skip} skipped (no prefix match), ${fail} fail`)

  const finalStats = await fetch(`${DAEMON_URL}/api/map/stats`).then(r => r.json()) as Record<string, unknown>
  console.log(`\nMap stats: ${JSON.stringify(finalStats, null, 2)}`)

  console.log('\nNext: npm run dev:web  → open http://localhost:5173')
}

main().catch(e => { console.error(e); process.exit(1) })
