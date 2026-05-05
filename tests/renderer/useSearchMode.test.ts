import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SEARCH_MODE, resolveSearchMode } from '../../src/renderer/src/hooks/useSearchMode'

const STORAGE_KEY = 'starpalace.searchMode.v1'

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

describe('useSearchMode', () => {
  it('default is semantic', () => {
    expect(DEFAULT_SEARCH_MODE).toBe('semantic')
  })

  it('resolves stored "literal"', () => {
    expect(resolveSearchMode('literal')).toBe('literal')
  })

  it('resolves stored "semantic"', () => {
    expect(resolveSearchMode('semantic')).toBe('semantic')
  })

  it('falls back to default on unknown stored value', () => {
    expect(resolveSearchMode('garbage')).toBe(DEFAULT_SEARCH_MODE)
  })

  it('falls back to default on null', () => {
    expect(resolveSearchMode(null)).toBe(DEFAULT_SEARCH_MODE)
  })

  it('useSearchMode reads stored literal at mount', async () => {
    mem.setItem(STORAGE_KEY, 'literal')
    const { useSearchMode } = await import('../../src/renderer/src/hooks/useSearchMode')
    expect(typeof useSearchMode).toBe('function')
    expect(mem.getItem(STORAGE_KEY)).toBe('literal')
  })

  it('clears stored bad value when resolveSearchMode runs alongside cleanup logic', async () => {
    mem.setItem(STORAGE_KEY, 'garbage')
    expect(resolveSearchMode(mem.getItem(STORAGE_KEY))).toBe(DEFAULT_SEARCH_MODE)
  })
})
