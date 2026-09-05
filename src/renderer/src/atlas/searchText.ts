export const queryTerms = (query: string): string[] => (query.match(/"[^"]+"|[\p{L}\p{N}_-]+/gu) ?? []).map(t => t.replace(/^"|"$/g, '')).filter(Boolean).slice(0, 16)
export const patternFor = (query: string): RegExp | null => {
  const terms = queryTerms(query)
  return terms.length ? new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi') : null
}

export function markedParts(text: string, pattern: RegExp, limit = 1500): string[] {
  const parts: string[] = []
  let cursor = 0
  pattern.lastIndex = 0
  for (let i = 0; i < limit; i++) {
    const match = pattern.exec(text)
    if (!match || !match[0].length) break
    parts.push(text.slice(cursor, match.index), match[0]); cursor = match.index + match[0].length
  }
  parts.push(text.slice(cursor))
  return parts
}

