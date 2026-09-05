// Capture only the dedicated fictional library; never point this at a personal atlas.
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const base = 'http://127.0.0.1:5178'
const destination = 'src/renderer/public/tutorials'
const { galaxies: sources } = await fetch('http://127.0.0.1:7378/api/galaxies').then(response => response.json())
if (!Array.isArray(sources) || !sources.some(source => source.rootPath === resolve('.atlas-dev/features/library')) || sources.some(source => !source.rootPath.startsWith('__default__') && source.rootPath !== resolve('.atlas-dev/features/library'))) throw new Error('Tutorial capture requires only the dedicated fictional source.')
const only = new Set(process.argv.slice(2))
await mkdir(destination, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
page.setDefaultTimeout(12000)
const errors = []; page.on('pageerror', error => errors.push(String(error)))
await page.route('**/api/**', async route => {
  const response = await route.fetch()
  if (!(response.headers()['content-type'] ?? '').includes('application/json')) return route.fulfill({ response })
  const json = await response.json()
  function fictional(value) {
    if (Array.isArray(value)) return value.map(fictional)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, (key === 'path' || key === 'rootPath') && typeof v === 'string' ? v.replace(/^.*\/\.atlas-dev\/features\/library/, '/Users/you/Star Palace Demo') : fictional(v)]))
    return value
  }
  await route.fulfill({ response, json: fictional(json) })
})
const shot = async (name, locator) => {
  if (only.size && !only.has(name)) return
  await page.waitForTimeout(350)
  await (locator ?? page).screenshot({ path: `${destination}/${name}.png`, animations: 'disabled' })
  console.log('Captured', name)
}
const close = () => page.keyboard.press('Escape')
try {
  await page.goto(base)
  await expect(page.locator('.atlas-map')).toHaveAttribute('data-camera', /zoom/)
  await shot('atlas')
  await page.getByRole('button', { name: 'Atlas fullscreen', exact: true }).click(); await shot('fullscreen'); await close()
  await page.getByRole('combobox', { name: 'Wavelength lens' }).selectOption('recent'); await shot('lenses')
  await page.getByRole('combobox', { name: 'Wavelength lens' }).selectOption('connections'); await shot('connections')
  await page.getByRole('combobox', { name: 'Wavelength lens' }).selectOption('visible')
  await page.getByRole('textbox', { name: 'Search library' }).fill('memory')
  await expect(page.locator('.atlas-result').first()).toBeVisible(); await shot('search')
  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByRole('button', { name: 'Show library', exact: true }).click()
  await page.getByRole('button', { name: 'Manage sources' }).click(); await shot('sources', page.locator('dialog[open]')); await close()
  await page.getByRole('button', { name: 'Save place', exact: false }).click(); await shot('places')
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.locator('.atlas-file-tile').filter({ hasText: 'how-places-become-memories.md' }).first().click()
  await expect(page.locator('.atlas-reader-scroll')).toBeVisible()
  if (await page.getByRole('button', { name: '☆ Favorite', exact: true }).count()) await page.getByRole('button', { name: '☆ Favorite', exact: true }).click()
  await shot('favorites', page.locator('.atlas-reader'))
  await page.getByRole('button', { name: 'Expand ↗', exact: true }).click(); await shot('reader'); await page.getByRole('button', { name: '↙ Back to atlas', exact: true }).click()
  // Real capture in the isolated demo, then photograph its real history UI.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const checkbox = page.locator('.atlas-history-sources input[type="checkbox"]').first()
  if (!(await checkbox.isChecked())) await checkbox.click()
  await expect(checkbox).toBeChecked({ timeout: 15000 })
  await shot('updates', page.locator('dialog[open]'))
  await page.locator('summary').filter({ hasText: 'Ignored files and folders' }).click(); await shot('settings', page.locator('dialog[open]'))
  await page.locator('summary').filter({ hasText: 'Ignored files and folders' }).click()
  await page.locator('summary').filter({ hasText: 'Atlas snapshots' }).click(); await shot('snapshots', page.locator('dialog[open]')); await close()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Saved version' })).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.atlas-history-content')).not.toContainText('Loading saved version')
  await shot('history', page.locator('dialog[open]')); await close()
  await page.getByRole('button', { name: 'Create collection', exact: true }).click(); await shot('collections', page.locator('dialog[open]')); await close()
  await page.getByRole('button', { name: 'Commands', exact: false }).first().click(); await shot('vim', page.locator('dialog[open]')); await close()
  await page.goto(base + '/?view=classic'); await page.waitForTimeout(1500); await shot('advanced')
  if (errors.length) throw new Error(errors.join('\n'))
} finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); await browser.close() }
