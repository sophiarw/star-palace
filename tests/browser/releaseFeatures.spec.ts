import { test, expect } from '@playwright/test'

test('fullscreen restores panels and camera, and search is an overlay', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Show library', exact: true }).click()
  const map = page.locator('.atlas-map')
  await expect(map).toHaveAttribute('data-camera', /zoom/)
  const camera = await map.getAttribute('data-camera')
  await page.getByRole('button', { name: 'Atlas fullscreen', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Library navigation' })).toBeHidden()
  const bounds = (await map.boundingBox())!
  expect(bounds.height).toBeGreaterThan(950); expect(bounds.width).toBeGreaterThan(1430)
  await expect(map).toHaveAttribute('data-camera', camera!)
  await page.keyboard.press('/')
  await expect(page.getByRole('textbox', { name: 'Search library' })).toBeFocused()
  await page.getByRole('textbox', { name: 'Search library' }).fill('memory')
  await page.keyboard.press('Escape')
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-fullscreen/)
  await page.keyboard.press('Escape')
  await expect(page.locator('.atlas-shell')).not.toHaveClass(/atlas-fullscreen /)
  await expect(page.getByRole('navigation', { name: 'Library navigation' })).toBeVisible()
  await expect(map).toHaveAttribute('data-camera', camera!)
})

test('lenses retain the camera and restore the user’s constellation setting', async ({ page }) => {
  await page.goto('/')
  const map = page.locator('.atlas-map'), lens = page.getByRole('combobox', { name: 'Wavelength lens' })
  await expect(map).toHaveAttribute('data-camera', /zoom/)
  await expect(map).toHaveAttribute('data-labels', /[a-f0-9]/) // Initial library fit must precede the comparison.
  const camera = await map.getAttribute('data-camera')
  await page.getByRole('combobox', { name: 'Folder constellations' }).selectOption('off')
  for (const value of ['recent', 'size', 'connections', 'visible']) {
    await lens.selectOption(value); await expect(map).toHaveAttribute('data-camera', camera!)
  }
  await expect(page.getByRole('combobox', { name: 'Folder constellations' })).toHaveValue('off')
  await page.locator('.atlas-context h1').click(); await page.keyboard.type(':'); await page.getByRole('textbox', { name: 'Vim command' }).fill('fullscreen'); await page.keyboard.press('Enter')
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-fullscreen/)
})

test('both renderers tint ordinary and favorite stars violet/red at overview and close-up', async ({ page }) => {
  await page.goto('/')
  const samples = await page.evaluate(async () => {
    const rendererPath = '/src/atlas/pointRenderer.ts', lensPath = '/src/atlas/lenses.ts'
    const { canvasRenderer, gpuRenderer } = await import(rendererPath)
    const { lensAppearance } = await import(lensPath)
    const samples: { kind: string; type: string; lens: string; zoom: number; rgb: number[] }[] = []
    for (const factory of [canvasRenderer, gpuRenderer]) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256
      const renderer = factory(canvas)
      if (!renderer) throw new Error('Chrome must provide WebGL2 for lens parity validation')
      const copy = document.createElement('canvas'); copy.width = copy.height = 256
      const ctx = copy.getContext('2d')!
      for (const type of ['main-sequence', 'pulsar', 'black-hole']) for (const lens of ['recent', 'size']) for (const zoom of [1, 20]) {
        const color = lensAppearance(lens, { size: 1024, modifiedAt: 100000000 }, 100000000).color
        renderer.setPoints([{ id: 'lens-fixture', x: 0, y: 0, radius: 25, stellar: true, sizeBytes: 1024 ** 2, objectType: type, zoomable: true, lensColor: color, color: '#fff', alpha: 1 }])
        renderer.draw({ x: 0, y: 0, zoom }, 256, 256, 1)
        ctx.clearRect(0, 0, 256, 256); ctx.drawImage(canvas, 0, 0)
        const pixels = ctx.getImageData(0, 0, 256, 256).data, rgb = [0, 0, 0]
        for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += pixels[i + c] * pixels[i + 3] / 255
        samples.push({ kind: renderer.kind, type, lens, zoom, rgb })
      }
      renderer.destroy()
    }
    return samples
  })
  expect(samples).toHaveLength(24)
  for (const sample of samples) {
    const [r, g, b] = sample.rgb
    expect(r + g + b, JSON.stringify(sample)).toBeGreaterThan(100)
    if (sample.lens === 'recent') { expect(b, JSON.stringify(sample)).toBeGreaterThan(r); expect(r, JSON.stringify(sample)).toBeGreaterThan(g) }
    else { expect(r, JSON.stringify(sample)).toBeGreaterThan(b); expect(r, JSON.stringify(sample)).toBeGreaterThan(g) }
  }
})

test('history explains source enablement and offers saved contents, diffs, and copy recovery', async ({ page }) => {
  const hash = 'a'.repeat(40)
  await page.route('**/api/atlas/history/file/*', route => route.fulfill({ json: { enabled: true, eligible: true, reason: null, versions: [{ id: hash, capturedAt: 1788610000000 }] } }))
  await page.route('**/api/atlas/history/file/*/' + hash, route => route.fulfill({ json: { content: 'An earlier draft', diff: '+An earlier draft' } }))
  await page.route('**/api/atlas/history/file/*/' + hash + '/copy', route => route.fulfill({ json: { path: '/fictional/draft.recovered.md' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.locator('.atlas-file-tile').first().click()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.locator('.atlas-history-content')).toHaveText('An earlier draft')
  await page.getByRole('button', { name: 'Changes since previous save' }).click()
  await expect(page.locator('.atlas-history-content')).toHaveText('+An earlier draft')
  await page.getByRole('button', { name: 'Restore a copy' }).click()
  await expect(page.getByRole('status')).toContainText('Recovered beside the original')
})

test('update control explains development-launch limitations and errors', async ({ page }) => {
  await page.route('**/api/atlas/update', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { state: 'idle', message: 'Updates follow the public main branch.' } })
    : route.fulfill({ status: 409, json: { error: 'Finish indexing before updating.' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Update Star Palace' }).click()
  await expect(page.getByRole('alert')).toContainText('Finish indexing')
})

test('every tutorial has readable steps and a loadable screenshot, including contextual links', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Tutorials', exact: true }).click()
  const select = page.getByRole('combobox', { name: 'Tutorial feature' })
  const options = await select.locator('option').evaluateAll(items => items.map(item => (item as HTMLOptionElement).value))
  for (const value of options) {
    await select.selectOption(value)
    await expect(page.locator('.atlas-tutorial li')).toHaveCount(3)
    await expect.poll(() => page.locator('.atlas-tutorial img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 100)).toBe(true)
  }
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Text history', exact: true }) }).getByRole('button', { name: 'Tutorial' }).click()
  await expect(select).toHaveValue('history')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
})

test('an update reconnects after Settings is closed', async ({ page }) => {
  let started = false, done = false
  await page.route('**/api/atlas/update', route => {
    if (route.request().method() === 'POST') started = true
    return route.fulfill({ json: { state: done ? 'done' : started ? 'installing' : 'idle', message: 'Fixture update status' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Update Star Palace' }).click()
  await expect.poll(() => started).toBe(true)
  await page.keyboard.press('Escape')
  const reload = page.waitForEvent('framenavigated', frame => frame === page.mainFrame())
  done = true; await reload
  expect(await page.evaluate(() => sessionStorage.getItem('starpalace.pending-update'))).toBeNull()
})
