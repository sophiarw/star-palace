import { test, expect, type Page } from '@playwright/test'

const markdownFixture = '# Field notes\n\nOpening notes.\n\n## Methods\n\nA quiet starting point.\n\n### Measurements\n\nA moon within Methods.\n\n## Findings\n\nThe relevant passage.\n\n## Findings\n\nThe second, different passage.\n\n```markdown\n## Not a planet\n```\n'
async function openDocument(page: Page, text = markdownFixture, planetCount = 3) {
  await page.route('**/api/atlas/file/*/text', route => route.fulfill({ json: { content: text, status: 'ready', error: null, mimeType: 'text/markdown', truncated: false, size: text.length } }))
  await page.goto('/')
  await page.getByRole('textbox', { name: 'Search library' }).fill('how-places-become-memories')
  await page.locator('.atlas-result').first().click()
  await page.getByRole('button', { name: 'Explore solar system', exact: true }).click()
  await expect(page.locator('.atlas-section-planet')).toHaveCount(planetCount)
}

test('planets and moons open exact Markdown passages; editing uses that line and return preserves the system', async ({ page }) => {
  const edits: unknown[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/atlas/file/*/edit', route => { edits.push(route.request().postDataJSON()); return route.fulfill({ json: { editor: 'nvim' } }) })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openDocument(page)
  await expect(page.getByRole('button', { name: 'Resume orbits' })).toBeVisible()
  const map = page.locator('.atlas-map'), camera = await map.getAttribute('data-camera')
  const planets = await page.locator('.atlas-section-planet').evaluateAll(elements => elements.map(el => el.getAttribute('data-section-id')))
  await page.getByRole('button', { name: 'Read section: Findings, line 17', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('#section-line-17')).toBeFocused()
  await expect(page.locator('.atlas-shell')).toHaveClass(/atlas-reading/)
  await page.getByRole('button', { name: 'Edit section in Vim ↗', exact: true }).click()
  expect(edits).toEqual([{ line: 17, sourceLine: '## Findings', contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) }])
  await page.locator('#section-line-17').focus(); await page.keyboard.press('Space'); await page.keyboard.press('e')
  await expect.poll(() => edits.length).toBe(2)
  expect(edits[1]).toEqual(edits[0])
  await page.getByRole('button', { name: '← Back to solar system', exact: true }).click()
  expect(await page.locator('.atlas-section-planet').evaluateAll(elements => elements.map(el => el.getAttribute('data-section-id')))).toEqual(planets)
  await page.getByRole('button', { name: 'Read section: Methods, line 5', exact: true }).focus()
  await page.getByRole('navigation', { name: 'Section moons' }).getByRole('button', { name: 'Measurements' }).click()
  await expect(page.locator('#section-line-9')).toBeFocused()
  await page.getByRole('button', { name: '↙ Back to atlas', exact: true }).click()
  if (camera !== null) await expect(map).toHaveAttribute('data-camera', camera)
  expect(errors).toEqual([])
})

test('orbits move slowly, freeze under the pointer, and stay paused on demand', async ({ page }) => {
  await openDocument(page)
  const stage = page.locator('.atlas-solar-stage'), first = page.locator('.atlas-section-planet').first()
  await page.mouse.move(5, 5)
  await expect.poll(async () => Number(await stage.getAttribute('data-orbit-time'))).not.toBeNaN()
  const before = await first.getAttribute('data-orbit-x')
  await page.waitForTimeout(250)
  expect(await first.getAttribute('data-orbit-x')).not.toBe(before)
  const bounds = (await stage.boundingBox())!
  await page.mouse.move(bounds.x + 8, bounds.y + 8); await page.waitForTimeout(80)
  const held = await stage.getAttribute('data-orbit-time')
  await page.waitForTimeout(200); expect(await stage.getAttribute('data-orbit-time')).toBe(held)
  await page.getByRole('button', { name: 'Pause orbits', exact: true }).click(); await page.mouse.move(5, 5); await page.waitForTimeout(80)
  const paused = await stage.getAttribute('data-orbit-time')
  await page.waitForTimeout(200); expect(await stage.getAttribute('data-orbit-time')).toBe(paused)
  expect(Number(await stage.getAttribute('data-generated'))).toBeLessThanOrEqual(12)
})

test('refresh retains an edited section identity and stale editing errors are visible', async ({ page }) => {
  let content = markdownFixture
  await openDocument(page)
  const original = await page.locator('.atlas-section-planet').first().getAttribute('data-section-id')
  await page.route('**/api/atlas/file/*/text', route => route.fulfill({ json: { content, status: 'ready', error: null, mimeType: 'text/markdown', truncated: false } }))
  await page.route('**/api/atlas/file/*/refresh-text', async route => {
    content = markdownFixture.replace('## Methods', '## Observations')
    const id = route.request().url().split('/').at(-2)!
    const file = await page.request.get((process.env.STARPALACE_TEST_API ?? 'http://127.0.0.1:7378/api/atlas') + '/file/' + id).then(r => r.json())
    await route.fulfill({ json: { file } })
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Refresh document', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Read section: Observations, line 5', exact: true })).toHaveAttribute('data-section-id', original!)
  await page.route('**/api/atlas/file/*/edit', route => route.fulfill({ status: 409, json: { error: 'This section changed on disk. Refresh the document before editing this passage.' } }))
  await page.getByRole('button', { name: 'Edit section in Vim ↗', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed on disk')
})

test('large outlines page planets and remain usable in a narrow window without WebGL', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 850 })
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) { return type.startsWith('webgl') ? null : Reflect.apply(original, this, [type, ...args]) } as typeof original
  })
  const text = '# Many sections\n\n' + Array.from({ length: 27 }, (_, i) => `## Part ${i + 1}\n\nContents ${i + 1}\n`).join('\n')
  await page.route('**/api/atlas/file/*/text', route => route.fulfill({ json: { content: text, status: 'ready', error: null, truncated: false } }))
  await page.goto('/'); await page.getByRole('button', { name: 'List', exact: true }).click(); await page.locator('.atlas-file-tile').filter({ hasText: 'how-places-become-memories.md' }).click()
  await page.getByRole('button', { name: 'Explore solar system' }).click()
  await expect(page.locator('.atlas-section-planet')).toHaveCount(12)
  await page.getByRole('button', { name: 'Next planets' }).click(); await page.getByRole('button', { name: 'Next planets' }).click()
  await expect(page.locator('.atlas-section-planet')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(500)
  await page.getByRole('navigation', { name: 'Section planets' }).getByRole('button', { name: 'Part 27' }).click()
  await expect(page.locator('[data-section-line]').filter({ hasText: 'Part 27' })).toBeFocused()
})

test('Markdown without headings has a readable Contents planet', async ({ page }) => {
  await openDocument(page, 'A short note without any headings.', 1)
  await page.getByRole('button', { name: 'Read section: Contents, line 1', exact: true }).click()
  await expect(page.locator('.atlas-reading-content')).toBeFocused()
  await expect(page.locator('.atlas-reading-content')).toHaveText('A short note without any headings.')
})
