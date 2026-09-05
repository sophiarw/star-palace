import { describe, expect, it } from 'vitest'
import { folderConstellations, MAX_FOLDER_DEGREE, type FolderPoint } from '../../src/daemon/atlas/folderConstellations'
import { visibleFolderEdges, FolderConstellationPainter } from '../../src/renderer/src/atlas/folderConstellations'
import type { AtlasFile, AtlasMarker } from '../../src/shared/atlas'

const point = (id: string, x: number, y = 0, path = `/library/project/${id}.md`): FolderPoint => ({ id, x, y, path })
const pairs = (graph: ReturnType<typeof folderConstellations>) => [...graph].flatMap(([id, links]) => links.filter(link => id < link.id).map(link => `${id}:${link.id}`)).sort()
const filesFor = (points: FolderPoint[]): AtlasFile[] => {
  const graph = folderConstellations(points)
  return points.map(file => ({ ...file, folderLinks: graph.get(file.id) ?? [] }) as AtlasFile)
}

describe('folder constellations', () => {
  it('joins only direct siblings and never infers a folder for missing/relative paths', () => {
    const graph = folderConstellations([point('a', 0), point('b', 30), point('nested', 10, 0, '/library/project/nested/a.md'),
      point('root2a', 0, 0, '/other/project/a.md'), point('root2b', 30, 0, '/other/project/b.md'),
      point('empty', 15, 0, ''), point('relative', 20, 0, 'a.md')])
    expect(pairs(graph)).toEqual(['a:b', 'root2a:root2b'])
  })
  it('is independent of row order, limits degree, and produces a forest without moving files', () => {
    const points = Array.from({ length: 200 }, (_, i) => point(`file-${i}`, Math.sin(i * 127) * 800, Math.cos(i * 113) * 800))
    const original = structuredClone(points), graph = folderConstellations(points)
    expect(pairs(graph)).toEqual(pairs(folderConstellations([...points].reverse())))
    expect(points).toEqual(original)
    expect(Math.max(...[...graph.values()].map(links => links.length))).toBeLessThanOrEqual(MAX_FOLDER_DEGREE)
    expect(pairs(graph).length).toBeLessThan(points.length)
    expect(pairs(graph).length).toBeGreaterThan(points.length / 2)
  })
  it('splits distant islands and rejects coincident or invalid coordinates', () => {
    const graph = folderConstellations([point('a', 0), point('b', 50), point('c', 10000), point('d', 10050), point('bad', NaN)])
    expect(pairs(graph)).toEqual(['a:b', 'c:d'])
    expect(pairs(folderConstellations([point('a', 0), point('b', 0)]))).toEqual([])
  })
  it('keeps full-folder neighbors during partial hydration and excludes filtered endpoints', () => {
    const files = filesFor([point('a', 0), point('b', 50), point('c', 100), point('d', 150)])
    const markers = files as unknown as AtlasMarker[]
    const full = visibleFolderEdges(files, markers, null)
    const partial = visibleFolderEdges(files.filter(file => ['a', 'c'].includes(file.id)), markers, null)
    expect(partial).toEqual(full)
    expect(visibleFolderEdges([files[0], files[3]], [markers[0], markers[3]], null)).toEqual([])
  })
  it('bounds a large folder to a sparse graph', () => {
    const points = Array.from({ length: 10000 }, (_, i) => point(String(i), i % 100 * 10, Math.floor(i / 100) * 10))
    const graph = folderConstellations(points)
    expect([...graph.values()].reduce((sum, links) => sum + links.length, 0)).toBeLessThanOrEqual(2 * (points.length - 1))
    expect(Math.max(...[...graph.values()].map(links => links.length))).toBeLessThanOrEqual(3)
  })
  it('settles fades, supports selected-folder/off controls, and leaves the camera untouched', () => {
    const files = filesFor([point('a', 0), point('b', 100)])
    const edges = visibleFolderEdges(files, [], 'a')
    const painter = new FolderConstellationPainter(), camera = { x: 0, y: 0, zoom: 1 }
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, globalAlpha: 1 } as unknown as CanvasRenderingContext2D
    const options = { visibility: 'all' as const, selectedFolder: null, highlights: new Set<string>(), reducedMotion: false }
    expect(painter.draw(ctx, edges, camera, 800, 600, options, 100).pending).toBe(true)
    expect(painter.draw(ctx, edges, camera, 800, 600, options, 300)).toEqual({ count: 1, pending: false })
    expect(painter.draw(ctx, edges, camera, 800, 600, { ...options, visibility: 'focus' }, 500)).toEqual({ count: 0, pending: false })
    expect(painter.draw(ctx, edges, camera, 800, 600, { ...options, visibility: 'focus', selectedFolder: '/library/project', reducedMotion: true }, 600).count).toBe(1)
    expect(painter.draw(ctx, edges, camera, 800, 600, { ...options, visibility: 'off', reducedMotion: true }, 700)).toEqual({ count: 0, pending: false })
    expect(camera).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})
