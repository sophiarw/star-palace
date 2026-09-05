import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js/lib/common'
import type { Root as HtmlRoot, Element as HtmlElement, Text as HtmlText } from 'hast'
import type { AtlasFile } from '@shared/atlas'
import type { CollectionSummary, FileContent, StarType } from '@shared/types'
import { STAR_TYPES } from '@shared/types'
import { addCollectionMembers, fetchNeighborhood, openFile, rawUrl, revealFile, setStarType, setTags, reindexFile } from '../api'
import { atlasApi } from './api'
import { readStored, writeStored } from './storage'
import { Highlighted } from './Highlighted'
import { patternFor, markedParts } from './searchText'

type TextContent = FileContent & { status: string; error: string | null }
const cache = new Map<string, { modifiedAt: number; value: TextContent }>()
const readableBytes = (n: number): string => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`

function highlightPlugin(query: string) {
  return () => (root: HtmlRoot) => {
    const regex = patternFor(query)
    if (!regex) return
    let budget = 1500
    const visit = (parent: HtmlRoot | HtmlElement): void => {
      const children = parent.children
      for (let i = 0; i < children.length && budget > 0; i++) {
        const child = children[i]
        if (child.type === 'element') { if (child.tagName !== 'mark') visit(child); continue }
        if (child.type !== 'text') continue
        const pieces = markedParts(child.value, regex, budget)
        if (pieces.length < 2) continue
        const nodes: (HtmlElement | HtmlText)[] = pieces.map((piece, index) => index % 2
          ? { type: 'element', tagName: 'mark', properties: { 'data-match': true }, children: [{ type: 'text', value: piece }] }
          : { type: 'text', value: piece })
        children.splice(i, 1, ...nodes); i += nodes.length - 1; budget -= Math.floor(pieces.length / 2)
      }
    }
    visit(root)
  }
}

function plainText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(plainText).join('')
  if (node && typeof node === 'object' && 'props' in node) return plainText((node.props as { children?: ReactNode }).children)
  return ''
}
const slug = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')

export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [], row: string[] = []
  let cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (char === delimiter && !quoted) { row.push(cell); cell = '' }
    else if (char === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push([...row]); row.length = 0; cell = '' }
    else cell += char
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row) }
  return rows
}

function DataTable({ text, query, delimiter }: { text: string; query: string; delimiter: string }) {
  const rows = useMemo(() => parseDelimited(text, delimiter), [text, delimiter])
  const [scroll, setScroll] = useState(0), body = rows.slice(1), rowHeight = 36
  const start = Math.max(0, Math.floor(scroll / rowHeight) - 5), visible = body.slice(start, start + 30)
  return <div className="atlas-table-wrap" onScroll={e => setScroll(e.currentTarget.scrollTop)} tabIndex={0} aria-label={`${body.length} data rows`}>
    <table className="atlas-data-table"><thead><tr>{(rows[0] ?? []).map((cell, i) => <th key={i}><Highlighted text={cell} query={query} /></th>)}</tr></thead><tbody>
      {start > 0 && <tr aria-hidden="true"><td colSpan={rows[0]?.length} style={{ height: start * rowHeight, padding: 0 }} /></tr>}
      {visible.map((row, i) => <tr key={start + i}>{row.map((cell, j) => <td key={j}><Highlighted text={cell} query={query} /></td>)}</tr>)}
      {start + visible.length < body.length && <tr aria-hidden="true"><td colSpan={rows[0]?.length} style={{ height: (body.length - start - visible.length) * rowHeight, padding: 0 }} /></tr>}
    </tbody></table>
  </div>
}

function CodeView({ text, name, query }: { text: string; name: string; query: string }) {
  const ext = name.split('.').pop() ?? '', aliases: Record<string, string> = { tsx: 'typescript', ts: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', sh: 'bash', md: 'markdown', yml: 'yaml', rb: 'ruby', rs: 'rust' }
  const language = aliases[ext] ?? ext
  const output = useMemo(() => hljs.getLanguage(language) ? hljs.highlight(text.slice(0, 150000), { language, ignoreIllegals: true }).value : null, [text, language])
  // Search mode favors directly navigable text matches over syntax color.
  const shown = query || !output ? text : text.slice(0, 150000)
  return <><div className="atlas-code-layout"><pre className="atlas-line-numbers" aria-hidden="true">{shown.split('\n').map((_, i) => i + 1).join('\n')}</pre><pre className="atlas-code" tabIndex={0}>{query || !output
    ? <code><Highlighted text={text} query={query} /></code>
    : <code className="hljs" dangerouslySetInnerHTML={{ __html: output }} />}</pre></div>{output && !query && text.length > 150000 && <p className="atlas-muted">Syntax preview limited to 150,000 characters. Search still covers the indexed document.</p>}</>
}

function ImageView({ file }: { file: AtlasFile }) {
  const [zoom, setZoom] = useState(1), [fit, setFit] = useState(true), [error, setError] = useState(false)
  return <><div className="atlas-preview-tools"><button onClick={() => { setFit(true); setZoom(1) }}>Fit</button><button onClick={() => { setFit(false); setZoom(1) }}>Actual size</button><button aria-label="Zoom image out" onClick={() => setZoom(z => Math.max(.25, z / 1.3))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="Zoom image in" onClick={() => setZoom(z => Math.min(8, z * 1.3))}>+</button></div>
    <div className="atlas-image-scroll">{error ? <p>Preview unavailable. Open this image in its default app.</p> : <img src={rawUrl(file.id)} alt={file.name} onError={() => setError(true)} style={{ maxWidth: fit ? '100%' : 'none', width: fit ? `${zoom * 100}%` : undefined, transform: fit ? undefined : `scale(${zoom})`, transformOrigin: 'top left' }} />}</div></>
}

interface Props {
  file: AtlasFile | null
  expanded: boolean
  query: string
  collections: CollectionSummary[]
  onExpand: () => void
  onClose: () => void
  onSelect: (id: string) => void
  onChange: (file: AtlasFile) => void
  onPrevious: () => void
  onNext: () => void
  hasSequence: boolean
}

export function Reader({ file, expanded, query, collections, onExpand, onClose, onSelect, onChange, onPrevious, onNext, hasSequence }: Props) {
  const [content, setContent] = useState<TextContent | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null)
  const [neighbors, setNeighbors] = useState<{ id: string; name: string }[]>([]), [tag, setTag] = useState(''), [busy, setBusy] = useState(false)
  const [matchIndex, setMatchIndex] = useState(0), [matches, setMatches] = useState(0), [pdfText, setPdfText] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null), articleRef = useRef<HTMLDivElement>(null)
  const fileId = file?.id, modifiedAt = file?.modifiedAt
  useEffect(() => {
    setContent(null); setError(null); setNeighbors([]); setTag(''); setPdfText(false); setMatchIndex(0)
    if (!fileId || modifiedAt === undefined) { setLoading(false); return }
    const abort = new AbortController()
    const cached = cache.get(fileId)
    if (cached && cached.modifiedAt === modifiedAt) { setContent(cached.value); setLoading(false) }
    else {
      setLoading(true)
      atlasApi.text(fileId, abort.signal).then(value => {
        if (abort.signal.aborted) return
        setContent(value); cache.delete(fileId); if (value.status !== 'unavailable') cache.set(fileId, { value, modifiedAt })
        while (cache.size > 12) cache.delete(cache.keys().next().value!)
      }).catch(e => { if (!abort.signal.aborted) setError(String(e)) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    }
    fetchNeighborhood(fileId).then(result => { if (!abort.signal.aborted) setNeighbors(result.neighbors.slice(0, 8).map(n => ({ id: n.file.id, name: n.file.name }))) }).catch(() => {})
    return () => abort.abort()
  }, [fileId, modifiedAt])

  useEffect(() => {
    const el = scrollRef.current
    if (el && fileId) el.scrollTop = readStored<number>('scroll.' + fileId, 0)
  }, [fileId, content])
  useEffect(() => {
    const marks = articleRef.current?.querySelectorAll<HTMLElement>('[data-match]') ?? []
    setMatches(marks.length); setMatchIndex(0)
    if (query && marks.length) marks[0].scrollIntoView({ block: 'center' })
  }, [content, query, pdfText])
  const rehype = useMemo(() => [highlightPlugin(query)], [query])
  const headings = useMemo(() => (content?.content?.match(/^#{1,3}\s+.+$/gm) ?? []).slice(0, 30).map(line => line.replace(/^#+\s+/, '')), [content])
  const moveMatch = (step: number) => {
    const marks = articleRef.current?.querySelectorAll<HTMLElement>('[data-match]')
    if (!marks?.length) return
    const next = ((matchIndex + step) % marks.length + marks.length) % marks.length
    setMatchIndex(next); marks[next].scrollIntoView({ block: 'center', behavior: 'auto' })
  }
  useEffect(() => {
    const move = (event: Event) => moveMatch((event as CustomEvent<number>).detail)
    window.addEventListener('atlas-reader-match', move)
    return () => window.removeEventListener('atlas-reader-match', move)
  })
  useEffect(() => {
    const marks = articleRef.current?.querySelectorAll<HTMLElement>('[data-match]')
    marks?.forEach((mark, index) => { mark.dataset.vimCurrentMatch = String(index === matchIndex) })
  }, [matchIndex, content, query, pdfText])
  const action = async (operation: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await operation() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  if (!file) return <aside className="atlas-reader atlas-reader-empty"><div className="atlas-eyebrow">A closer look</div><span className="atlas-empty-star">✧</span><h2>Follow your curiosity.</h2><p>Select a star to read its contents and discover what lives nearby.</p><p className="atlas-muted">Your place in the atlas will be here when you return.</p></aside>

  const markdown = /\.(md|markdown|mdx)$/i.test(file.name), image = file.mimeType.startsWith('image/'), pdf = file.mimeType === 'application/pdf'
  const csv = /\.(csv|tsv)$/i.test(file.name), text = content?.content ?? ''
  const tags = file.tags ?? []
  return <aside className={`atlas-reader ${expanded ? 'is-expanded' : ''}`} aria-label="File reader">
    <div className="atlas-reader-toolbar"><span className="atlas-eyebrow">{expanded ? 'Reader' : 'File preview'}</span><div>
      <button className="atlas-text-button" onClick={onExpand}>{expanded ? '↙ Back to atlas' : 'Expand ↗'}</button><button className="atlas-icon-button" onClick={onClose} aria-label="Close reader">×</button>
    </div></div>
    <div className="atlas-reader-scroll" tabIndex={-1} ref={scrollRef} onScroll={e => writeStored('scroll.' + file.id, e.currentTarget.scrollTop)}>
      <div className="atlas-reader-page"><div className="atlas-file-emblem">{file.name.split('.').pop()?.slice(0, 5).toUpperCase()}</div>
        <h2 className="atlas-document-title">{file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')}</h2><div className="atlas-document-path" title={file.path}>{file.path}</div>
        <div className="atlas-document-meta">{readableBytes(file.size)}<span>·</span>{new Date(file.modifiedAt).toLocaleDateString()}<span>·</span>{file.hasEmbedding ? 'Semantic + text index' : 'Name + text index'}</div>
        {!!tags.length && <div className="atlas-tags">{tags.map(t => <span key={t}>{t}</span>)}</div>}
        <div className="atlas-reader-actions"><button disabled={busy} onClick={() => void action(() => openFile(file.id))}>Open in app ↗</button><button disabled={busy} onClick={() => void action(() => revealFile(file.id))}>Reveal in folder</button></div>
        {hasSequence && <div className="atlas-sequence"><button onClick={onPrevious}>← Previous file</button><button onClick={onNext}>Next file →</button></div>}
        {query && <div className="atlas-match-nav"><span>{matches ? `${matchIndex + 1} of ${matches} matches` : 'No text matches in this view'}</span><button disabled={!matches} onClick={() => moveMatch(-1)} aria-label="Previous match">↑</button><button disabled={!matches} onClick={() => moveMatch(1)} aria-label="Next match">↓</button></div>}
        {pdf && <div className="atlas-preview-tools"><button aria-pressed={!pdfText} onClick={() => setPdfText(false)}>PDF pages</button><button aria-pressed={pdfText} onClick={() => setPdfText(true)}>Searchable text</button></div>}
        {error && <div className="atlas-notice" role="alert">{error}</div>}
        {markdown && headings.length > 2 && <details className="atlas-toc"><summary>On this page</summary>{headings.map((h, i) => <a key={i} href={'#' + slug(h)}>{h}</a>)}</details>}
        <div className="atlas-reading-content" ref={articleRef}>
          {image ? <ImageView key={file.id} file={file} /> : pdf && !pdfText ? <iframe className="atlas-pdf" src={rawUrl(file.id)} title={file.name} /> : loading ? <div className="atlas-loading">Preparing document…</div>
            : content?.status === 'unavailable' ? <div className="atlas-notice">This file is unavailable at its indexed path. Reveal its folder or reindex its source.</div>
            : !text ? <div className="atlas-no-preview">{content?.status === 'no-text' ? 'This document has no extractable text. Use the page view or open it in its default app.' : content?.status === 'too-large' ? 'This document is too large for an inline preview. Its name and metadata remain searchable.' : 'A preview is not available for this file format. Open it in its default app.'}</div>
            : csv ? <DataTable key={file.id} text={text} delimiter={/\.tsv$/i.test(file.name) ? '\t' : ','} query={query} />
            : markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehype} components={{
              h1: ({ children }) => <h1 id={slug(plainText(children))}>{children}</h1>,
              h2: ({ children }) => <h2 id={slug(plainText(children))}>{children}</h2>,
              h3: ({ children }) => <h3 id={slug(plainText(children))}>{children}</h3>,
              a: ({ href, children }) => <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>,
            }}>{text}</ReactMarkdown>
            : <CodeView text={text} name={file.name} query={query} />}
        </div>
        {content?.truncated && <p className="atlas-notice">Preview and text search cover the first 2 MiB of extracted text. Open the original for the complete file.</p>}
        <details className="atlas-file-inspector"><summary>Tags, pinning & file details</summary>
          <label>Tags<form onSubmit={e => { e.preventDefault(); const value = tag.trim(); if (!value || tags.includes(value)) return; void action(async () => { const next = [...tags, value]; await setTags(file.id, next); onChange({ ...file, tags: next }); setTag(''); void reindexFile(file.id).catch(() => {}) }) }}><input value={tag} onChange={e => setTag(e.target.value)} placeholder="Add a tag" aria-label="New tag" /><button disabled={busy}>Add</button></form></label>
          <div className="atlas-tags">{tags.map(t => <button key={t} disabled={busy} aria-label={`Remove tag ${t}`} onClick={() => void action(async () => { const next = tags.filter(v => v !== t); await setTags(file.id, next); onChange({ ...file, tags: next }) })}>{t} ×</button>)}</div>
          <label>Star type<select value={file.starType ?? ''} onChange={e => void action(async () => { const type = e.target.value as StarType | ''; await setStarType(file.id, type || null); onChange({ ...file, starType: type || null }) })}><option value="">Automatic</option>{STAR_TYPES.map(type => <option key={type} value={type}>{type.replace(/-/g, ' ')}</option>)}</select></label>
          <button disabled={busy} onClick={() => void action(async () => { const result = await atlasApi.pin(file.id, file.isPinned ? null : file.x, file.isPinned ? null : file.y); onChange(result.file) })}>{file.isPinned ? 'Unpin from this position' : 'Pin at this position'}</button>
          <label>Add to collection<select defaultValue="" onChange={e => { const target = e.currentTarget, id = Number(target.value); if (!id) return; void action(async () => { await addCollectionMembers(id, [file.id]); target.value = '' }) }}><option value="">Choose a collection…</option>{collections.filter(c => c.kind === 'static').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        </details>
        {!!neighbors.length && <section className="atlas-related"><div className="atlas-eyebrow">Related files</div>{neighbors.map(n => <button key={n.id} onClick={() => onSelect(n.id)}>{n.name}<span>↗</span></button>)}</section>}
      </div>
    </div>
  </aside>
}
