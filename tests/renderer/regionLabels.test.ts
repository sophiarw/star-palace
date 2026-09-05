import { describe, expect, it } from 'vitest'
import { LabelPainter, type MapLabel } from '../../src/renderer/src/atlas/labelPainter'
import { skyLabels, skyLabelOpacity } from '../../src/renderer/src/atlas/regionLabels'
import type { AtlasRegion, AtlasMarker } from '../../src/shared/atlas'

describe('Hybrid sky headings', () => {
  it('forms deterministic nested spatial groups and names them from folder labels', () => {
    const regions = [{ id: 'r', label: 'Auris' }, { id: 'n', parentId: 'r', label: 'Notes' }] as AtlasRegion[]
    const markers = Array.from({ length: 30 }, (_, i) => ({ id: `file-${i}`, x: (i % 10) * 900, y: Math.floor(i / 10) * 1200, regionId: 'r', neighborhoodId: 'n' })) as AtlasMarker[]
    const original = structuredClone(markers), labels = skyLabels(markers, regions)
    expect(skyLabels([...markers].reverse(), regions)).toEqual(labels)
    expect(markers).toEqual(original)
    const broad = labels.filter(l => l.level === 'broad'), clusters = labels.filter(l => l.level === 'cluster')
    expect(broad.length).toBeGreaterThan(1)
    expect(clusters.length).toBeGreaterThan(broad.length)
    expect(broad.every(l => l.title === 'Auris')).toBe(true)
    expect(clusters.every(l => l.title === 'Notes' && broad.some(parent => l.members.every(m => parent.members.includes(m))))).toBe(true)
    for (const label of labels) {
      expect(skyLabelOpacity(label, .9)).toBe(0)
      for (const zoom of [.035, .045, .1, .12, .4, .85]) expect(Math.abs(skyLabelOpacity(label, zoom + .00001) - skyLabelOpacity(label, zoom - .00001))).toBeLessThan(.002)
    }
    expect(skyLabelOpacity({ level: 'broad', minZoom: 0 }, .02)).toBe(.85)
    expect(skyLabelOpacity({ level: 'cluster', minZoom: 0 }, .2)).toBe(.85)
  })

  it('keeps overlapping headings visible through zoom, selection, and a zero caption budget', () => {
    const drawn: { title: string; alpha: number; x: number }[] = []
    const ctx = { globalAlpha: 1, measureText: () => ({ width: 80 }), fillText(this: { globalAlpha: number }, title: string, x: number) { drawn.push({ title, alpha: this.globalAlpha, x }) } } as unknown as CanvasRenderingContext2D
    const painter = new LabelPainter()
    const heading: MapLabel = { id: 'a', x: 0, y: 0, offset: 10, title: 'Incoming', color: '#fff', font: '11px Georgia', opacity: .85, priority: 1, persistent: true }
    const captions = [heading, { ...heading, id: 'b', title: 'Research', x: 1 }, { ...heading, id: 'file', persistent: false, selected: true, title: 'Selected file' }]
    for (const zoom of [.003, .08, .17, .7, 1.31, 120, .1]) {
      drawn.length = 0
      const result = painter.draw(ctx, captions, { x: 0, y: 0, zoom }, 800, 600, 0)
      expect(painter.visibleIds).toEqual(['a', 'b'])
      expect(drawn.map(({ title, alpha }) => ({ title, alpha }))).toEqual([{ title: 'Incoming', alpha: .85 }, { title: 'Research', alpha: .85 }])
      expect(result.pending).toBe(false)
    }
    drawn.length = 0
    painter.draw(ctx, [heading], { x: 420, y: 0, zoom: 1 }, 800, 600, 0)
    expect(drawn[0].x).toBe(-10) // A partially clipped heading never sticks to the edge.
    painter.draw(ctx, [], { x: 0, y: 0, zoom: 1 }, 800, 600, 0)
    expect(painter.visibleIds).toEqual([])
  })
})
