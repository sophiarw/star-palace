import { expect, test, type Page } from '@playwright/test'

async function searchFor(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Search library' }).fill(text)
  await page.getByRole('combobox', { name: 'Search mode' }).selectOption('exact')
  await expect(page.locator('.atlas-result').first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your atlas', exact: true })).toBeVisible()
  await expect(page.locator('.atlas-region-nav button')).toHaveCount(4)
})

test('browse, search, read, and return preserves selection and a working map', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await searchFor(page, 'how places become memories')
  await page.locator('.atlas-result').first().click()
  await expect(page.locator('.atlas-document-title')).toContainText('how places become memories')
  await expect(page.locator('.atlas-reading-content')).toContainText('Landmarks before detail')
  await page.getByRole('button', { name: 'Expand ↗', exact: true }).click()
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-reading/)
  await page.getByRole('button', { name: '↙ Back to atlas', exact: true }).click()
  await expect(page.locator('.atlas-map')).toBeVisible()
  await expect(page.locator('.atlas-result.is-selected')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('typing n remains ordinary input and clearing cancels stale results', async ({ page }) => {
  await searchFor(page, 'attention')
  const field = page.getByRole('textbox', { name: 'Search library' })
  await field.press('End'); await field.press('n')
  await expect(field).toHaveValue('attentionn')
  await field.fill('attention')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.locator('.atlas-results')).toHaveCount(0)
  await page.waitForTimeout(350)
  await expect(page.locator('.atlas-results')).toHaveCount(0)
})

test('out-of-order responses cannot replace the current query', async ({ page }) => {
  await page.route('**/api/atlas/search', async route => {
    const request = route.request().postDataJSON() as { query: string; mode: string }
    if (request.mode === 'exact' && request.query === 'attention') {
      const response = await route.fetch()
      await new Promise(resolve => setTimeout(resolve, 600))
      await route.fulfill({ response })
    } else await route.continue()
  })
  await page.getByRole('textbox', { name: 'Search library' }).fill('attention')
  await page.getByRole('combobox', { name: 'Search mode' }).selectOption('exact')
  await page.waitForTimeout(100)
  await page.getByRole('textbox', { name: 'Search library' }).fill('inventory.csv')
  await expect(page.locator('.atlas-result').first()).toContainText('inventory.csv')
  await page.waitForTimeout(700)
  await expect(page.locator('.atlas-result').first()).toContainText('inventory.csv')
})

test('late-document search opens the real matching passage', async ({ page }) => {
  await searchFor(page, '"copper lantern"')
  await expect(page.locator('.atlas-result')).toHaveCount(1)
  await expect(page.locator('.atlas-result')).toContainText('copper lantern')
  await page.locator('.atlas-result').click()
  await expect(page.locator('.atlas-reading-content mark').first()).toHaveText('copper lantern')
  await expect(page.locator('.atlas-match-nav')).toContainText('1 of 1')
})

test('media stays browsable without an embedding and the image reader works', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Filter by file type' }).selectOption('media')
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await expect(page.locator('.atlas-file-tile')).toHaveCount(1)
  await page.locator('.atlas-file-tile').click()
  await expect(page.getByRole('img', { name: 'orbital-study.svg' })).toBeVisible()
  await page.getByRole('button', { name: 'Actual size', exact: true }).click()
  await page.getByRole('button', { name: 'Zoom image in' }).click()
  await expect(page.locator('.atlas-preview-tools')).toContainText('130%')
})

test('large CSV previews render a bounded number of rows', async ({ page }) => {
  await searchFor(page, 'inventory.csv')
  await page.locator('.atlas-result').first().click()
  await expect(page.locator('.atlas-data-table')).toBeVisible()
  expect(await page.locator('.atlas-data-table tbody tr').count()).toBeLessThanOrEqual(32)
  await page.locator('.atlas-table-wrap').evaluate(el => { el.scrollTop = 18000 })
  await expect(page.locator('.atlas-data-table')).toContainText('Item 500')
})

test('themes, saved places, and settings work with keyboard focus', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Atmosphere' }).selectOption('bio')
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-theme-bio/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '⌖ Save place', exact: true }).click()
  await expect(page.locator('.atlas-sidebar')).toContainText('Saved places')
  await page.reload()
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-theme-bio/)
})

test('GPU loss falls back to Canvas and idle scenes do not redraw continuously', async ({ page }) => {
  const scene = page.locator('.atlas-map')
  await expect(scene).toHaveAttribute('data-renderer', /WebGL2|Canvas2D/)
  if (await scene.getAttribute('data-renderer') === 'WebGL2') {
    await page.locator('.atlas-point-canvas').evaluate(canvas => {
      (canvas as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
    })
    await expect(scene).toHaveAttribute('data-renderer', 'Canvas2D')
  }
  await page.mouse.move(5, 5)
  await page.waitForTimeout(100)
  const before = Number(await scene.getAttribute('data-draws'))
  await page.waitForTimeout(1000)
  expect(Number(await scene.getAttribute('data-draws')) - before).toBeLessThanOrEqual(1)
})

test('small windows retain search and can expand the reader', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 })
  await searchFor(page, 'camera.ts')
  await page.locator('.atlas-result').first().click()
  await page.getByRole('textbox', { name: 'Search library' }).press('Escape')
  await page.keyboard.press('Enter')
  await expect(page.locator('.atlas-reader')).toBeVisible()
  await expect(page.locator('.atlas-code')).toContainText('zoomAt')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600)
})

test('celestial identities are intermixed and the object guide is accessible', async ({ page }) => {
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-object-types', /pulsar/)
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-object-types', /nebula/)
  await page.getByRole('button', { name: 'Object guide', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.atlas-object-guide canvas')).toHaveCount(10)
  await expect(dialog).toContainText('Black hole')
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThan(100)
  await page.keyboard.press('Escape')
  await searchFor(page, 'camera.ts')
  await page.locator('.atlas-result').first().click()
  await page.locator('.atlas-file-inspector summary').click()
  const select = page.getByRole('combobox', { name: 'Star type', exact: true })
  await select.selectOption('pulsar')
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-object-types', /pulsar/)
  await select.selectOption('')
  await expect(select).toHaveValue('')
})

test('zoom reveals deterministic per-file artwork with a bounded close-up cache', async ({ page }) => {
  await page.locator('.atlas-region-nav button').first().click()
  let destinations = page.getByRole('navigation', { name: 'Map destinations' })
  await destinations.getByRole('button').first().focus(); await page.keyboard.press('Enter')
  await expect(page.locator('.atlas-map-footer')).toContainText('Files')
  destinations = page.getByRole('navigation', { name: 'Map destinations' })
  await destinations.getByRole('button').first().focus(); await page.keyboard.press('Enter')
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect.poll(async () => Number(await page.locator('.atlas-point-canvas').getAttribute('data-detail-sprites'))).toBeGreaterThan(0)
  expect(Number(await page.locator('.atlas-point-canvas').getAttribute('data-detail-sprites'))).toBeLessThanOrEqual(16)
  const hashes = await page.evaluate(async () => {
    const source = '/src/atlas/detailSprites.ts'
    const { DetailSprites } = await import(source)
    const point = { x: 0, y: 0, radius: 25, zoomable: true, color: '#ffffff', alpha: 1, objectType: 'red-giant' }
    const hash = (id: string) => {
      const cache = new DetailSprites()
      cache.prepare([{ ...point, id }], { x: 0, y: 0, zoom: 15 }, 500, 500)
      return cache.sheet.toDataURL()
    }
    return { same: hash('file-a') === hash('file-a'), different: hash('file-a') !== hash('file-b') }
  })
  expect(hashes).toEqual({ same: true, different: true })
})
