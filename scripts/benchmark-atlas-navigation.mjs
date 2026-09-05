import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
const base = process.env.ATLAS_BENCH_URL ?? 'http://127.0.0.1:5175'
const output = '.atlas-real/zoom-feedback'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: false })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
const report = { date: new Date().toISOString(), browser: browser.version(), cpu: cpus()[0].model, production: true, mockedApi: false, phases: [] }
try {
  for (const mode of ['gpu', 'canvas']) {
    await page.goto(base + '/?renderer=' + mode, { waitUntil: 'networkidle' }); await page.bringToFront()
    await page.waitForTimeout(500)
    const sample = await page.evaluate(async () => {
      const host = document.querySelector('.atlas-map'), overlay = document.querySelector('.atlas-label-canvas'), box = host.getBoundingClientRect()
      const camera = () => JSON.parse(host.dataset.camera)
      const initial = camera(), times = [], draws = [], longTasks = [], zooms = [], labelChanges = []
      let previous = performance.now(), frame = 0, lastLabels = host.dataset.labels
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)))
      observer.observe({ type: 'longtask', buffered: false })
      await new Promise(resolve => {
        const tick = now => {
          if (frame > 30) { times.push(now - previous); draws.push(Number(host.dataset.drawMs)) }
          previous = now
          if (frame < 360 && frame % 15 === 0) overlay.dispatchEvent(new WheelEvent('wheel', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, deltaY: -180, bubbles: true, cancelable: true }))
          if (frame >= 360 && frame < 720 && frame % 15 === 0) overlay.dispatchEvent(new WheelEvent('wheel', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, deltaY: 180, bubbles: true, cancelable: true }))
          if (frame % 15 === 14) zooms.push(camera().zoom)
          if (host.dataset.labels !== lastLabels) { labelChanges.push(frame); lastLabels = host.dataset.labels }
          if (frame++ < 750) requestAnimationFrame(tick); else resolve()
        }
        requestAnimationFrame(tick)
      })
      observer.disconnect()
      const percentile = (a, p) => a.sort((a, b) => a - b)[Math.min(a.length - 1, Math.floor(a.length * p))]
      return { visibility: document.visibilityState, renderer: host.dataset.renderer, markers: Number(host.dataset.points), frameP95: percentile(times, .95), frameP99: percentile(times, .99), drawP95: percentile(draws, .95), peakZoom: Math.max(...zooms), longTasks, cameraReturnError: Math.hypot(camera().x - initial.x, camera().y - initial.y), zoomReturnError: Math.abs(camera().zoom - initial.zoom), labelTransitions: labelChanges.length, jsHeapMiB: performance.memory?.usedJSHeapSize / 2 ** 20 }
    })
    report.phases.push(sample); console.log(JSON.stringify(sample))
    await writeFile(output + '/navigation-performance.json', JSON.stringify(report, null, 2))
  }
} finally { await browser.close() }
