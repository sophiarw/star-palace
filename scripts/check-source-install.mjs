// Run after `npm ci` to verify the website's source-install path. Uses only
// temporary files/databases and a browser already installed on this Mac.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = await mkdtemp(join(tmpdir(), 'star-palace-install-check-'))
const source = join(directory, 'My work files'), data = join(directory, 'local-library')
const phrase = 'violet compass rendezvous'
const withoutModel = process.argv.includes('--without-model')
let browser, launcher
let output = ''
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function waitFor(url, condition = () => true) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null) throw new Error('npm start exited before startup:\n' + output)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok && await condition(response)) return
    } catch { /* process startup / background indexing */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for ' + url + '\n' + output)
}
async function stop() {
  if (!launcher || launcher.exitCode !== null || launcher.signalCode !== null) return
  const exit = once(launcher, 'exit')
  // A terminal's Control C goes to the foreground process group, including npm.
  try { process.kill(-launcher.pid, 'SIGINT') } catch { launcher.kill('SIGINT') }
  const timer = setTimeout(() => { try { process.kill(-launcher.pid, 'SIGKILL') } catch { /* already exited */ } }, 5000)
  try { await exit } finally { clearTimeout(timer) }
}
try {
  await mkdir(source)
  await writeFile(join(source, 'Project notes.md'), `# Installation notebook\n\nThe ${phrase} is our next meeting.\n`)
  await writeFile(join(source, 'Inventory.csv'), 'Item,Quantity\nCompass,2\nNotebook,3\n')
  const daemonPort = await freePort(), webPort = await freePort()
  const api = `http://127.0.0.1:${daemonPort}/api`
  const unavailableModel = withoutModel ? `http://127.0.0.1:${await freePort()}` : undefined
  launcher = spawn('npm', ['start'], { cwd: root, detached: true, env: {
    ...process.env, ...(unavailableModel ? { STARPALACE_OLLAMA_URL: unavailableModel } : {}), STARPALACE_DIR: data, STARPALACE_DB: join(data, 'index.db'), STARPALACE_PORT: String(daemonPort), STARPALACE_WEB_PORT: String(webPort),
  }, stdio: ['ignore', 'pipe', 'pipe'] })
  launcher.stdout.on('data', text => { output += text }); launcher.stderr.on('data', text => { output += text })
  await waitFor(api + '/atlas/summary', async response => (await response.json()).total === 0)
  await waitFor(`http://127.0.0.1:${webPort}`)
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${webPort}`)
  await page.getByRole('button', { name: 'Add your first folder', exact: true }).click()
  await page.getByLabel('Folder path', { exact: true }).fill(source)
  await page.getByLabel('Name', { exact: false }).fill('Installation check')
  await page.getByRole('button', { name: 'Index folder', exact: true }).click()
  await waitFor(api + '/atlas/summary', async response => { const summary = await response.json(); return summary.positioned === 2 && summary.searchable === 2 })
  await page.getByRole('textbox', { name: 'Search library' }).fill(phrase)
  await page.getByRole('combobox', { name: 'Search mode', exact: true }).selectOption('exact')
  await page.locator('.atlas-result').first().waitFor()
  assert.match(await page.locator('.atlas-result').first().innerText(), /Project notes/)
  await page.locator('.atlas-result').first().click()
  await page.waitForFunction(text => document.querySelector('.atlas-reading-content')?.textContent?.includes(text), phrase)
  const health = await fetch(api + '/health').then(response => response.json())
  const files = await fetch(api + '/atlas/files').then(response => response.json())
  assert.equal(files.files.length, 2)
  if (withoutModel) { assert.equal(health.ollamaAvailable, false); assert.equal(files.files.filter(file => file.hasEmbedding).length, 0) }
  assert.equal(errors.length, 0, errors.join('\n'))
  await browser.close(); browser = null
  await stop()
  for (const port of [daemonPort, webPort]) await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }))
  console.log(JSON.stringify({ result: 'PASS', command: 'npm start', node: process.version, platform: process.platform, architecture: process.arch, filesIndexed: 2, extractedTextSearch: true, readerPreview: true, browserErrors: errors, ollamaAvailable: health.ollamaAvailable, embeddedFiles: files.files.filter(file => file.hasEmbedding).length, controlCStoppedBothServers: true, primaryDatabaseTouched: false }, null, 2))
} finally {
  await browser?.close(); await stop(); await rm(directory, { recursive: true, force: true })
}
