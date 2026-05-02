import { resolve } from 'path'
import { existsSync } from 'fs'

const DAEMON_URL = `http://127.0.0.1:${process.env.DAEMON_PORT ?? 7373}`
const CORPUS_PATH = resolve(process.cwd(), process.argv[2] ?? 'dummy-corpus')

async function waitForDaemon(retries = 30, delay = 1000): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${DAEMON_URL}/api/health`)
      if (res.ok) {
        const body = await res.json() as { ok: boolean; ollamaAvailable: boolean }
        if (!body.ollamaAvailable) {
          console.warn('\nWARNING: Ollama not reachable at localhost:11434')
          console.warn('  Run: ollama serve')
          console.warn('  Then: ollama pull nomic-embed-text\n')
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
    console.error('Run: bash scripts/fetch-corpus.sh')
    process.exit(1)
  }

  console.log('Waiting for daemon...')
  await waitForDaemon()
  console.log(' OK')

  const health = await fetch(`${DAEMON_URL}/api/health`).then(r => r.json()) as Record<string, unknown>
  console.log(`Daemon: ${JSON.stringify(health)}`)
  console.log(`\nIndexing corpus at: ${CORPUS_PATH}`)
  console.log('(This may take several minutes — ~50ms per file for Ollama embedding)\n')

  const start = Date.now()
  const res = await fetch(`${DAEMON_URL}/api/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: CORPUS_PATH }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error('Index failed:', res.status, body)
    process.exit(1)
  }

  const stats = await res.json() as {
    scanned: number; indexed: number; skipped: number; errors: number; durationMs: number
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  console.log(`\nDone in ${elapsed}s`)
  console.log(`  Scanned: ${stats.scanned}`)
  console.log(`  Indexed: ${stats.indexed}`)
  console.log(`  Skipped: ${stats.skipped}`)
  console.log(`  Errors:  ${stats.errors}`)

  const statsRes = await fetch(`${DAEMON_URL}/api/map/stats`).then(r => r.json()) as Record<string, unknown>
  console.log(`\nMap stats: ${JSON.stringify(statsRes, null, 2)}`)

  if (Number(statsRes.layoutVersion) < 1) {
    console.log('\nNOTE: Layout not yet trained (need 200+ embeddings).')
    console.log('  Index more files, or the layout will train automatically once threshold is reached.')
  } else {
    console.log('\nLayout trained! Open http://localhost:5173 to explore the sky.')
  }

  console.log('\nTo open the renderer:  npm run dev:web')
}

main().catch(e => { console.error(e); process.exit(1) })
