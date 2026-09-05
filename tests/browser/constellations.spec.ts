import { expect, test } from '@playwright/test'
import type { AtlasFile, AtlasSummary } from '../../src/shared/atlas'

test('folder constellations remain stable through visibility controls and respect file filters', async ({ page }) => {
  const summary = await page.request.get('http://127.0.0.1:7374/api/atlas/summary').then(response => response.json()) as AtlasSummary
  const response = await page.request.get('http://127.0.0.1:7374/api/atlas/viewport?minX=-1000000&minY=-1000000&maxX=1000000&maxY=1000000')
  const { files } = await response.json() as { files: AtlasFile[] }
  const file = files.find(file => file.folderLinks?.some(link => {
    const distance = Math.hypot(file.x - link.x, file.y - link.y)
    return distance > 40 && distance < 500
  }))
  expect(file, 'The seeded fixture must expose full-folder graph links').toBeTruthy()
  const link = file!.folderLinks!.find(link => {
    const distance = Math.hypot(file!.x - link.x, file!.y - link.y)
    return distance > 40 && distance < 500
  })!
  await page.addInitScript(({ epoch, file, link }) => {
    localStorage.setItem(`starpalace.atlas.camera.continuous.${epoch}:{}`, JSON.stringify({ x: (file.x + link.x) / 2, y: (file.y + link.y) / 2, zoom: .8 }))
    localStorage.setItem('starpalace.atlas.selected', JSON.stringify(file.id))
  }, { epoch: summary.layoutEpoch ?? 0, file: file!, link })
  await page.goto('/')
  const scene = page.locator('.atlas-map'), control = page.getByRole('combobox', { name: 'Folder constellations' })
  await expect.poll(async () => Number(await scene.getAttribute('data-constellation-edges'))).toBeGreaterThan(0)
  await page.waitForTimeout(500)
  const camera = await scene.getAttribute('data-camera'), labels = await scene.getAttribute('data-labels')
  await control.selectOption('off')
  await expect(scene).toHaveAttribute('data-constellation-edges', '0')
  await expect(scene).toHaveAttribute('data-camera', camera!)
  await expect(scene).toHaveAttribute('data-labels', labels!)
  await control.selectOption('focus')
  await expect.poll(async () => Number(await scene.getAttribute('data-constellation-edges'))).toBeGreaterThan(0)
  await expect(scene).toHaveAttribute('data-camera', camera!)
  await control.selectOption('all')
  await expect.poll(async () => Number(await scene.getAttribute('data-constellation-edges'))).toBeGreaterThan(0)
  await expect(scene).toHaveAttribute('data-camera', camera!)
  await page.getByRole('combobox', { name: 'Filter by file type' }).selectOption('media')
  await expect(scene).toHaveAttribute('data-constellation-edges', '0')
})
