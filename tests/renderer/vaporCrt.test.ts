import { describe, it, expect } from 'vitest'
import {
  drawScanlines,
  drawChromaticAberration,
} from '../../src/renderer/src/components/StarMap/vaporCrt'

// vitest test env is node — there's no Canvas2D. The two CRT helpers are
// pure draw routines that only touch a handful of ctx fields/methods, so
// a recording stub is enough to lock in the deck-spec contract (blend
// mode, fill colour, draw call shape) without pulling jsdom/canvas in.

interface FillRectCall { x: number; y: number; w: number; h: number }
interface ArcCall { cx: number; cy: number; r: number; start: number; end: number }
type Op =
  | { kind: 'save' }
  | { kind: 'restore' }
  | { kind: 'beginPath' }
  | { kind: 'fill' }
  | { kind: 'fillRect'; call: FillRectCall }
  | { kind: 'arc'; call: ArcCall }
  | { kind: 'set'; field: string; value: unknown }

interface StubCtx {
  ctx: CanvasRenderingContext2D
  ops: Op[]
}

function makeStubCtx(): StubCtx {
  const ops: Op[] = []
  const target: Record<string, unknown> = {
    save() { ops.push({ kind: 'save' }) },
    restore() { ops.push({ kind: 'restore' }) },
    beginPath() { ops.push({ kind: 'beginPath' }) },
    fill() { ops.push({ kind: 'fill' }) },
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ kind: 'fillRect', call: { x, y, w, h } })
    },
    arc(cx: number, cy: number, r: number, start: number, end: number) {
      ops.push({ kind: 'arc', call: { cx, cy, r, start, end } })
    },
  }
  const proxy = new Proxy(target, {
    set(t, k, v) {
      ops.push({ kind: 'set', field: String(k), value: v })
      t[String(k)] = v
      return true
    },
    get(t, k) {
      return t[String(k)]
    },
  })
  return { ctx: proxy as unknown as CanvasRenderingContext2D, ops }
}

describe('drawScanlines', () => {
  it('emits a 1-px-tall band every 3 px under multiply blend at 30% black', () => {
    const { ctx, ops } = makeStubCtx()
    drawScanlines(ctx, 100, 12)

    const fillRects = ops.filter((o): o is Extract<Op, { kind: 'fillRect' }> => o.kind === 'fillRect')
    // h=12 → y=0,3,6,9 → 4 bands
    expect(fillRects.length).toBe(4)
    expect(fillRects.map(o => o.call.y)).toEqual([0, 3, 6, 9])
    for (const f of fillRects) {
      expect(f.call.x).toBe(0)
      expect(f.call.h).toBe(1)
      expect(f.call.w).toBe(100)
    }

    const sets = ops.filter((o): o is Extract<Op, { kind: 'set' }> => o.kind === 'set')
    const blend = sets.find(o => o.field === 'globalCompositeOperation')
    const colour = sets.find(o => o.field === 'fillStyle')
    expect(blend?.value).toBe('multiply')
    expect(colour?.value).toBe('rgba(0,0,0,0.30)')

    expect(ops[0]).toEqual({ kind: 'save' })
    expect(ops[ops.length - 1]).toEqual({ kind: 'restore' })
  })

  it('paints zero bands when h is 0 (defensive against zero-sized canvas)', () => {
    const { ctx, ops } = makeStubCtx()
    drawScanlines(ctx, 100, 0)
    expect(ops.filter(o => o.kind === 'fillRect').length).toBe(0)
  })
})

describe('drawChromaticAberration', () => {
  it('paints magenta + cyan arcs at ±2 px under screen blend', () => {
    const { ctx, ops } = makeStubCtx()
    drawChromaticAberration(ctx, 50, 30, 10)

    const arcs = ops.filter((o): o is Extract<Op, { kind: 'arc' }> => o.kind === 'arc')
    expect(arcs.length).toBe(2)
    // Magenta first (left, cx-2), cyan second (right, cx+2). r * 0.6 = 6.
    expect(arcs[0].call).toMatchObject({ cx: 48, cy: 30, r: 6 })
    expect(arcs[1].call).toMatchObject({ cx: 52, cy: 30, r: 6 })

    const sets = ops.filter((o): o is Extract<Op, { kind: 'set' }> => o.kind === 'set')
    const blend = sets.find(o => o.field === 'globalCompositeOperation')
    expect(blend?.value).toBe('screen')

    const fillStyles = sets.filter(o => o.field === 'fillStyle').map(o => o.value)
    expect(fillStyles).toEqual([
      'rgba(255, 0, 122, 0.20)',
      'rgba(0, 245, 255, 0.20)',
    ])

    expect(ops[0]).toEqual({ kind: 'save' })
    expect(ops[ops.length - 1]).toEqual({ kind: 'restore' })
  })
})
