import { execFileSync } from 'node:child_process'
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { build } from 'esbuild'
import { cpus, platform, release } from 'node:os'

const base = process.env.ATLAS_BENCH_URL ?? 'http://127.0.0.1:5175'
const runs = (await readdir('.atlas-benchmark')).filter(n => n.startsWith('run-')).sort()
const source = resolve('.atlas-benchmark', runs.at(-1))
const output = resolve('.atlas-benchmark', `browser-${Date.now()}`)
await mkdir(output, { recursive: true })
await build({ entryPoints: ['src/renderer/src/atlas/pointRenderer.ts'], bundle: true, format: 'iife', globalName: 'AtlasRenderers', outfile: join(output, 'renderer.js') })
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const report = { timestamp: new Date().toISOString(), browser: browser.version(), os: `${platform()} ${release()}`, cpu: cpus()[0].model, viewport: [1440, 960], dpr: 2, foreground: true, production: true, input: source, scenes: [], stress: [] }
const errors = []
page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
page.setDefaultTimeout(15000)
try {
  for (const count of (process.env.ATLAS_BENCH_QUICK ? [100000, 'actual'] : [10000, 50000, 100000, 'actual'])) {
    const fixture = JSON.parse(await readFile(count === 'actual' ? '.atlas-real/scene.json' : join(source, `scene-${count}.json`), 'utf8'))
    for (const region of fixture.summary.regions) region.objectTypes ??= { 'main-sequence': region.count }
    await page.unrouteAll()
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      const data = path.endsWith('/atlas/summary') ? fixture.summary : path.endsWith('/atlas/files') ? fixture.files : path === '/api/galaxies' ? { galaxies: [] } : path === '/api/collections' ? { collections: [] } : []
      return route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' } })
    })
    for (const renderer of ['gpu', 'canvas']) {
      await page.goto(base + '/?renderer=' + renderer)
      await page.bringToFront()
      await page.evaluate(() => localStorage.clear())
      const start = performance.now()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Number(document.querySelector('.atlas-map')?.getAttribute('data-points')) > 0)
      const startupMs = performance.now() - start
      await page.waitForTimeout(300)
      const target = await page.locator('.atlas-label-canvas').boundingBox()
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.mouse.down()
      const result = await page.evaluate(async () => {
        const canvas = document.querySelector('.atlas-label-canvas'), host = document.querySelector('.atlas-map')
        const box = canvas.getBoundingClientRect()
        const samples = [], draws = [], tasks = [], inputPaint = []
        const observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(e => e.duration)))
        observer.observe({ type: 'longtask', buffered: false })
        let previous = performance.now(), frame = 0
        await new Promise(resolve => {
          const step = now => {
            if (frame > 30) { samples.push(now - previous); draws.push(Number(host.dataset.drawMs)) }
            previous = now
            canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: box.x + box.width / 2 + Math.sin(frame / 24) * 150, clientY: box.y + box.height / 2 + Math.cos(frame / 24) * 80, bubbles: true }))
            if (frame % 10 === 0) { const input = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => inputPaint.push(performance.now() - input))) }
            if (frame++ < 210) requestAnimationFrame(step); else resolve()
          }
          requestAnimationFrame(step)
        })
        canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true }))
        observer.disconnect()
        const percentile = (a, p) => a.sort((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * p))]
        return { renderer: host.dataset.renderer, visibility: document.visibilityState, points: Number(host.dataset.points), frameP50: percentile(samples, .5), frameP95: percentile(samples, .95), frameP99: percentile(samples, .99), drawP95: percentile(draws, .95), inputTwoRafP95: percentile(inputPaint, .95), longTasks: tasks, jsHeapMiB: performance.memory?.usedJSHeapSize / 2 ** 20 }
      })
      await page.mouse.up()
      await page.getByRole('button', { name: 'Fit view', exact: true }).click()
      // JS heap is not renderer RSS; retain both when the browser exposes process metrics.
      const cdp = await browser.newBrowserCDPSession()
      const processes = await cdp.send('SystemInfo.getProcessInfo').catch(() => null)
      await cdp.detach()
      const rendererPids = processes?.processInfo.filter(p => p.type === 'renderer').map(p => p.id) ?? []
      let rendererRssMiB = null
      try { rendererRssMiB = execFileSync('ps', ['-o', 'rss=', '-p', rendererPids.join(',')], { encoding: 'utf8' }).trim().split(/\s+/).reduce((sum, n) => sum + Number(n), 0) / 1024 } catch {}
      report.scenes.push({ count, startupMs, ...result, rendererProcesses: rendererPids.length, combinedRendererRssMiB: rendererRssMiB })
      console.log(JSON.stringify(report.scenes.at(-1)))
      if (renderer === 'gpu') await page.screenshot({ path: join(output, `overview-${count}.png`) })
      await writeFile(join(output, 'browser.json'), JSON.stringify(report, null, 2))
    }
  }
  // Compare the exact production point passes without LOD to expose their limits.
  await page.unrouteAll()
  await page.goto('about:blank'); await page.bringToFront()
  await page.addScriptTag({ path: join(output, 'renderer.js') })
  for (const count of (process.env.ATLAS_BENCH_QUICK ? [] : [10000, 50000, 100000])) for (const kind of ['gpu', 'canvas']) {
    const result = await page.evaluate(async ({ count, kind }) => {
      document.body.innerHTML = '<canvas style="width:1200px;height:800px"></canvas>'
      const canvas = document.querySelector('canvas'); canvas.width = 2400; canvas.height = 1600
      const engine = kind === 'gpu' ? window.AtlasRenderers.gpuRenderer(canvas) : window.AtlasRenderers.canvasRenderer(canvas)
      if (!engine) return { unavailable: true }
      let seed = 9183
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
      engine.setPoints(Array.from({ length: count }, (_, i) => ({ id: String(i), x: (random() - .5) * 2400, y: (random() - .5) * 1600, radius: 10, objectType: ['red-giant','blue-supergiant','white-dwarf','main-sequence','neutron-star','pulsar','binary','quasar','black-hole','nebula'][i % 10], color: '#b9d5d7', alpha: .7 })))
      const frames = [], draws = []; let frame = 0, previous = performance.now()
      await new Promise(resolve => {
        const tick = now => {
          if (frame > 30) frames.push(now - previous)
          previous = now
          const t = performance.now(); engine.draw({ x: Math.sin(frame / 30) * 200, y: Math.cos(frame / 30) * 100, zoom: .5 }, 1200, 800, 2)
          if (frame > 30) draws.push(performance.now() - t)
          if (frame++ < 150) requestAnimationFrame(tick); else resolve()
        }; requestAnimationFrame(tick)
      })
      engine.destroy()
      const percentile = (a, p) => a.sort((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * p))]
      return { visibility: document.visibilityState, frameP95: percentile(frames, .95), frameP99: percentile(frames, .99), drawP95: percentile(draws, .95), bufferMiB: count * 44 / 2 ** 20 }
    }, { count, kind })
    report.stress.push({ count, renderer: kind, ...result }); console.log(JSON.stringify(report.stress.at(-1)))
    await writeFile(join(output, 'browser.json'), JSON.stringify(report, null, 2))
  }
  report.errors = errors
  await writeFile(join(output, 'browser.json'), JSON.stringify(report, null, 2))
  console.log(`Report: ${output}`)
} catch (error) { await page.screenshot({ path: join(output, 'failure.png') }); throw error } finally { await browser.close() }
