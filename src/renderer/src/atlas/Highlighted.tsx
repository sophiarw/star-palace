import { patternFor, markedParts } from './searchText'

export function Highlighted({ text, query }: { text: string; query: string }) {
  const pattern = patternFor(query)
  if (!pattern) return <>{text}</>
  return <>{markedParts(text, pattern).map((piece, i) => i % 2 ? <mark key={i} data-match>{piece}</mark> : piece)}</>
}

