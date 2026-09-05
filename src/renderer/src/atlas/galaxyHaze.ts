import type { AtlasNebula } from '@shared/atlas'

/** Cached density and evidence-led clouds following actual file positions. */
export function galaxyHaze(points: { x: number; y: number }[], nebulae: AtlasNebula[] = []): { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number } | null {
  if (!points.length) return null
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y))
  const rangeX = Math.max(...points.map(p => p.x)) - minX, rangeY = Math.max(...points.map(p => p.y)) - minY
  const radius = Math.max(250, Math.min(1200, Math.max(rangeX, rangeY) * .035))
  const padding = Math.max(radius, nebulae.length ? 700 : 0)
  const width = rangeX + padding * 2, height = rangeY + padding * 2
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const kernel = document.createElement('canvas'); kernel.width = kernel.height = 64
  const brush = kernel.getContext('2d')!, gradient = brush.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, '#93b5ca16'); gradient.addColorStop(.3, '#6f90ae0b'); gradient.addColorStop(1, '#425d7900')
  brush.fillStyle = gradient; brush.fillRect(0, 0, 64, 64)
  ctx.scale(1024 / width, 1024 / height); ctx.translate(-minX + padding, -minY + padding)
  for (const point of points) ctx.drawImage(kernel, point.x - radius, point.y - radius, radius * 2, radius * 2)
  const brushes = new Map<string, HTMLCanvasElement>()
  for (const group of nebulae) {
    if (group.members.length < 3) continue
    let cloud = brushes.get(group.color)
    if (!cloud) {
      cloud = document.createElement('canvas'); cloud.width = cloud.height = 128
      const paint = cloud.getContext('2d')!, tint = paint.createRadialGradient(64, 64, 0, 64, 64, 64)
      tint.addColorStop(0, group.color + 'a6'); tint.addColorStop(.25, group.color + '61'); tint.addColorStop(.6, group.color + '14'); tint.addColorStop(1, group.color + '00')
      paint.fillStyle = tint; paint.fillRect(0, 0, 128, 128); brushes.set(group.color, cloud)
    }
    const xs = group.members.map(p => p.x), ys = group.members.map(p => p.y)
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    const r = Math.max(120, Math.min(700, span * .4))
    ctx.globalAlpha = .75 / Math.sqrt(group.members.length)
    for (const point of group.members) ctx.drawImage(cloud, point.x - r, point.y - r, r * 2, r * 2)
  }
  ctx.globalAlpha = 1
  return { canvas, x: minX - padding, y: minY - padding, width, height }
}
