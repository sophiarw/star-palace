import { describe, it, expect } from 'vitest'
import { parseSpotlightOutput } from '../../src/daemon/index/usageMetadata'

describe('parseSpotlightOutput', () => {
  it('returns nulls for double-(null) output (file Spotlight knows nothing about)', () => {
    const out = parseSpotlightOutput('(null)(null)')
    expect(out.osUseCount).toBeNull()
    expect(out.osLastUsed).toBeNull()
  })

  it('parses count + date when both present', () => {
    // Real Spotlight returns the two values back-to-back on the same line.
    const stdout = '12025-04-30 11:23:45 -0700'
    const out = parseSpotlightOutput(stdout)
    expect(out.osUseCount).toBe(1)
    expect(out.osLastUsed).not.toBeNull()
    // Sanity: the parsed timestamp must be a finite UTC ms close to 2025-04-30.
    expect(out.osLastUsed!).toBeGreaterThan(Date.parse('2025-04-29'))
    expect(out.osLastUsed!).toBeLessThan(Date.parse('2025-05-02'))
  })

  it('parses larger counts correctly', () => {
    const stdout = '4242025-01-15 09:00:00 +0000'
    const out = parseSpotlightOutput(stdout)
    expect(out.osUseCount).toBe(424)
    expect(out.osLastUsed).toBe(Date.parse('2025-01-15 09:00:00 +0000'))
  })

  it('handles count present, date missing', () => {
    const stdout = '7(null)'
    const out = parseSpotlightOutput(stdout)
    expect(out.osUseCount).toBe(7)
    expect(out.osLastUsed).toBeNull()
  })

  it('handles count missing, date present', () => {
    const stdout = '(null)2024-12-01 08:00:00 +0000'
    const out = parseSpotlightOutput(stdout)
    expect(out.osUseCount).toBeNull()
    expect(out.osLastUsed).toBe(Date.parse('2024-12-01 08:00:00 +0000'))
  })

  it('returns nulls on completely malformed output', () => {
    const out = parseSpotlightOutput('not-a-number not-a-date')
    expect(out.osUseCount).toBeNull()
    expect(out.osLastUsed).toBeNull()
  })

  it('strips trailing newline that mdls always emits', () => {
    const out = parseSpotlightOutput('5(null)\n')
    expect(out.osUseCount).toBe(5)
    expect(out.osLastUsed).toBeNull()
  })
})
