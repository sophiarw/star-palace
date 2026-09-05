import { describe, expect, it } from 'vitest'
import { LabelPainter, type MapLabel } from '../../src/renderer/src/atlas/labelPainter'
import { clusterLabelRegions, regionLabelSize } from '../../src/renderer/src/atlas/regionLabels'
import type { AtlasRegion } from '../../src/shared/atlas'

describe('Persistent cluster headings', () => {
  it('keeps leaf names and childless regions instead of swapping hierarchy at zoom thresholds', () => {
    const regions = [{ id: 'root' }, { id: 'child', parentId: 'root' }, { id: 'only-root' }] as AtlasRegion[]
    expect(clusterLabelRegions(regions).map(r => r.id)).toEqual(['child', 'only-root'])
    expect(regionLabelSize(.003)).toBeLessThan(10.1)
    expect(regionLabelSize(120)).toBeLessThanOrEqual(14)
    for (const zoom of [.07, .09, .18, .22, .65, 1.3]) expect(Math.abs(regionLabelSize(zoom + .001) - regionLabelSize(zoom - .001))).toBeLessThan(.03)
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
