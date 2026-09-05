import { expect, it } from 'vitest'
import { organicLayout, LEGACY_ATLAS_SCALE } from '../../src/daemon/atlas/organicLayout'

it('preserves the shape of existing projections, independent of file order', () => {
  const files = Array.from({ length: 200 }, (_, i) => ({ id: `file-${i}`, path: `/root/topic-${i % 5}/${i}.md`, x: Math.cos(i) * i * 3, y: Math.sin(i) * i * 2 }))
  const result = organicLayout(files)
  for (const file of files) expect(result.get(file.id)).toEqual({ x: file.x * LEGACY_ATLAS_SCALE, y: file.y * LEGACY_ATLAS_SCALE })
  expect(organicLayout([...files].reverse())).toEqual(result)
})

it('locates unprojected files by relationships and folders without inventing a geometric grid', () => {
  const files = [
    { id: 'topic-a', path: '/root/a/note.md', x: -200, y: 120 },
    { id: 'topic-b', path: '/root/b/note.md', x: 250, y: -80 },
    { id: 'image-a', path: '/root/a/images/photo.png', x: null, y: null },
    { id: 'related-b', path: '/elsewhere/text.md', x: null, y: null },
  ]
  const neighbors = new Map([['related-b', ['topic-b']]])
  const result = organicLayout(files, neighbors)
  expect(Math.hypot(result.get('image-a')!.x + 4000, result.get('image-a')!.y - 2400)).toBeLessThan(600)
  expect(Math.hypot(result.get('related-b')!.x - 5000, result.get('related-b')!.y + 1600)).toBeLessThan(600)
  expect(organicLayout([...files].reverse(), neighbors)).toEqual(result)
})

it('separates coincident projections locally and keeps model-free files accessible', () => {
  const files = Array.from({ length: 200 }, (_, i) => ({ id: `duplicate-${i}`, path: `/root/${i}.md`, x: 200, y: -100 }))
  const points = [...organicLayout(files).values()]
  for (let i = 0; i < points.length; i++) {
    expect(Math.hypot(points[i].x - 4000, points[i].y + 2000)).toBeLessThan(500)
    for (const previous of points.slice(0, i)) expect(Math.hypot(points[i].x - previous.x, points[i].y - previous.y)).toBeGreaterThanOrEqual(18 - 1e-8)
  }
  const fallback = organicLayout(files.map(f => ({ ...f, x: null, y: null })))
  expect(fallback.size).toBe(200)
  expect(new Set([...fallback.values()].map(p => `${p.x}:${p.y}`)).size).toBe(200)
})
