// Autonomous test harness — synthetic input + scenario runner.
//
// Lets a Claude session (or any external script) drive the renderer like a
// human via `claude-in-chrome` MCP `javascript_tool`:
//
//   await window.__driver.runScenario('mousePan', [
//     { kind: 'mouseDrag', dx: 600, dy: 0, durationMs: 1000 },
//   ])
//
// or the predefined battery:
//
//   await window.__driver.runAll()
//
// Module-scope side effect attaches `window.__driver` (this object) and
// `window.__perf` (the existing `frameMetrics` singleton) so the JS-tool
// caller doesn't need to import anything.
//
// Synthetic events are native DOM events dispatched on the canvas (or
// window for keyboard) with `bubbles: true` — React's root delegation
// picks them up the same way as real input. preventDefault() inside the
// renderer's handlers (e.g. handleWheel) still works.

import { frameMetrics, type FrameSnapshot } from './frameMetrics'

export interface ScenarioReport {
  name: string
  startedAt: number
  finishedAt: number
  durationMs: number
  snapshot: FrameSnapshot
}

export type ScenarioStep =
  | { kind: 'sleep'; ms: number }
  | { kind: 'mouseDrag'; fromX?: number; fromY?: number; dx: number; dy: number; durationMs?: number; steps?: number }
  | { kind: 'wheel'; x?: number; y?: number; deltaY: number; count?: number; intervalMs?: number }
  | { kind: 'tapKey'; key: string; shift?: boolean; meta?: boolean; ctrl?: boolean }
  | { kind: 'holdKey'; key: string; durationMs: number; shift?: boolean }
  | { kind: 'click'; x?: number; y?: number; button?: number }
  | { kind: 'type'; text: string; intervalMs?: number }

export interface PerfDriverOptions {
  // Selector resolving to the canvas. Defaults to first <canvas>.
  canvasSelector?: string
  // Override the keyboard event target — useful for tests. Defaults to window.
  keyTarget?: EventTarget
  // Override clock — useful for tests. Defaults to performance.now / setTimeout.
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  // Recorder hook — every dispatched event is mirrored to this callback so
  // tests can assert payload shape without rendering the React tree.
  recorder?: (kind: string, payload: Record<string, unknown>) => void
}

const DEFAULT_DRAG_STEPS = 30
const DEFAULT_DRAG_DURATION_MS = 600
const DEFAULT_WHEEL_COUNT = 1
const DEFAULT_WHEEL_INTERVAL_MS = 16
const DEFAULT_TYPE_INTERVAL_MS = 30

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

export class PerfDriver {
  private opts: Required<PerfDriverOptions>

  constructor(options: PerfDriverOptions = {}) {
    this.opts = {
      canvasSelector: options.canvasSelector ?? 'canvas',
      keyTarget: options.keyTarget ?? (typeof window !== 'undefined' ? window : (null as unknown as EventTarget)),
      now: options.now ?? defaultNow,
      sleep: options.sleep ?? defaultSleep,
      recorder: options.recorder ?? (() => { /* no-op */ }),
    }
  }

  private resolveCanvas(): { el: HTMLCanvasElement; cx: number; cy: number; w: number; h: number } | null {
    if (typeof document === 'undefined') return null
    const el = document.querySelector(this.opts.canvasSelector) as HTMLCanvasElement | null
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height }
  }

  // -------- synthetic input --------

  async mouseDrag(opts: { fromX?: number; fromY?: number; dx: number; dy: number; durationMs?: number; steps?: number }): Promise<void> {
    const ctx = this.resolveCanvas()
    if (!ctx) throw new Error('PerfDriver.mouseDrag: canvas not found')
    const x0 = opts.fromX ?? ctx.cx
    const y0 = opts.fromY ?? ctx.cy
    const steps = opts.steps ?? DEFAULT_DRAG_STEPS
    const duration = opts.durationMs ?? DEFAULT_DRAG_DURATION_MS
    const dwell = duration / steps

    this.dispatchMouse(ctx.el, 'mousedown', x0, y0, 0)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const x = x0 + opts.dx * t
      const y = y0 + opts.dy * t
      this.dispatchMouse(ctx.el, 'mousemove', x, y, 0)
      await this.opts.sleep(dwell)
    }
    this.dispatchMouse(ctx.el, 'mouseup', x0 + opts.dx, y0 + opts.dy, 0)
  }

  async wheel(opts: { x?: number; y?: number; deltaY: number; count?: number; intervalMs?: number }): Promise<void> {
    const ctx = this.resolveCanvas()
    if (!ctx) throw new Error('PerfDriver.wheel: canvas not found')
    const x = opts.x ?? ctx.cx
    const y = opts.y ?? ctx.cy
    const count = opts.count ?? DEFAULT_WHEEL_COUNT
    const interval = opts.intervalMs ?? DEFAULT_WHEEL_INTERVAL_MS
    for (let i = 0; i < count; i++) {
      this.dispatchWheel(ctx.el, x, y, opts.deltaY)
      if (i < count - 1) await this.opts.sleep(interval)
    }
  }

  async tapKey(key: string, modifiers: { shift?: boolean; meta?: boolean; ctrl?: boolean } = {}): Promise<void> {
    this.dispatchKey('keydown', key, modifiers)
    await this.opts.sleep(8)
    this.dispatchKey('keyup', key, modifiers)
  }

  async holdKey(key: string, durationMs: number, modifiers: { shift?: boolean } = {}): Promise<void> {
    this.dispatchKey('keydown', key, modifiers)
    await this.opts.sleep(durationMs)
    this.dispatchKey('keyup', key, modifiers)
  }

  async click(opts: { x?: number; y?: number; button?: number } = {}): Promise<void> {
    const ctx = this.resolveCanvas()
    if (!ctx) throw new Error('PerfDriver.click: canvas not found')
    const x = opts.x ?? ctx.cx
    const y = opts.y ?? ctx.cy
    const button = opts.button ?? 0
    this.dispatchMouse(ctx.el, 'mousedown', x, y, button)
    this.dispatchMouse(ctx.el, 'mouseup', x, y, button)
    this.dispatchMouse(ctx.el, 'click', x, y, button)
  }

  async type(text: string, intervalMs = DEFAULT_TYPE_INTERVAL_MS): Promise<void> {
    for (const ch of text) {
      this.dispatchKey('keydown', ch, {})
      this.dispatchKey('keyup', ch, {})
      if (intervalMs > 0) await this.opts.sleep(intervalMs)
    }
  }

  sleep(ms: number): Promise<void> {
    return this.opts.sleep(ms)
  }

  // -------- internals --------

  private dispatchMouse(el: EventTarget, type: string, x: number, y: number, button: number): void {
    const payload = { type, clientX: x, clientY: y, button, bubbles: true, cancelable: true } as const
    this.opts.recorder('mouse', payload)
    if (typeof MouseEvent !== 'undefined') {
      el.dispatchEvent(new MouseEvent(type, payload))
    }
  }

  private dispatchWheel(el: EventTarget, x: number, y: number, deltaY: number): void {
    const payload = { clientX: x, clientY: y, deltaY, bubbles: true, cancelable: true } as const
    this.opts.recorder('wheel', payload)
    if (typeof WheelEvent !== 'undefined') {
      el.dispatchEvent(new WheelEvent('wheel', payload))
    }
  }

  private dispatchKey(type: 'keydown' | 'keyup', key: string, mods: { shift?: boolean; meta?: boolean; ctrl?: boolean }): void {
    const payload = {
      key,
      shiftKey: !!mods.shift,
      metaKey: !!mods.meta,
      ctrlKey: !!mods.ctrl,
      bubbles: true,
      cancelable: true,
    }
    this.opts.recorder('key', { type, ...payload })
    if (typeof KeyboardEvent !== 'undefined' && this.opts.keyTarget) {
      this.opts.keyTarget.dispatchEvent(new KeyboardEvent(type, payload))
    }
  }

  // -------- scenario runner --------

  async runStep(step: ScenarioStep): Promise<void> {
    switch (step.kind) {
      case 'sleep': await this.opts.sleep(step.ms); return
      case 'mouseDrag': await this.mouseDrag(step); return
      case 'wheel': await this.wheel(step); return
      case 'tapKey': await this.tapKey(step.key, { shift: step.shift, meta: step.meta, ctrl: step.ctrl }); return
      case 'holdKey': await this.holdKey(step.key, step.durationMs, { shift: step.shift }); return
      case 'click': await this.click(step); return
      case 'type': await this.type(step.text, step.intervalMs); return
    }
  }

  async runScenario(name: string, steps: ScenarioStep[]): Promise<ScenarioReport> {
    frameMetrics.reset()
    const startedAt = this.opts.now()
    for (const step of steps) await this.runStep(step)
    // Give the rAF loop a couple ticks to write its last frame's delta.
    await this.opts.sleep(64)
    const finishedAt = this.opts.now()
    return {
      name,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      snapshot: frameMetrics.snapshot(),
    }
  }

  async runAll(): Promise<ScenarioReport[]> {
    const battery: { name: string; steps: ScenarioStep[] }[] = [
      { name: 'idle', steps: [{ kind: 'sleep', ms: 2000 }] },
      { name: 'mousePan', steps: [{ kind: 'mouseDrag', dx: 600, dy: 0, durationMs: 1000 }] },
      { name: 'vimPan', steps: [{ kind: 'holdKey', key: 'l', durationMs: 1000 }] },
      { name: 'wheelZoom', steps: [{ kind: 'wheel', deltaY: -100, count: 20, intervalMs: 30 }] },
      { name: 'selectStar', steps: [{ kind: 'click' }, { kind: 'sleep', ms: 600 }] },
      { name: 'searchFlow', steps: [
        { kind: 'tapKey', key: 'f', meta: true },
        { kind: 'sleep', ms: 200 },
        { kind: 'type', text: 'the' },
        { kind: 'sleep', ms: 600 },
        { kind: 'tapKey', key: 'Escape' },
      ] },
      { name: 'qualityCycle', steps: [] },  // populated below
      { name: 'themeFlip', steps: [] },     // populated below
    ]

    // qualityCycle + themeFlip drive the StatsBar pill row by clicking on
    // labelled buttons. Resolve at runtime so the test harness can stub.
    const qualityScenario = battery.find(s => s.name === 'qualityCycle')!
    qualityScenario.steps = await this.buildPillCycle(['Low', 'Med', 'High', 'Ultra'], 800)
    const themeScenario = battery.find(s => s.name === 'themeFlip')!
    themeScenario.steps = await this.buildThemeFlip()

    const reports: ScenarioReport[] = []
    for (const s of battery) {
      reports.push(await this.runScenario(s.name, s.steps))
      // Idle settle between scenarios so one's tail doesn't pollute the next.
      await this.opts.sleep(300)
    }
    return reports
  }

  private async buildPillCycle(labels: string[], dwellMs: number): Promise<ScenarioStep[]> {
    if (typeof document === 'undefined') return []
    const steps: ScenarioStep[] = []
    for (const label of labels) {
      const btn = Array.from(document.querySelectorAll('.classification-toggle-pill'))
        .find(el => (el.textContent ?? '').trim() === label) as HTMLButtonElement | undefined
      if (!btn) continue
      const r = btn.getBoundingClientRect()
      steps.push({ kind: 'click', x: r.left + r.width / 2, y: r.top + r.height / 2 })
      steps.push({ kind: 'sleep', ms: dwellMs })
    }
    return steps
  }

  private async buildThemeFlip(): Promise<ScenarioStep[]> {
    // StatsBar theme picker is a button + dropdown menu. Two clicks per flip:
    // open menu, click the other theme. Skip if not present.
    if (typeof document === 'undefined') return []
    const btn = document.querySelector('.stats-bar-theme-button') as HTMLButtonElement | null
    if (!btn) return []
    const r = btn.getBoundingClientRect()
    return [
      { kind: 'click', x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { kind: 'sleep', ms: 100 },
      // Click the second item — flips to the other theme.
      // Resolved at runtime via JS in the harness consumer if needed.
      { kind: 'sleep', ms: 800 },
      { kind: 'click', x: r.left + r.width / 2, y: r.top + r.height / 2 },
      { kind: 'sleep', ms: 800 },
    ]
  }
}

// Module-scope side effect: attach the singleton driver and the metrics
// store to `window` so external scripts can call `await window.__driver
// .runAll()` without importing anything.
declare global {
  interface Window {
    __driver?: PerfDriver
    __perf?: typeof frameMetrics
  }
}

export const perfDriver = new PerfDriver()

if (typeof window !== 'undefined') {
  window.__driver = perfDriver
  window.__perf = frameMetrics
}
