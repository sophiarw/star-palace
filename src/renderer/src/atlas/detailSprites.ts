import { drawObject } from './celestialSprites'
import { objectRadius, project, seedFor, type Camera, type ScenePoint } from './scene'

export const DETAIL_FADE_START = 25
export const DETAIL_FADE_END = 42
export const DETAIL_CELL = 256
export const DETAIL_COLUMNS = 4
export const DETAIL_LIMIT = 16
export const DETAIL_BYTES = DETAIL_CELL ** 2 * DETAIL_LIMIT * 4

/** Close-up artwork is baked for visible files only; 16 slots bound CPU/GPU memory. */
export class DetailSprites {
  readonly sheet = document.createElement('canvas')
  private entries = new Map<string, { slot: number; used: number }>()
  private tick = 0
  private enabled = new Set<string>()
  constructor() { this.sheet.width = this.sheet.height = DETAIL_CELL * DETAIL_COLUMNS }
  prepare(points: ScenePoint[], camera: Camera, width: number, height: number): { uploads: { slot: number; image: HTMLCanvasElement }[]; pending: boolean } {
    const candidates = points.filter(point => {
      if (!point.objectType || !point.zoomable || objectRadius(point, camera.zoom) < DETAIL_FADE_START) return false
      const [x, y] = project(point.x, point.y, camera, width, height), r = objectRadius(point, camera.zoom)
      return x > -r && x < width + r && y > -r && y < height + r
    }).sort((a, b) => Math.hypot(a.x - camera.x, a.y - camera.y) - Math.hypot(b.x - camera.x, b.y - camera.y)).slice(0, DETAIL_LIMIT)
    const keyFor = (p: ScenePoint) => p.id + ':' + p.objectType
    this.enabled = new Set(candidates.map(keyFor))
    const uploads: { slot: number; image: HTMLCanvasElement }[] = []
    let pending = false
    for (const point of candidates) {
      const key = keyFor(point), cached = this.entries.get(key)
      if (cached) { cached.used = ++this.tick; continue }
      if (uploads.length >= 2) { pending = true; continue }
      let slot = this.entries.size
      if (slot >= DETAIL_LIMIT) {
        const oldest = [...this.entries].filter(([id]) => !this.enabled.has(id)).sort((a, b) => a[1].used - b[1].used)[0]
        if (!oldest) continue
        slot = oldest[1].slot; this.entries.delete(oldest[0])
      }
      const image = document.createElement('canvas'); image.width = image.height = DETAIL_CELL
      const ctx = image.getContext('2d')!
      ctx.scale(DETAIL_CELL / 128, DETAIL_CELL / 128); ctx.translate(64, 64)
      ctx.beginPath(); ctx.rect(-63, -63, 126, 126); ctx.clip()
      drawObject(ctx, point.objectType, seedFor(point.id), true)
      const sheet = this.sheet.getContext('2d')!, x = slot % DETAIL_COLUMNS * DETAIL_CELL, y = Math.floor(slot / DETAIL_COLUMNS) * DETAIL_CELL
      sheet.clearRect(x, y, DETAIL_CELL, DETAIL_CELL); sheet.drawImage(image, x, y)
      this.entries.set(key, { slot, used: ++this.tick }); uploads.push({ slot, image })
    }
    return { uploads, pending }
  }
  slot(point: ScenePoint): number {
    const key = point.id + ':' + point.objectType
    return this.enabled.has(key) ? this.entries.get(key)?.slot ?? -1 : -1
  }
  get count(): number { return this.entries.size }
}
