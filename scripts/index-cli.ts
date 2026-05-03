import { resolve } from 'path'
import { Agent } from 'undici'

const DAEMON_URL = `http://127.0.0.1:${process.env.DAEMON_PORT ?? 7373}`
const longTimeoutAgent = new Agent({ headersTimeout: 60 * 60 * 1000, bodyTimeout: 60 * 60 * 1000 })
const targetPath = process.argv[2]

if (!targetPath) {
  console.error('Usage: tsx scripts/index-cli.ts <path>')
  process.exit(1)
}

const absPath = resolve(targetPath)

// F17 — `POST /api/index` is now non-blocking and returns { jobId } right
// away. The CLI consumes the SSE progress stream so its previous behaviour
// (one synchronous "wait for the indexer, then print stats" call) still
// holds for scripts and terminal users.
//
// Polling 4 Hz off `/api/index/progress?jobId=…` lets us avoid pulling in an
// EventSource implementation just for the CLI; the daemon's first SSE frame
// is the latest snapshot, so a one-shot fetch reads the live state too. (We
// rely on the SSE endpoint to flush an initial frame before holding the
// connection open — which it does.)

interface ProgressFrame {
  status: 'running' | 'done' | 'error' | 'cancelled'
  scanned: number
  indexed: number
  skipped: number
  errors: number
  total: number | null
  errorMessage: string | null
  currentPath: string | null
}

async function readLatestFrame(jobId: string): Promise<ProgressFrame | null> {
  // Connect, read one frame, then close. Cheaper than holding a long-lived
  // EventSource open for a CLI that just polls.
  const res = await fetch(`${DAEMON_URL}/api/index/progress?jobId=${encodeURIComponent(jobId)}`, {
    headers: { Accept: 'text/event-stream' },
  })
  if (!res.ok || !res.body) return null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return null
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        return JSON.parse(line.slice(6)) as ProgressFrame
      }
    }
  } finally {
    try { await reader.cancel() } catch { /* socket already gone */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function main(): Promise<void> {
  console.log(`Indexing: ${absPath}`)
  const res = await fetch(`${DAEMON_URL}/api/index`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: absPath }),
    // @ts-expect-error undici dispatcher not in Node fetch types
    dispatcher: longTimeoutAgent,
  })

  if (!res.ok) {
    console.error('Failed:', res.status, await res.text())
    process.exit(1)
  }

  const handle = await res.json() as { jobId: string; galaxyName: string }
  console.log(`Job ${handle.jobId} → galaxy "${handle.galaxyName}"`)

  // Poll every 250 ms until the SSE frame reports a terminal status.
  for (;;) {
    await sleep(250)
    const frame = await readLatestFrame(handle.jobId)
    if (!frame) {
      // Job entry GC'd; treat as done.
      console.log('progress entry expired; assume done')
      return
    }
    process.stderr.write(
      `\r${frame.scanned} scanned · ${frame.indexed} indexed · ${frame.errors} err${frame.currentPath ? ` · ${frame.currentPath.slice(-40)}` : ''}        `
    )
    if (frame.status !== 'running') {
      process.stderr.write('\n')
      console.log(JSON.stringify(frame, null, 2))
      if (frame.status === 'error') process.exit(1)
      return
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
