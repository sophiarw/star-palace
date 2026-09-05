import { expect, test } from '@playwright/test'

test('rapid trackpad events move on the next frame without accumulating catch-up motion', async ({ page }) => {
  await page.goto('/')
  const scene = page.locator('.atlas-map')
  await expect(scene).toHaveAttribute('data-camera', /zoom/)
  await page.waitForTimeout(500)
  const result = await scene.evaluate(async host => {
    const canvas = host.querySelector('.atlas-label-canvas')!, box = host.getBoundingClientRect()
    const read = () => JSON.parse((host as HTMLElement).dataset.camera!) as { x: number; y: number; zoom: number }
    const original = read(), x = Math.round(box.x + box.width * .37) - box.x, y = Math.round(box.y + box.height * .43) - box.y
    const world = { x: original.x + (x - box.width / 2) / original.zoom, y: original.y + (y - box.height / 2) / original.zoom }
    const samples = []
    for (let frame = 0; frame < 12; frame++) {
      for (let event = 0; event < 8; event++) canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -2, clientX: box.x + x, clientY: box.y + y, bubbles: true, cancelable: true }))
      await new Promise(requestAnimationFrame)
      samples.push(read())
    }
    const stopped = read()
    await new Promise(resolve => setTimeout(resolve, 200))
    return { original, samples, stopped, settled: read(), world, x, y, width: box.width, height: box.height }
  })
  for (const [index, camera] of result.samples.entries()) {
    expect(camera.zoom / result.original.zoom).toBeCloseTo(Math.exp((index + 1) * 16 * .0015), 6)
    expect((result.world.x - camera.x) * camera.zoom + result.width / 2).toBeCloseTo(result.x, 5)
    expect((result.world.y - camera.y) * camera.zoom + result.height / 2).toBeCloseTo(result.y, 5)
  }
  expect(result.settled).toEqual(result.stopped)
})
