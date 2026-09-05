import { describe, expect, it } from 'vitest'
import { fileMotion, fileRange, traverseJumps, VimParser } from '../../src/renderer/src/atlas/vimCommands'

const command = (keys: string[]) => {
  const parser = new VimParser()
  return keys.map(key => parser.feed({ key })).pop()?.command
}
describe('Vim browsing grammar', () => {
  it('applies counts to composed commands and resets after execution', () => {
    const parser = new VimParser()
    for (const key of ['1', '2', 'g']) parser.feed({ key })
    expect(parser.pending).toBe('12g')
    expect(parser.feed({ key: 'g' }).command).toEqual({ key: 'gg', count: 12, explicitCount: true, argument: undefined })
    expect(parser.feed({ key: 'j' }).command?.count).toBe(1)
    parser.feed({ key: '2' }); parser.feed({ key: 'Control', ctrlKey: true })
    expect(parser.feed({ key: 'o', ctrlKey: true }).command?.count).toBe(2)
    expect(command(['1', '2', 'Shift', 'G'])?.count).toBe(12)
    expect(command(['0'])?.key).toBe('0')
    expect(command(['1', '0', 'j'])?.count).toBe(10)
    expect(command(['9', '9', '9', '9', 'j'])?.count).toBe(999)
  })
  it('resets prefixes on Escape, typing, unknown sequences, and native shortcuts', () => {
    const parser = new VimParser()
    parser.feed({ key: 'g' }); parser.feed({ key: 'Escape' })
    expect(parser.feed({ key: 'g' }).command).toBeUndefined()
    parser.feed({ key: 'x' })
    expect(parser.pending).toBe('')
    parser.feed({ key: '3' })
    expect(parser.feed({ key: 'f', metaKey: true }).handled).toBe(false)
    expect(parser.feed({ key: 'j' }).command?.count).toBe(1)
    for (const key of ['f', 'r', 'w', 'c', 'v', 'a', 'b']) expect(parser.feed({ key, ctrlKey: true }).handled).toBe(false)
    expect(parser.feed({ key: 'j', isComposing: true }).handled).toBe(false)
  })
  it('recognizes named marks, directional search, and pane commands', () => {
    expect(command(['m', 'a'])).toMatchObject({ key: 'm', argument: 'a' })
    expect(command(["'", 'a'])).toMatchObject({ key: "'", argument: 'a' })
    expect(command(['`', '`'])?.key).toBe('jump-back')
    expect(command(['?'])?.key).toBe('?')
    expect(command([' ', 'l'])?.key).toBe(' l')
    expect(command([' ', 'e'])?.key).toBe(' e')
    expect(command(['y', 'y'])?.key).toBe('yy')
  })
  it('never maps destructive editing operators to file actions', () => {
    for (const key of ['d', 'c', 'x', 'D', 'C', 'S', 's', 'p', 'u', 'r', '.', '@']) expect(new VimParser().feed({ key }).handled).toBe(false)
  })
})
describe('file browsing motions', () => {
  it('handles boundaries, counts, grid rows, and limited pages', () => {
    expect(fileMotion(1, 10, command(['3', 'j'])!, 3)).toBe(9)
    expect(fileMotion(5, 10, command(['k'])!, 3)).toBe(2)
    expect(fileMotion(5, 10, command(['0'])!, 3)).toBe(3)
    expect(fileMotion(5, 10, command(['$'])!, 3)).toBe(5)
    expect(fileMotion(5, 10, command(['G'])!)).toBe(9)
    expect(fileMotion(5, 10, command(['4', 'G'])!)).toBe(3)
    expect(fileMotion(5, 10, command(['5', '0', '%'])!)).toBe(4)
    expect(fileMotion(-1, 0, command(['j'])!)).toBe(-1)
  })
  it('selects reversible inclusive ranges without mutating sequence order', () => {
    const ids = ['a', 'b', 'c', 'd']
    expect(fileRange(ids, 'c', 'a')).toEqual(['a', 'b', 'c'])
    expect(fileRange(ids, 'a', 'c')).toEqual(['a', 'b', 'c'])
    expect(fileRange(ids, 'missing', 'c')).toEqual([])
    expect(ids).toEqual(['a', 'b', 'c', 'd'])
  })
})

it('counted jump traversal keeps intermediate places and restores only the final destination', () => {
  const history = { past: ['a', 'b', 'c'], future: [] as string[] }
  expect(traverseJumps(history, 'd', false, 2)).toBe('b')
  expect(history).toEqual({ past: ['a'], future: ['d', 'c'] })
  expect(traverseJumps(history, 'b', true, 2)).toBe('d')
  expect(history).toEqual({ past: ['a', 'b', 'c'], future: [] })
  expect(traverseJumps(history, 'd', true, 1)).toBeUndefined()
})
