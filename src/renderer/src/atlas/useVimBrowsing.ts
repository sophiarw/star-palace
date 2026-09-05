import { useEffect, useRef, useState, type RefObject } from 'react'
import type { AtlasFile } from '@shared/atlas'
import type { MapHandle } from './AtlasMap'
import { fileMotion, fileRange, traverseJumps, VimParser, type VimCommand } from './vimCommands'

type View = 'map' | 'list' | 'grid'
interface Options<Place> {
  map: RefObject<MapHandle | null>
  searchInput: RefObject<HTMLInputElement | null>
  sequence: AtlasFile[]
  selectedId: string | null
  selected: AtlasFile | null
  query: string
  view: View
  expanded: boolean
  blocked: boolean
  scopeKey: string
  setQuery: (query: string) => void
  select: (file: AtlasFile) => void
  setView: (view: View) => void
  expand: () => void
  close: () => void
  back: () => void
  showReader?: () => void
  help: () => void
  metrics: () => void
  collection: (ids: string[]) => void
  action: (action: 'open' | 'reveal' | 'pin' | 'unpin' | 'favorite' | 'unfavorite' | 'edit', file: AtlasFile) => void
  notice: (message: string) => void
  capture: () => Place
  restore: (place: Place) => void
}
interface Visual { anchor: string; ids: string[]; files: AtlasFile[] }
const scrollableReader = () => {
  const active = document.activeElement as HTMLElement | null
  return active?.closest<HTMLElement>('.atlas-table-wrap,.atlas-image-scroll,.atlas-code') ?? document.querySelector<HTMLElement>('.atlas-reader-scroll')
}
const editable = (target: HTMLElement) => !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog')
const parentFolder = (file: AtlasFile) => file.path.slice(0, file.path.lastIndexOf('/'))

export function useVimBrowsing<Place>(options: Options<Place>) {
  const latest = useRef(options); latest.current = options
  const parser = useRef(new VimParser())
  const [pending, setPending] = useState(''), [command, setCommand] = useState<string | null>(null)
  const [visual, setVisual] = useState<Visual | null>(null)
  const visualRef = useRef(visual); visualRef.current = visual
  const previousVisual = useRef<Visual | null>(null)
  const marks = useRef(new Map<string, Place>())
  const jumps = useRef<{ past: Place[]; future: Place[] }>({ past: [], future: [] })
  const direction = useRef(1)
  const commandHistory = useRef<string[]>([]), commandCursor = useRef(0)
  const range = visual ? fileRange(visual.ids, visual.anchor, options.selectedId ?? visual.anchor) : []
  useEffect(() => { setVisual(null); parser.current.reset(); setPending('') }, [options.scopeKey, options.query, options.view])
  useEffect(() => {
    const reset = () => { parser.current.reset(); setPending('') }
    const onFocus = (event: FocusEvent) => { if (editable(event.target as HTMLElement)) reset() }
    const snapshot = () => { const history = jumps.current; history.past.push(latest.current.capture()); history.past = history.past.slice(-100); history.future = [] }
    const jump = (forward: boolean, count: number) => {
      const o = latest.current, history = jumps.current
      const destination = traverseJumps(history, o.capture(), forward, count)
      if (destination) o.restore(destination)
      else o.notice('No more keyboard jumps')
    }
    const focusPane = (reader: boolean) => {
      if (reader) latest.current.showReader?.()
      const target = document.querySelector<HTMLElement>(reader ? '.atlas-reader-scroll' : '.atlas-stage')
      if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }) }
    }
    const choose = (file: AtlasFile | undefined, remember = false) => {
      if (!file) return
      if (remember) snapshot()
      latest.current.select(file)
      const tile = [...document.querySelectorAll<HTMLElement>('[data-vim-file]')].find(el => el.dataset.vimFile === file.id)
      tile?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    const run = (c: VimCommand, target: HTMLElement) => {
      const o = latest.current, { key, count } = c
      const inReader = o.expanded || !!target.closest('.atlas-reader')
      const inResults = !!o.query.trim()
      const browser = document.querySelector<HTMLElement>('.atlas-file-browser,.atlas-results')
      const reader = scrollableReader()
      const sequence = visualRef.current ? visualRef.current.files : o.sequence
      const index = sequence.findIndex(f => f.id === o.selectedId)
      const columns = o.view === 'grid' && browser ? Math.max(1, getComputedStyle(browser).gridTemplateColumns.split(' ').length) : 1
      const move = (next: number, remember = false) => choose(sequence[Math.max(0, Math.min(sequence.length - 1, next))], remember)
      const scroll = (amount: number, horizontal = false) => {
        if (inReader) reader?.scrollBy({ [horizontal ? 'left' : 'top']: amount, behavior: 'auto' })
        else if (o.view === 'map' && !inResults) o.map.current?.pan(horizontal ? amount : 0, horizontal ? 0 : amount)
        else browser?.scrollBy({ [horizontal ? 'left' : 'top']: amount, behavior: 'auto' })
      }
      if (key === 'Escape') {
        if (visualRef.current) { previousVisual.current = visualRef.current; setVisual(null) }
        else if (o.expanded) o.close()
        else if (o.query) o.setQuery('')
        else o.back()
      } else if (['/', '?', 'i', 'a', 'I', 'A'].includes(key)) {
        direction.current = key === '?' ? -1 : 1
        o.searchInput.current?.focus(); o.searchInput.current?.select()
      } else if (key === '*' || key === '#') {
        if (o.selected) { direction.current = key === '#' ? -1 : 1; o.setQuery(o.selected.name) }
      } else if (key === ':' || key === 'F1') { if (key === ':') setCommand(''); else o.help() }
      else if (key === 'P') o.metrics()
      else if (key === 'Enter') { if (o.selected) o.expand() }
      else if (key === 'o' || key === 'O' || key === 'gf') { if (o.selected) o.action(key === 'O' ? 'reveal' : 'open', o.selected) }
      else if (key === 'v' || key === 'V' || key === 'gv') {
        if (inReader) { o.notice('Use native text selection in the reader. Space h returns to file selection.'); return }
        if (key === 'gv') { if (previousVisual.current) setVisual(previousVisual.current) }
        else if (visualRef.current) { previousVisual.current = visualRef.current; setVisual(null) }
        else if (sequence.length) { const anchor = o.selectedId && index >= 0 ? o.selectedId : sequence[0].id; if (index < 0) choose(sequence[0]); setVisual({ anchor, ids: sequence.map(f => f.id), files: [...sequence] }) }
      } else if (key === 'yy') {
        const ids = visualRef.current ? fileRange(visualRef.current.ids, visualRef.current.anchor, o.selectedId ?? visualRef.current.anchor) : [o.selectedId]
        const paths = ids.map(id => sequence.find(f => f.id === id) ?? (o.selected?.id === id ? o.selected : null)).filter((f): f is AtlasFile => !!f).map(f => f.path)
        if (paths.length) void navigator.clipboard.writeText(paths.join('\n')).then(() => o.notice(`${paths.length} file path${paths.length === 1 ? '' : 's'} copied`)).catch(() => o.notice('Clipboard unavailable. Copy the path from the reader.'))
      } else if (key === 'm' && c.argument) { marks.current.set(c.argument, o.capture()); o.notice(`Mark ${c.argument} saved for this session`) }
      else if ((key === "'" || key === '`') && c.argument) { const place = marks.current.get(c.argument); if (place) { snapshot(); o.restore(place) } else o.notice(`Mark ${c.argument} is not set`) }
      else if (key === 'Ctrl-o' || key === 'Ctrl-i' || key === 'jump-back') jump(key === 'Ctrl-i', count)
      else if (key === ' e') { if (o.selected) o.action('edit', o.selected) }
      else if (key === ' w' || key === ' h' || key === ' l') focusPane(key === ' l' || (key === ' w' && !inReader))
      else if (key === 'gt' || key === 'gT') { const views: View[] = ['map', 'list', 'grid']; o.setView(views[(views.indexOf(o.view) + (key === 'gt' ? count : -(count % 3)) + 3) % 3]) }
      else if (key === 'zf') o.map.current?.fit()
      else if (key === '+' || key === '=' || key === '-') { if (!inReader) o.map.current?.zoom(Math.pow(1.3, Math.min(10, count) * (key === '-' ? -1 : 1))) }
      else if (key === 'zz' || key === 'zt' || key === 'zb') {
        if (inReader) document.querySelector<HTMLElement>('[data-vim-current-match="true"]')?.scrollIntoView({ block: key === 'zt' ? 'start' : key === 'zb' ? 'end' : 'center' })
        else if (o.selected) o.map.current?.focus(o.selected)
      } else if (['Ctrl-d', 'Ctrl-u', 'PageDown', 'PageUp', 'Ctrl-e', 'Ctrl-y'].includes(key)) {
        const height = (inReader ? reader : browser)?.clientHeight ?? document.querySelector('.atlas-stage')?.clientHeight ?? 600
        const amount = key === 'Ctrl-e' || key === 'Ctrl-y' ? 40 : key === 'Ctrl-d' || key === 'Ctrl-u' ? height / 2 : height * .9
        scroll(amount * count * (['Ctrl-u', 'Ctrl-y', 'PageUp'].includes(key) ? -1 : 1))
      } else if (key === '[f' || key === ']f') {
        if (sequence.length) move(((index < 0 ? 0 : index) + (key === ']f' ? count : -count) % sequence.length + sequence.length) % sequence.length, true)
      } else if (key === 'n' || key === 'N') {
        const step = direction.current * (key === 'n' ? 1 : -1) * count
        if (inReader && o.query) window.dispatchEvent(new CustomEvent('atlas-reader-match', { detail: step }))
        else if (sequence.length) move(((index < 0 ? step > 0 ? -1 : 0 : index) + step % sequence.length + sequence.length) % sequence.length, true)
      } else if (['{', '}', '[[', ']]', '(', ')'].includes(key)) {
        const forward = ['}', ']]', ')'].includes(key)
        if (inReader && reader) {
          const elements = [...reader.querySelectorAll<HTMLElement>(key === '(' || key === ')' ? '.atlas-reading-content p' : '.atlas-reading-content h1,.atlas-reading-content h2,.atlas-reading-content h3')]
          const top = reader.getBoundingClientRect().top
          const candidates = elements.filter(el => forward ? el.getBoundingClientRect().top > top + 8 : el.getBoundingClientRect().top < top - 8)
          const next = forward ? candidates[Math.min(count - 1, candidates.length - 1)] : candidates[Math.max(0, candidates.length - count)]
          next?.scrollIntoView({ block: 'start' })
        } else {
          let cursor = Math.max(0, index)
          for (let n = 0; n < count; n++) { const folder = sequence[cursor] && parentFolder(sequence[cursor]); let next = cursor + (forward ? 1 : -1); while (next >= 0 && next < sequence.length && parentFolder(sequence[next]) === folder) next += forward ? 1 : -1; cursor = Math.max(0, Math.min(sequence.length - 1, next)) }
          move(cursor, true)
        }
      } else if (['gg', 'G', '0', '^', '$', 'H', 'M', 'L', '%'].includes(key)) {
        if (inReader && reader) {
          if (['0', '^', '$'].includes(key)) reader.scrollTo({ left: key === '$' ? reader.scrollWidth : 0 })
          else if (key === 'gg' || key === 'G') reader.scrollTo({ top: c.explicitCount ? (count - 1) * 24 : key === 'G' ? reader.scrollHeight : 0 })
          else if (key === '%') { if (c.explicitCount) reader.scrollTo({ top: (reader.scrollHeight - reader.clientHeight) * Math.min(100, count) / 100 }) }
          else reader.scrollBy({ top: key === 'H' ? -reader.clientHeight / 2 : key === 'L' ? reader.clientHeight / 2 : 0 })
        } else if (['H', 'M', 'L'].includes(key)) {
          const bounds = browser?.getBoundingClientRect()
          const visible = [...document.querySelectorAll<HTMLElement>('[data-vim-file]')].filter(el => { const rect = el.getBoundingClientRect(); return !bounds || (rect.bottom > bounds.top && rect.top < bounds.bottom) }).map(el => sequence.find(f => f.id === el.dataset.vimFile)).filter((f): f is AtlasFile => !!f)
          const candidates = visible.length ? visible : sequence
          choose(candidates[key === 'H' ? Math.min(count - 1, candidates.length - 1) : key === 'L' ? Math.max(0, candidates.length - count) : Math.floor(candidates.length / 2)], true)
        } else if (key !== '%' || c.explicitCount) move(fileMotion(index, sequence.length, c, o.view === 'list' ? sequence.length || 1 : columns), true)
      } else if (inReader) scroll(count * 40 * (['h', 'k', 'b', 'B', 'ge', 'gE', '[f'].includes(key) ? -1 : 1), key === 'h' || key === 'l')
      else if (o.view === 'map' && !inResults && !visualRef.current && ['h', 'j', 'k', 'l'].includes(key)) scroll(count * 70 * (key === 'h' || key === 'k' ? -1 : 1), key === 'h' || key === 'l')
      else move(index < 0 ? 0 : fileMotion(index, sequence.length, c, columns))
    }
    const keydown = (event: KeyboardEvent) => {
      const o = latest.current, target = event.target as HTMLElement
      if (event.defaultPrevented || event.isComposing || event.key === 'Process') return
      if (!o.blocked && !document.querySelector('dialog[open]') && (event.metaKey || event.ctrlKey) && ['k', 'f'].includes(event.key.toLowerCase())) { event.preventDefault(); reset(); o.searchInput.current?.focus(); o.searchInput.current?.select(); return }
      if (o.blocked || editable(target)) { reset(); return }
      // Enter belongs to a focused native control, even while Normal mode is active.
      if ((event.key === 'Enter' && target.closest('button,a,summary')) || (event.key === ' ' && target.closest('button,summary'))) { reset(); return }
      if (event.key === 'y' && visualRef.current && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); reset(); run({ key: 'yy', count: 1, explicitCount: false }, target); return }
      const result = parser.current.feed(event)
      setPending(parser.current.pending)
      if (result.handled) event.preventDefault()
      if (result.command) run(result.command, target)
    }
    window.addEventListener('keydown', keydown); window.addEventListener('blur', reset); window.addEventListener('focusin', onFocus)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('blur', reset); window.removeEventListener('focusin', onFocus) }
  }, [])
  const execute = () => {
    const o = latest.current, text = command?.trim().replace(/^:/, '') ?? ''
    setCommand(null)
    if (!text) return
    commandHistory.current = [...commandHistory.current.filter(item => item !== text), text].slice(-30); commandCursor.current = commandHistory.current.length
    if (['help', 'h', 'commands'].includes(text)) o.help()
    else if (['map', 'list', 'grid'].includes(text)) o.setView(text as View)
    else if (['q', 'quit', 'close'].includes(text)) o.close()
    else if (text === 'noh' || text === 'nohlsearch') o.setQuery('')
    else if (text === 'fit') o.map.current?.fit()
    else if (text === 'collection') o.collection(range.length ? range : o.selectedId ? [o.selectedId] : [])
    else if (text === 'marks') o.notice(marks.current.size ? `Session marks: ${[...marks.current.keys()].join(', ')}` : 'No marks. Use ma to save mark a.')
    else if (['open', 'reveal', 'pin', 'unpin', 'favorite', 'unfavorite', 'edit', 'e'].includes(text)) { if (o.selected) o.action((text === 'e' ? 'edit' : text) as 'open' | 'reveal' | 'pin' | 'unpin' | 'favorite' | 'unfavorite' | 'edit', o.selected) }
    else if (['next', 'n', 'previous', 'prev', 'N'].includes(text)) {
      const step = text === 'next' || text === 'n' ? 1 : -1, i = o.sequence.findIndex(f => f.id === o.selectedId)
      const next = o.sequence[(i + step + o.sequence.length) % o.sequence.length]; if (next) o.select(next)
    } else o.notice(`Unknown command: ${text}. Use :help for supported browsing commands.`)
  }
  const historyCommand = (step: number) => { commandCursor.current = Math.max(0, Math.min(commandHistory.current.length, commandCursor.current + step)); setCommand(commandHistory.current[commandCursor.current] ?? '') }
  return { pending, visual: !!visual, range, command, setCommand, execute, historyCommand, searchDirection: direction, clearVisual: () => { previousVisual.current = visualRef.current; setVisual(null) } }
}
