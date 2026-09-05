import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

await mkdir('.atlas-dev/screenshots', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' })
await page.screenshot({ path: '.atlas-dev/screenshots/overview.png' })
await page.getByRole('textbox', { name: 'Search library' }).fill('places become')
await page.getByRole('combobox', { name: 'Search mode' }).selectOption('exact')
await page.locator('.atlas-result').first().waitFor()
await page.locator('.atlas-result').first().click()
await page.locator('.atlas-reading-content h1').waitFor()
await page.screenshot({ path: '.atlas-dev/screenshots/search-preview.png' })
await page.getByRole('button', { name: 'Expand ↗', exact: true }).click()
await page.screenshot({ path: '.atlas-dev/screenshots/reader.png' })
console.log(JSON.stringify({ errors, title: await page.title(), screenshots: ['overview.png', 'search-preview.png', 'reader.png'] }, null, 2))
await browser.close()
