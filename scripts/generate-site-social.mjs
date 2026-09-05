import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.goto(process.env.STARPALACE_SITE_URL || 'http://127.0.0.1:5180')
  await page.waitForFunction(() => document.querySelectorAll('.file-star').length === 12)
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#0b1019'; ctx.fillRect(0, 0, 1200, 630)
    const glow = ctx.createRadialGradient(850, 300, 0, 850, 300, 550)
    glow.addColorStop(0, '#27364a'); glow.addColorStop(1, '#0b1019')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 1200, 630)
    let state = 174
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = i % 3 ? '#90a7c433' : '#e2cda533'
      ctx.beginPath(); ctx.arc(520 + random() * 700, random() * 630, random() * 1.2, 0, Math.PI * 2); ctx.fill()
    }
    ctx.drawImage(document.querySelector('.hero-mark'), 70, 33, 51, 60)
    ctx.fillStyle = '#e4c28b'; ctx.font = '26px Georgia'; ctx.fillText('Star Palace', 137, 73)
    ctx.fillStyle = '#ede9df'; ctx.font = '54px Georgia'; ctx.fillText('A memory palace', 70, 238)
    ctx.fillStyle = '#d6c4a7'; ctx.font = 'italic 51px Georgia'; ctx.fillText('for constellations', 70, 307); ctx.fillText('of files.', 70, 371)
    ctx.fillStyle = '#a5aab5'; ctx.font = '21px -apple-system, sans-serif'
    ctx.fillText('A search-first file browser.', 73, 447)
    ctx.fillText('Mac · Local files · Celestial objects', 73, 480)
    ctx.font = '16px -apple-system, sans-serif'; ctx.fillText('starpalace.ai', 73, 560)
    const positions = [[810,110],[1010,240],[770,330],[930,450],[1060,70]]
    document.querySelectorAll('.object-family canvas').forEach((object, i) => {
      const [x,y] = positions[i]; ctx.drawImage(object, x, y, 145, 121)
    })
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await writeFile('website/public/social.png', Buffer.from(data, 'base64'))
  console.log('Wrote website/public/social.png (1200 × 630)')
} finally { await browser.close() }
