import { labelFits, project, type Camera, type LabelBox } from './scene'

export interface MapLabel {
  id: string
  x: number
  y: number
  offset: number
  title: string
  subtitle?: string
  color: string
  font: string
  opacity: number
  priority: number
  selected?: boolean
  background?: boolean
}
interface Entry { label: MapLabel; opacity: number }

/** Retain readable labels, independent of hover; resolve collisions before fading. */
export class LabelPainter {
  private entries = new Map<string, Entry>()
  private lastAt = 0
  visibleIds: string[] = []

  draw(ctx: CanvasRenderingContext2D, candidates: MapLabel[], camera: Camera, width: number, height: number, budget: number): { count: number; pending: boolean } {
    const now = performance.now(), elapsed = this.lastAt ? Math.min(50, now - this.lastAt) : 16
    this.lastAt = now
    const current = new Map(candidates.map(label => [label.id, label]))
    for (const label of candidates) {
      const entry = this.entries.get(label.id)
      if (entry) entry.label = label
      else this.entries.set(label.id, { label, opacity: 0 })
    }
    const ordered = [...this.entries.values()].sort((a, b) =>
      Number(!!b.label.selected) - Number(!!a.label.selected) ||
      Number(b.opacity > .05) - Number(a.opacity > .05) ||
      b.label.priority - a.label.priority || a.label.id.localeCompare(b.label.id))
    const used: LabelBox[] = []
    let count = 0, pending = false
    this.visibleIds = []
    for (const entry of ordered) {
      const label = entry.label, [x, y] = project(label.x, label.y, camera, width, height)
      ctx.font = label.font
      const titleWidth = ctx.measureText(label.title).width
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
      const labelWidth = Math.max(titleWidth, label.subtitle ? ctx.measureText(label.subtitle).width : 0)
      // Clamp smoothly at the edge. Never flip the whole heading to the other side.
      const box = { x: Math.max(8, Math.min(width - labelWidth - 15, x + label.offset)), y: y - 10, width: labelWidth, height: label.subtitle ? 43 : 24 }
      let target = current.get(label.id)?.opacity ?? 0
      if (x < 0 || x > width || box.y < 8 || box.y + box.height > height - 65 || count >= budget || !labelFits(box, used)) target = 0
      entry.opacity += (target - entry.opacity) * (1 - Math.exp(-elapsed / 65))
      if (Math.abs(target - entry.opacity) < .008) entry.opacity = target
      else pending = true
      if (entry.opacity < .008 && target === 0) { this.entries.delete(label.id); continue }
      if (entry.opacity > .05 || target > .05) { used.push(box); count++ }
      if (entry.opacity > .5) this.visibleIds.push(label.id)
      ctx.globalAlpha = entry.opacity
      if (label.background) { ctx.fillStyle = '#0c1420df'; ctx.fillRect(box.x - 5, box.y - 4, box.width + 10, 24) }
      ctx.font = label.font; ctx.fillStyle = label.color
      ctx.shadowColor = '#080e16'; ctx.shadowBlur = label.background ? 0 : 7
      ctx.fillText(label.title, box.x, y + 6)
      ctx.shadowBlur = 0
      if (label.subtitle) {
        ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'; ctx.fillStyle = '#9aaabb'
        ctx.fillText(label.subtitle, box.x, y + 26)
      }
    }
    ctx.globalAlpha = 1
    return { count, pending }
  }
}
