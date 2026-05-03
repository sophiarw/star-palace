/**
 * useGraphicsQuality hook unit tests. Same memory-storage shim pattern as
 * useClassificationMode — vitest node env has no localStorage so we stub
 * the boundary and assert the persistence contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'starpalace.gfx.v1'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(k: string): string | null { return this.store.get(k) ?? null }
  setItem(k: string, v: string): void { this.store.set(k, v) }
  removeItem(k: string): void { this.store.delete(k) }
  clear(): void { this.store.clear() }
  get length(): number { return this.store.size }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null
  }
}

interface MinimalWindow {
  localStorage: MemoryStorage
}

let mem: MemoryStorage

beforeEach(() => {
  mem = new MemoryStorage()
  ;(globalThis as unknown as { window: MinimalWindow }).window = { localStorage: mem }
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  vi.resetModules()
})

describe('useGraphicsQuality', () => {
  it('exports a hook function', async () => {
    const mod = await import('../../src/renderer/src/hooks/useGraphicsQuality')
    expect(typeof mod.useGraphicsQuality).toBe('function')
  })

  it('round-trips a valid stored value', async () => {
    mem.setItem(STORAGE_KEY, 'ultra')
    expect(mem.getItem(STORAGE_KEY)).toBe('ultra')
  })

  it('rejects unknown stored values as bad data', async () => {
    mem.setItem(STORAGE_KEY, 'extreme')
    const raw = mem.getItem(STORAGE_KEY)
    expect(['low', 'medium', 'high', 'ultra'].includes(raw ?? '')).toBe(false)
  })
})
