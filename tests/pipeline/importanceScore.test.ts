import { describe, it, expect } from 'vitest'
import { computeImportanceScore } from '../../src/daemon/pipeline/importanceScore'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

describe('computeImportanceScore (F10)', () => {
  it('returns 0 for a brand-new file with no signals', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: null,
      osLastUsed: null,
      now: NOW,
    })
    expect(s).toBe(0)
  })

  it('returns view_count alone when no OS signals exist (cloud-platform path)', () => {
    const s = computeImportanceScore({
      viewCount: 5,
      osUseCount: null,
      osLastUsed: null,
      now: NOW,
    })
    expect(s).toBe(5)
  })

  it('treats null osUseCount as 0 in the log term', () => {
    // log2(0+1)*4 = 0
    const a = computeImportanceScore({ viewCount: 0, osUseCount: null, osLastUsed: null, now: NOW })
    const b = computeImportanceScore({ viewCount: 0, osUseCount: 0,    osLastUsed: null, now: NOW })
    expect(a).toBe(b)
  })

  it('log2 term: osUseCount=1 contributes log2(2)*4 = 4', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: 1,
      osLastUsed: null,
      now: NOW,
    })
    expect(s).toBeCloseTo(4)
  })

  it('log2 term: osUseCount=15 contributes log2(16)*4 = 16', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: 15,
      osLastUsed: null,
      now: NOW,
    })
    expect(s).toBeCloseTo(16)
  })

  it('recency boost: opened just now contributes ~5', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: null,
      osLastUsed: NOW,
      now: NOW,
    })
    expect(s).toBeCloseTo(5)
  })

  it('recency boost: opened exactly 7 days ago contributes 0 (clamp)', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: null,
      osLastUsed: NOW - SEVEN_DAYS_MS,
      now: NOW,
    })
    expect(s).toBeCloseTo(0)
  })

  it('recency boost: opened 14 days ago is clamped to 0 (not negative)', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: null,
      osLastUsed: NOW - 2 * SEVEN_DAYS_MS,
      now: NOW,
    })
    expect(s).toBe(0)
  })

  it('recency boost: opened 3.5 days ago contributes ~2.5', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: null,
      osLastUsed: NOW - SEVEN_DAYS_MS / 2,
      now: NOW,
    })
    expect(s).toBeCloseTo(2.5)
  })

  it('combines all three terms additively', () => {
    // viewCount=10 + log2(8)*4 + recency(now)*5
    //   = 10 + 12 + 5 = 27
    const s = computeImportanceScore({
      viewCount: 10,
      osUseCount: 7,
      osLastUsed: NOW,
      now: NOW,
    })
    expect(s).toBeCloseTo(27)
  })

  it('opened in the future (clock skew): clamps to 1 (max recency = 5)', () => {
    const s = computeImportanceScore({
      viewCount: 0,
      osUseCount: null,
      osLastUsed: NOW + 60_000,  // 1 minute in the future
      now: NOW,
    })
    expect(s).toBeCloseTo(5)
  })
})
