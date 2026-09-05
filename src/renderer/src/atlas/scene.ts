import type { StarType } from '@shared/types'
export interface Camera { x: number; y: number; zoom: number }
export interface ScenePoint { id: string; x: number; y: number; radius: number; color: string; alpha: number; objectType?: StarType; rotation?: number; zoomable?: boolean }
export interface LabelBox { x: number; y: number; width: number; height: number }

export function project(x: number, y: number, camera: Camera, width: number, height: number): [number, number] {
  return [(x - camera.x) * camera.zoom + width / 2, (y - camera.y) * camera.zoom + height / 2]
}
export function unproject(x: number, y: number, camera: Camera, width: number, height: number): [number, number] {
  return [(x - width / 2) / camera.zoom + camera.x, (y - height / 2) / camera.zoom + camera.y]
}
export function fitCamera(points: { x: number; y: number; radius?: number }[], width: number, height: number): Camera {
  if (!points.length) return { x: 0, y: 0, zoom: 0.3 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) { const r = p.radius ?? 20; minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r); minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r) }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom: Math.min(3, Math.max(0.005, Math.min((width - 150) / Math.max(100, maxX - minX), (height - 150) / Math.max(100, maxY - minY)))) }
}
export function labelFits(box: LabelBox, used: LabelBox[]): boolean {
  return !used.some(b => box.x < b.x + b.width + 12 && box.x + box.width + 12 > b.x && box.y < b.y + b.height + 7 && box.y + box.height + 7 > b.y)
}
export function seedFor(id: string): number {
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
  return seed >>> 0
}

export function objectRadius(point: Pick<ScenePoint, 'radius' | 'zoomable'>, zoom: number): number {
  return point.radius * (point.zoomable ? Math.max(.6, Math.min(8, Math.sqrt(zoom / 1.5))) : 1)
}
