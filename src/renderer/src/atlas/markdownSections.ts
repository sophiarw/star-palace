import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'
import { seedFor } from './scene'

export interface SectionIdentity { id: string; key: string; fingerprint: string; title: string }
export interface MarkdownSection extends SectionIdentity { line: number; sourceLine: string; depth: number; parentLine: number | null; chars: number }
export interface MarkdownSystem { headings: MarkdownSection[]; planets: MarkdownSection[]; identities: SectionIdentity[]; limited: boolean }
const normalize = (title: string) => title.toLowerCase().replace(/\s+/g, ' ').trim()

/** CommonMark positions exclude fenced/indented code and quoted headings. */
export function markdownSystem(text: string, fileId: string, previous: SectionIdentity[] = []): MarkdownSystem {
  const root = fromMarkdown(text), raw = root.children.filter(node => node.type === 'heading')
  const lines = text.split(/\r\n|\n|\r/), stack: { depth: number; title: string; line: number }[] = []
  const candidates = raw.slice(0, 512).map((heading, index) => {
    const line = heading.position!.start.line, title = toString(heading).trim() || 'Untitled section'
    while (stack.length && stack[stack.length - 1].depth >= heading.depth) stack.pop()
    const key = [...stack.map(h => normalize(h.title)), normalize(title)].join(' / ')
    const parentLine = stack.length ? stack[stack.length - 1].line : null
    stack.push({ title, depth: heading.depth, line })
    const bodyStart = heading.position!.end.offset!, bodyEnd = raw[index + 1]?.position?.start.offset ?? text.length
    const body = text.slice(bodyStart, bodyEnd).trim()
    let end = index + 1
    while (end < raw.length && raw[end].depth > heading.depth) end++
    return { key, title, line, sourceLine: lines[line - 1], depth: heading.depth, parentLine, chars: (raw[end]?.position?.start.offset ?? text.length) - bodyStart, fingerprint: body ? seedFor(body).toString(16) + ':' + body.length : '' }
  })
  if (!candidates.length && text.trim()) candidates.push({ key: 'document', title: 'Contents', line: 1, sourceLine: lines[0], depth: 1, parentLine: null, chars: text.length, fingerprint: seedFor(text).toString(16) + ':' + text.length })
  const assigned = new Map<number, string>(), used = new Set<string>()
  // Resolve unique bodies before names: duplicate heading names can be reordered.
  for (const field of ['fingerprint', 'key', 'title'] as const) {
    const old = new Map<string, SectionIdentity[]>(), next = new Map<string, number[]>()
    for (const entry of previous) if (!used.has(entry.id) && entry[field]) old.set(entry[field], [...(old.get(entry[field]) ?? []), entry])
    candidates.forEach((entry, i) => { if (!assigned.has(i) && entry[field]) next.set(entry[field], [...(next.get(entry[field]) ?? []), i]) })
    for (const [value, indices] of next) if (indices.length === 1 && old.get(value)?.length === 1) {
      const id = old.get(value)![0].id; assigned.set(indices[0], id); used.add(id)
    }
  }
  const headings = candidates.map((section, i) => {
    let id = assigned.get(i), salt = 0
    if (!id) {
      const matching = previous.find(old => old.key === section.key && old.fingerprint === section.fingerprint && !used.has(old.id))
      id = matching?.id
    }
    if (!id) do { id = 'section-' + seedFor(fileId + '\0' + section.key + '\0' + salt++).toString(16) } while (used.has(id))
    used.add(id)
    return { ...section, id }
  })
  // A sole leading H1 identifies the central document, rather than swallowing all H2s.
  const titleHeading = raw[0]?.depth === 1 && raw.filter(h => h.depth === 1).length === 1 && raw.length > 1 ? headings[0] : null
  const contents = headings.filter(h => h !== titleHeading)
  const planets = contents.filter(h => h.parentLine === null || h.parentLine === titleHeading?.line)
  return { headings, planets, identities: headings.map(({ id, key, fingerprint, title }) => ({ id, key, fingerprint, title })), limited: raw.length > 512 }
}

export const sectionAnchor = (line: number) => 'section-line-' + line
