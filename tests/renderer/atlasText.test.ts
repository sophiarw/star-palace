import { expect, it } from 'vitest'
import { markedParts, patternFor } from '../../src/renderer/src/atlas/searchText'

it('bounds highlighting without dropping the rest of a long document', () => {
  const text = 'a '.repeat(100_000) + 'the ending must remain readable'
  const parts = markedParts(text, patternFor('a')!)
  expect(parts.filter((_, i) => i % 2)).toHaveLength(1500)
  expect(parts.join('')).toBe(text)
  expect(parts.at(-1)).toContain('the ending must remain readable')
})
it('preserves literal phrases and punctuation in highlighted text', () => {
  const text = 'The copper lantern appears beside example_name.'
  expect(markedParts(text, patternFor('"copper lantern" example_name')!).filter((_, i) => i % 2)).toEqual(['copper lantern', 'example_name'])
  expect(patternFor('')).toBeNull()
})
