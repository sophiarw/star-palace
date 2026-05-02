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

  const stats = await res.json()
  console.log(JSON.stringify(stats, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
