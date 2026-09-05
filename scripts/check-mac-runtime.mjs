// Feasibility check for a bundled Mac app: compiled daemon and workers,
// plus the single-command source launcher. All data is temporary.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { TextExtractor } from '../dist-daemon/daemon/index/extractors/text.js'

const directory = await mkdtemp(join(tmpdir(), 'star-palace-runtime-'))
const children = []
async function freePort() {
  const server = createServer()
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(url, child) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Runtime exited early')
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return response } catch { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Runtime did not become ready: ' + url)
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exit } finally { clearTimeout(timer) }
}
let extractor
try {
  const path = join(directory, 'hello.md')
  await writeFile(path, '# A small garden\nBasil for the evenings.')
  extractor = new TextExtractor()
  const extracted = await extractor.extract(path)
  assert.match(extracted.text, /Basil/)
  extractor.close(); extractor = null
  const vectors = Array.from({ length: 25 }, (_, i) => Float32Array.from({ length: 12 }, (_, j) => Math.sin(i * 2.71 + j * i * .32)))
  const worker = new Worker(resolve('dist-daemon/daemon/layout/pca-worker.cjs'), { workerData: { vectors } })
  const timeout = setTimeout(() => { void worker.terminate() }, 15000)
  try {
    const [result] = await once(worker, 'message')
    assert.equal(result.error, undefined)
    assert.equal(result.positions.length, vectors.length)
    assert.ok(result.positions.flat().every(Number.isFinite))
  } finally { clearTimeout(timeout); await worker.terminate() }

  const daemonPort = await freePort()
  const daemon = spawn(process.execPath, ['dist-daemon/daemon/index.js'], {
    env: { ...process.env, STARPALACE_DIR: join(directory, 'compiled'), STARPALACE_DB: join(directory, 'compiled', 'index.db'), STARPALACE_PORT: String(daemonPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(daemon)
  daemon.stderr.on('data', data => process.stderr.write(data))
  const response = await waitFor('http://127.0.0.1:' + daemonPort + '/api/atlas/summary', daemon)
  assert.equal((await response.json()).total, 0)
  await stop(daemon)

  const localPort = await freePort(), webPort = await freePort()
  const launcher = spawn(process.execPath, ['scripts/start-local.mjs'], {
    env: { ...process.env, STARPALACE_DIR: join(directory, 'launcher'), STARPALACE_DB: join(directory, 'launcher', 'index.db'), STARPALACE_PORT: String(localPort), STARPALACE_WEB_PORT: String(webPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(launcher)
  launcher.stderr.on('data', data => process.stderr.write(data))
  await waitFor('http://127.0.0.1:' + localPort + '/api/atlas/summary', launcher)
  const renderer = await waitFor('http://127.0.0.1:' + webPort, launcher)
  assert.match(await renderer.text(), /root/)
  await stop(launcher)
  // Parent exit must mean its two child servers have stopped as well.
  for (const port of [localPort, webPort]) {
    await assert.rejects(fetch('http://127.0.0.1:' + port, { signal: AbortSignal.timeout(1000) }))
  }
  console.log('PASS: compiled text/PCA workers, compiled daemon, source launcher, and shutdown; isolated temporary databases only.')
} finally {
  extractor?.close()
  for (const child of children) await stop(child)
  await rm(directory, { recursive: true, force: true })
}
