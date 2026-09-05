import { describe, expect, it } from 'vitest'
import { markdownSystem } from '../../src/renderer/src/atlas/markdownSections'

describe('Markdown solar-system anchors and identity', () => {
  it('uses CommonMark source positions, ignoring code and quotes while retaining nested moons', () => {
    const text = '# Title\r\n\r\n## **Methods**\r\nBody\r\n### Detail\r\nMoon\r\n\r\n```md\r\n## Not a section\r\n```\r\n\r\n> ## Quoted\r\n\r\nResults\r\n-------\r\nDone'
    const system = markdownSystem(text, 'file')
    expect(system.headings.map(s => [s.title, s.line])).toEqual([['Title', 1], ['Methods', 3], ['Detail', 5], ['Results', 14]])
    expect(system.planets.map(s => s.title)).toEqual(['Methods', 'Results'])
    expect(system.headings.find(s => s.title === 'Detail')?.parentLine).toBe(3)
    expect(system.planets[0].sourceLine).toBe('## **Methods**')
    expect(new Set(system.headings.map(s => s.id)).size).toBe(4)
  })
  it('retains section worlds across insertion, body editing, and a renamed heading', () => {
    const first = markdownSystem('# Doc\n\n## Alpha\nAlpha body\n\n## Beta\nBeta body', 'file')
    const next = markdownSystem('# Doc\n\n## New\nNew body\n\n## Renamed alpha\nAlpha body\n\n## Beta\nEdited beta body', 'file', first.identities)
    expect(next.planets[1].id).toBe(first.planets[0].id)
    expect(next.planets[2].id).toBe(first.planets[1].id)
    expect(next.planets[0].id).not.toBe(first.planets[0].id)
    expect(next.planets[1].line).toBeGreaterThan(first.planets[0].line)
  })
  it('disambiguates duplicate names by their bodies when reordered, and never generates duplicate IDs', () => {
    const first = markdownSystem('## Notes\nA\n\n## Notes\nB\n\n## Notes\nB', 'file')
    const next = markdownSystem('## Notes\nB\n\n## Notes\nB\n\n## Notes\nA', 'file', first.identities)
    expect(next.planets[2].id).toBe(first.planets[0].id)
    expect(new Set(next.planets.map(s => s.id)).size).toBe(3)
    expect(markdownSystem('## Notes\nA', 'other').planets[0].id).not.toBe(first.planets[0].id)
  })
  it('supports plain Markdown, empty documents, and a bounded heading catalog', () => {
    expect(markdownSystem('A note without headings', 'file').planets[0]).toMatchObject({ title: 'Contents', line: 1 })
    expect(markdownSystem('', 'file').planets).toEqual([])
    expect(markdownSystem('## Opening\nText\n\n# Later\nText', 'file').planets.map(s => s.title)).toEqual(['Opening', 'Later'])
    const many = markdownSystem(Array.from({ length: 600 }, (_, i) => '## Section ' + i).join('\n'), 'file')
    expect(many.headings).toHaveLength(512); expect(many.limited).toBe(true)
  })
})
