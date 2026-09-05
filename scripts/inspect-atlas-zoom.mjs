import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.ATLAS_URL ?? 'http://127.0.0.1:5176'
const daemon = process.env.ATLAS_DAEMON ?? 'http://127.0.0.1:7376'
const output = '.atlas-real/zoom-feedback'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.ATLAS_HEADFUL })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
const errors = []; page.on('pageerror', e => errors.push(e.message))
await page.goto(base, { waitUntil: 'networkidle' })
const host = page.locator('.atlas-map'), box = await host.boundingBox()
const readCamera = async () => JSON.parse(await host.getAttribute('data-camera'))
const initial = await readCamera()
const summary = await fetch(daemon + '/api/atlas/summary').then(r => r.json())
const marker = [...summary.markers].sort((a, b) => Math.hypot(a.x - initial.x, a.y - initial.y) - Math.hypot(b.x - initial.x, b.y - initial.y))[0]
const anchor = { x: (marker.x - initial.x) * initial.zoom + box.width / 2, y: (marker.y - initial.y) * initial.zoom + box.height / 2 }
const mouseX = Math.round(box.x + anchor.x), mouseY = Math.round(box.y + anchor.y)
anchor.x = mouseX - box.x; anchor.y = mouseY - box.y
marker.x = (anchor.x - box.width / 2) / initial.zoom + initial.x
marker.y = (anchor.y - box.height / 2) / initial.zoom + initial.y
await page.mouse.move(mouseX, mouseY)
await page.screenshot({ path: output + '/galaxy.png' })
const frames = []
for (const direction of [-1, 1]) {
  for (let i = 0; i < 24; i++) {
    const before = await readCamera()
    await page.mouse.wheel(0, direction * 360)
    await page.waitForTimeout(220)
    const after = await readCamera()
    const screen = { x: (marker.x - after.x) * after.zoom + box.width / 2, y: (marker.y - after.y) * after.zoom + box.height / 2 }
    frames.push({ before: before.zoom, after: after.zoom, error: Math.hypot(screen.x - anchor.x, screen.y - anchor.y) })
    if (direction === -1 && [7, 15, 23].includes(i)) await page.screenshot({ path: output + '/zoom-' + i + '.png' })
  }
}
const result = { errors, steps: frames.length, peakZoom: Math.max(...frames.map(f => f.after)), maxAnchorError: Math.max(...frames.map(f => f.error)), initial, final: await readCamera(), monotonic: frames.every((f, i) => i < 24 ? f.after > f.before : f.after < f.before) }
await writeFile(output + '/continuity.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
await browser.close()
