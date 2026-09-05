import { expect, test } from '@playwright/test'

test('index revisions refresh an unchanged folder query without rerunning semantic search or clearing existing hits', async ({ page }) => {
  const file = (await page.request.get((process.env.STARPALACE_TEST_API ?? 'http://127.0.0.1:7374/api/atlas') + '/files?limit=1').then(response => response.json())).files[0]
  let revisionDelta = 0, exactRequests = 0, relatedRequests = 0, holdRefresh = false
  await page.route('**/api/atlas/summary*', async route => {
    const response = await route.fetch(), summary = await response.json()
    await route.fulfill({ json: { ...summary, revision: summary.revision + revisionDelta } })
  })
  await page.route('**/api/atlas/search', async route => {
    const request = route.request().postDataJSON()
    if (request.mode === 'related') { relatedRequests++; await route.fulfill({ json: { results: [], semanticAvailable: true } }); return }
    exactRequests++
    if (holdRefresh) await new Promise(resolve => setTimeout(resolve, 500))
    await route.fulfill({ json: { results: revisionDelta ? [{ file, reason: 'path', score: 70, snippet: '/fixture/Incoming/' + file.name, offset: 0 }] : [], semanticAvailable: true } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your atlas', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Search library' }).fill('Incoming')
  await page.getByRole('combobox', { name: 'Search mode' }).selectOption('all')
  await expect.poll(() => relatedRequests).toBe(1)
  await expect(page.locator('.atlas-result')).toHaveCount(0)
  revisionDelta = 1
  await expect(page.locator('.atlas-result')).toHaveCount(1, { timeout: 8000 })
  const before = exactRequests
  holdRefresh = true; revisionDelta = 2
  await expect.poll(() => exactRequests, { timeout: 8000 }).toBeGreaterThan(before)
  await expect(page.locator('.atlas-result')).toHaveCount(1)
  await page.waitForTimeout(600)
  await expect(page.locator('.atlas-result')).toHaveCount(1)
  expect(relatedRequests).toBe(1)
  await expect(page.getByRole('textbox', { name: 'Search library' })).toHaveValue('Incoming')
})
