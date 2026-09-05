import { expect, test } from '@playwright/test'

test('canonical GPU and Canvas stars retain equivalent luminous halos through close-up blending', async ({ page }) => {
  await page.goto('/')
  await page.setContent('<canvas id="gpu" width="400" height="250"></canvas><canvas id="cpu" width="400" height="250"></canvas>')
  const result = await page.evaluate(async () => {
    const module = '/src/atlas/pointRenderer.ts'
    const { gpuRenderer, canvasRenderer } = await import(module)
    const gpuCanvas = document.querySelector<HTMLCanvasElement>('#gpu')!, cpuCanvas = document.querySelector<HTMLCanvasElement>('#cpu')!
    const gpu = gpuRenderer(gpuCanvas), cpu = canvasRenderer(cpuCanvas)
    if (!gpu) return { supported: false, ratios: [] as number[] }
    const point = { id: 'stable-file', x: 0, y: 0, radius: 25, zoomable: true, stellar: true, sizeBytes: 2 ** 24, objectType: 'main-sequence', color: '#ffffff', alpha: 1 }
    gpu.setPoints([point]); cpu.setPoints([point])
    const energy = (canvas: HTMLCanvasElement) => {
      const target = document.createElement('canvas'); target.width = 400; target.height = 250
      const ctx = target.getContext('2d')!; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 400, 250); ctx.drawImage(canvas, 0, 0)
      const pixels = ctx.getImageData(0, 0, 400, 250).data
      let sum = 0
      // Exclude the white core: this specifically guards translucent halo composition.
      for (let y = 90; y < 160; y++) for (let x = 165; x < 235; x++) if (Math.hypot(x - 200, y - 125) > 10) {
        const at = (y * 400 + x) * 4; sum += pixels[at] + pixels[at + 1] + pixels[at + 2]
      }
      return sum
    }
    const ratios: number[] = []
    for (const zoom of [.5, 1, 2, 4]) {
      gpu.draw({ x: 0, y: 0, zoom }, 400, 250, 1); const gpuEnergy = energy(gpuCanvas)
      cpu.draw({ x: 0, y: 0, zoom }, 400, 250, 1); const cpuEnergy = energy(cpuCanvas)
      ratios.push(gpuEnergy / Math.max(1, cpuEnergy))
    }
    gpu.destroy(); cpu.destroy()
    return { supported: true, ratios }
  })
  test.skip(!result.supported, 'WebGL2 unavailable on this browser')
  for (const ratio of result.ratios) { expect(ratio).toBeGreaterThan(.7); expect(ratio).toBeLessThan(1.3) }
})

test('canonical per-file details are deterministic and retain a sixteen-slot generation budget', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const module = '/src/atlas/detailSprites.ts'
    const { DetailSprites } = await import(module)
    const point = { x: 0, y: 0, radius: 25, zoomable: true, stellar: true, sizeBytes: 2 ** 30, color: '#ffffff', alpha: 1, objectType: 'main-sequence' }
    const hash = (id: string) => {
      const cache = new DetailSprites(); cache.prepare([{ ...point, id }], { x: 0, y: 0, zoom: 15 }, 500, 500)
      return cache.sheet.toDataURL()
    }
    const cache = new DetailSprites(), points = Array.from({ length: 40 }, (_, i) => ({ ...point, id: 'file-' + i, x: i - 20 }))
    let maxUploads = 0
    for (let i = 0; i < 24; i++) maxUploads = Math.max(maxUploads, cache.prepare(points, { x: 0, y: 0, zoom: 15 }, 500, 500).uploads.length)
    return { same: hash('file-a') === hash('file-a'), different: hash('file-a') !== hash('file-b'), count: cache.count, maxUploads }
  })
  expect(result).toEqual({ same: true, different: true, count: 16, maxUploads: 2 })
})
