import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(process.env.STARPALACE_SITE_URL || 'http://127.0.0.1:5180')
  await page.waitForFunction(() => document.querySelectorAll('.file-star').length === 12)
  await page.locator('.hero-art').evaluate(image => image.decode())
  await page.locator('.site-header .mark').evaluate(image => image.decode())
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#030507'; ctx.fillRect(0, 0, 1200, 630)
    ctx.globalAlpha = .1; ctx.drawImage(document.querySelector('.hero-art'), 510, -120, 690, 737); ctx.globalAlpha = 1
    ctx.drawImage(document.querySelector('.site-header .mark'), 67, 45, 42, 52)
    ctx.fillStyle = '#f1f1e9'; ctx.font = '26px Georgia'; ctx.fillText('Star Palace', 127, 81)
    ctx.font = '54px Georgia'; ctx.fillText('A memory palace', 70, 238)
    ctx.fillStyle = '#ead2a0'; ctx.font = '52px Georgia'; ctx.fillText('for constellations', 70, 307); ctx.fillText('of files.', 70, 371)
    ctx.fillStyle = '#adb5c2'; ctx.font = '20px -apple-system, sans-serif'
    ctx.fillText('A search-first file browser.', 73, 450)
    ctx.fillStyle = '#91a0b3'; ctx.font = '16px -apple-system, sans-serif'; ctx.fillText('Mac · Local files · Source available', 73, 484)
    ctx.fillText('starpalace.ai', 73, 560)
    const x = 670, y = 165, width = 470, height = 365
    ctx.drawImage(document.querySelector('#galaxy'), x, y, width, height)
    document.querySelectorAll('.file-star').forEach(star => {
      const left = parseFloat(star.style.left) / 100 * width, top = parseFloat(star.style.top) / 100 * height
      ctx.drawImage(star.querySelector('canvas'), x + left - 39, y + top - 32.5, 78, 65)
    })
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await writeFile('website/public/social.png', Buffer.from(data, 'base64'))
  console.log('Wrote website/public/social.png (1200 × 630)')
} finally { await browser.close() }
