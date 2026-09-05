/** A cached density glow following actual file positions, with no imposed arms or clusters. */
export function galaxyHaze(points: { x: number; y: number }[]): { canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number } | null {
  if (!points.length) return null
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y))
  const rangeX = Math.max(...points.map(p => p.x)) - minX, rangeY = Math.max(...points.map(p => p.y)) - minY
  const radius = Math.max(250, Math.min(1200, Math.max(rangeX, rangeY) * .035))
  const width = rangeX + radius * 2, height = rangeY + radius * 2
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const kernel = document.createElement('canvas'); kernel.width = kernel.height = 64
  const brush = kernel.getContext('2d')!, gradient = brush.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, '#93b5ca16'); gradient.addColorStop(.3, '#6f90ae0b'); gradient.addColorStop(1, '#425d7900')
  brush.fillStyle = gradient; brush.fillRect(0, 0, 64, 64)
  ctx.scale(1024 / width, 1024 / height); ctx.translate(-minX + radius, -minY + radius)
  for (const point of points) ctx.drawImage(kernel, point.x - radius, point.y - radius, radius * 2, radius * 2)
  return { canvas, x: minX - radius, y: minY - radius, width, height }
}
