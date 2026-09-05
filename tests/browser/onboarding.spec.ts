import { expect, test } from '@playwright/test'

test('an empty library exposes a clickable first-folder action above the map canvases', async ({ page }) => {
  await page.route('**/api/atlas/summary**', route => route.fulfill({ json: { revision: 1, layoutEpoch: 0, total: 0, positioned: 0, searchable: 0, pending: 0, regions: [], markers: [], nebulae: [] } }))
  await page.goto('/')
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-points', '0')
  await page.getByRole('button', { name: 'Add your first folder', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByLabel('Folder path', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Index folder', exact: true })).toBeEnabled()
})
