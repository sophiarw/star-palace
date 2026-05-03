// PerfDriver synthetic-event payload tests. Run in vitest's node env, so we
// stub the DOM-side targets and assert the recorder hook receives the right
// kind/payload for each driver call. No React mount required.

import { describe, it, expect, vi } from 'vitest'
import { PerfDriver } from '../../src/renderer/src/lib/perfDriver'

interface Recorded { kind: string; payload: Record<string, unknown> }

function makeDriver(): { driver: PerfDriver; recorded: Recorded[]; sleeps: number[] } {
  const recorded: Recorded[] = []
  const sleeps: number[] = []
  const driver = new PerfDriver({
    canvasSelector: 'canvas',
    keyTarget: { dispatchEvent: () => true } as unknown as EventTarget,
    now: () => 0,
    sleep: async (ms) => { sleeps.push(ms) },
    recorder: (kind, payload) => recorded.push({ kind, payload }),
  })
  return { driver, recorded, sleeps }
}

describe('PerfDriver', () => {
  it('mouseDrag without a canvas throws', async () => {
    const { driver } = makeDriver()
    await expect(driver.mouseDrag({ dx: 100, dy: 0 })).rejects.toThrow(/canvas not found/)
  })

  it('tapKey records keydown then keyup', async () => {
    const { driver, recorded } = makeDriver()
    await driver.tapKey('Escape')
    expect(recorded.map(r => r.payload.type)).toEqual(['keydown', 'keyup'])
    expect(recorded[0].payload.key).toBe('Escape')
  })

  it('tapKey forwards modifiers to the payload', async () => {
    const { driver, recorded } = makeDriver()
    await driver.tapKey('f', { meta: true })
    expect(recorded[0].payload.metaKey).toBe(true)
    expect(recorded[0].payload.shiftKey).toBe(false)
  })

  it('holdKey holds for the requested duration', async () => {
    const { driver, recorded, sleeps } = makeDriver()
    await driver.holdKey('l', 1000)
    expect(recorded.map(r => r.payload.type)).toEqual(['keydown', 'keyup'])
    expect(sleeps).toContain(1000)
  })

  it('type emits one keydown+keyup per char and sleeps between', async () => {
    const { driver, recorded, sleeps } = makeDriver()
    await driver.type('abc', 5)
    const types = recorded.map(r => r.payload.type)
    expect(types).toEqual(['keydown', 'keyup', 'keydown', 'keyup', 'keydown', 'keyup'])
    expect(recorded.filter(r => r.payload.type === 'keydown').map(r => r.payload.key)).toEqual(['a', 'b', 'c'])
    // Three chars × intervalMs sleep = three intervals (between, after).
    expect(sleeps.filter(s => s === 5).length).toBeGreaterThanOrEqual(2)
  })

  it('runStep dispatches sleep and other steps in order', async () => {
    const { driver, recorded, sleeps } = makeDriver()
    await driver.runStep({ kind: 'sleep', ms: 250 })
    await driver.runStep({ kind: 'tapKey', key: 'n' })
    expect(sleeps[0]).toBe(250)
    expect(recorded[0].payload.type).toBe('keydown')
    expect(recorded[0].payload.key).toBe('n')
  })

  it('runScenario resets metrics, runs steps, returns a report', async () => {
    const { driver } = makeDriver()
    const reset = vi.spyOn(await import('../../src/renderer/src/lib/frameMetrics').then(m => m.frameMetrics), 'reset')
    const r = await driver.runScenario('test', [{ kind: 'sleep', ms: 100 }])
    expect(reset).toHaveBeenCalled()
    expect(r.name).toBe('test')
    expect(r.snapshot).toBeDefined()
    reset.mockRestore()
  })
})
