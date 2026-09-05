import { expect, test } from '@playwright/test'
import type { AtlasSummary } from '../../src/shared/atlas'

const api = process.env.STARPALACE_TEST_API ?? 'http://127.0.0.1:7374/api/atlas'

test('region visits isolate members, refit on repeat visits, and search crosses regions by default', async ({ page, request }) => {
  const summary: AtlasSummary = await (await request.get(api + '/summary')).json()
  const regions = summary.regions.filter(r => r.kind === 'region')
  const first = regions[0], other = regions[1]
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const map = page.locator('.atlas-map')
  await expect(map).toHaveAttribute('data-points', String(summary.markers!.length))
  await page.getByRole('button', { name: 'Show library', exact: true }).click()
  const visit = page.locator('.atlas-region-nav button').filter({ hasText: first.label })
  await visit.click()
  await expect(map).toHaveAttribute('data-points', String(first.count))
  const fitted = await map.getAttribute('data-camera')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(map).not.toHaveAttribute('data-camera', fitted!)
  await visit.click()
  await expect(map).toHaveAttribute('data-camera', fitted!)
  const bodies: Record<string, unknown>[] = []
  page.on('request', req => { if (req.url().endsWith('/search')) bodies.push(req.postDataJSON()) })
  await page.getByRole('textbox', { name: 'Search library' }).fill(other.label)
  await page.getByRole('combobox', { name: 'Search mode' }).selectOption('exact')
  await expect(page.locator('.atlas-result').first()).toBeVisible()
  expect(bodies.at(-1)?.regionId).toBeUndefined()
  await expect(map).toHaveAttribute('data-camera', fitted!)
  await page.getByRole('combobox', { name: 'Search area' }).selectOption('here')
  await expect.poll(() => bodies.at(-1)?.regionId).toBe(first.id)
  await page.getByRole('combobox', { name: 'Search area' }).selectOption('all')
  await expect(page.locator('.atlas-result').first()).toBeVisible()
  await page.locator('.atlas-result').first().click()
  await expect(page.locator('.atlas-document-title')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByRole('button', { name: 'Your atlas', exact: false }).click()
  await expect(map).toHaveAttribute('data-points', String(summary.markers!.length))
})

test('unhydrated overview stars have generous targets even over a region center', async ({ page, request }) => {
  const summary: AtlasSummary = await (await request.get(api + '/summary')).json()
  const star = summary.markers![0]
  const region = summary.regions.find(r => r.id === star.neighborhoodId)!
  await page.route('**/api/atlas/summary?*', route => route.fulfill({ json: { ...summary, markers: [star], nebulae: [], regions: [{ ...region, x: star.x + 200, y: star.y }] } }))
  await page.route('**/api/atlas/viewport?*', route => route.fulfill({ json: { files: [], revision: summary.revision } }))
  await page.addInitScript(({ epoch, star }) => localStorage.setItem(`starpalace.atlas.camera.continuous.${epoch}:{}`, JSON.stringify({ x: star.x, y: star.y, zoom: .1 })), { epoch: summary.layoutEpoch ?? 0, star })
  await page.goto('/')
  const map = page.locator('.atlas-map')
  await expect(map).toHaveAttribute('data-camera', /"zoom":0.1/)
  await expect(map).toHaveAttribute('data-hydrated', '0')
  const before = await map.getAttribute('data-camera'), box = (await map.boundingBox())!
  // Twenty CSS pixels from the star, directly on the competing region anchor.
  await page.mouse.click(box.x + box.width / 2 + 20, box.y + box.height / 2)
  await expect(page.locator('.atlas-document-title')).toBeVisible()
  await expect(map).toHaveAttribute('data-camera', before!)
})

test('extension filters affect files and search, and guide descriptions have readable spacing', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Filter by file extension' }).selectOption('.svg')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.locator('.atlas-file-tile')).toHaveCount(1)
  await expect(page.locator('.atlas-file-tile')).toContainText('.svg')
  await page.getByRole('textbox', { name: 'Search library' }).fill('orbital')
  await page.getByRole('combobox', { name: 'Search mode' }).selectOption('exact')
  await expect(page.locator('.atlas-file-tile')).toHaveCount(1)
  await page.getByRole('button', { name: 'Object guide', exact: true }).click()
  const row = page.locator('.atlas-object-guide > div').filter({ hasText: 'Similarity nebulae' })
  const spacing = await row.evaluate(el => ({ padding: parseFloat(getComputedStyle(el).paddingTop), font: parseFloat(getComputedStyle(el.querySelector('small')!).fontSize) }))
  expect(spacing.padding).toBeGreaterThanOrEqual(16); expect(spacing.font).toBeGreaterThanOrEqual(12)
  await page.setViewportSize({ width: 500, height: 850 })
  expect(await page.locator('.atlas-object-guide').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})

test('switching extension filters replaces markers even when counts and region geometry match', async ({ page, request }) => {
  const summary: AtlasSummary = await (await request.get(api + '/summary')).json()
  const [first, second] = summary.markers!
  await page.route('**/api/atlas/summary?*', route => {
    const filtered = new URL(route.request().url()).searchParams.get('extension') === '.txt'
    return route.fulfill({ json: { ...summary, extensions: [{ extension: '.txt', count: 1 }], markers: [{ ...(filtered ? second : first), x: 0, y: 0 }], nebulae: [] } })
  })
  await page.route('**/api/atlas/viewport?*', route => route.fulfill({ json: { files: [], revision: summary.revision } }))
  await page.addInitScript(epoch => {
    for (const scope of [{}, { extension: '.txt' }]) localStorage.setItem(`starpalace.atlas.camera.continuous.${epoch}:${JSON.stringify(scope)}`, JSON.stringify({ x: 0, y: 0, zoom: .02 }))
  }, summary.layoutEpoch ?? 0)
  await page.goto('/')
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-labels', new RegExp(first.id))
  await page.getByRole('combobox', { name: 'Filter by file extension' }).selectOption('.txt')
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-labels', new RegExp(second.id))
  await expect(page.locator('.atlas-map')).not.toHaveAttribute('data-labels', new RegExp(first.id))
})
