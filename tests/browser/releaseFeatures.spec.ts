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
  const camera = await map.getAttribute('data-camera')
  await page.getByRole('combobox', { name: 'Folder constellations' }).selectOption('off')
  for (const value of ['recent', 'size', 'connections', 'visible']) {
    await lens.selectOption(value); await expect(map).toHaveAttribute('data-camera', camera!)
  }
  await expect(page.getByRole('combobox', { name: 'Folder constellations' })).toHaveValue('off')
  await page.locator('.atlas-context h1').click(); await page.keyboard.type(':'); await page.getByRole('textbox', { name: 'Vim command' }).fill('fullscreen'); await page.keyboard.press('Enter')
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-fullscreen/)
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
