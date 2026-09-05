/** A small Normal-mode grammar. Unknown commands never become file mutations. */
export interface VimCommand { key: string; count: number; explicitCount: boolean; argument?: string }
export interface VimInput { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }
export class VimParser {
  private count = ''
  private prefix = ''
  get pending(): string { return this.count + this.prefix }
  reset(): void { this.count = ''; this.prefix = '' }
  feed(input: VimInput): { handled: boolean; command?: VimCommand } {
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(input.key)) return { handled: false }
    if (input.isComposing || input.metaKey || input.altKey) { this.reset(); return { handled: false } }
    const key = input.ctrlKey ? `Ctrl-${input.key.toLowerCase()}` : input.key
    if (key === 'Escape' || key === 'Ctrl-[') { this.reset(); return { handled: true, command: { key: 'Escape', count: 1, explicitCount: false } } }
    // Preserve native browser shortcuts (find, back, refresh, select/copy/paste, tabs).
    if (input.ctrlKey && !['Ctrl-d', 'Ctrl-u', 'Ctrl-e', 'Ctrl-y', 'Ctrl-o', 'Ctrl-i'].includes(key)) { this.reset(); return { handled: false } }
    if (this.prefix) {
      const prefix = this.prefix
      if ((prefix === 'm' || prefix === "'" || prefix === '`') && /^[a-zA-Z]$/.test(key)) return this.finish(prefix, key)
      if ((prefix === "'" || prefix === '`') && key === prefix) return this.finish('jump-back')
      if (['gg', 'ge', 'gE', 'gt', 'gT', 'gf', 'gv', 'zz', 'zt', 'zb', 'zf', 'yy', '[f', ']f', '[[', ']]', ' w', ' h', ' l', ' e'].includes(prefix + key)) return this.finish(prefix + key)
      this.reset(); return { handled: true }
    }
    if (/^[0-9]$/.test(key) && (key !== '0' || this.count)) { this.count = String(Math.min(999, Number(this.count + key))); return { handled: true } }
    if (['g', 'z', 'y', 'm', "'", '`', '[', ']', ' '].includes(key)) { this.prefix = key; return { handled: true } }
    if (['h', 'j', 'k', 'l', 'w', 'W', 'b', 'B', 'e', 'E', '0', '^', '$', 'G', 'H', 'M', 'L', '%', '{', '}', '(', ')', '/', '?', 'n', 'N', '*', '#', 'i', 'a', 'I', 'A', 'v', 'V', 'o', 'O', 'Enter', '+', '=', '-', ':', 'F1', 'P', 'PageDown', 'PageUp', 'Ctrl-d', 'Ctrl-u', 'Ctrl-e', 'Ctrl-y', 'Ctrl-o', 'Ctrl-i'].includes(key)) return this.finish(key)
    this.reset(); return { handled: false }
  }
  private finish(key: string, argument?: string): { handled: true; command: VimCommand } {
    const command = { key, count: Number(this.count) || 1, explicitCount: !!this.count, argument }
    this.reset(); return { handled: true, command }
  }
}

/** File ranges use a frozen sequence while Visual mode is active. */
export function fileRange(ids: readonly string[], anchor: string, cursor: string): string[] {
  const a = ids.indexOf(anchor), b = ids.indexOf(cursor)
  return a < 0 || b < 0 ? [] : ids.slice(Math.min(a, b), Math.max(a, b) + 1)
}
export function fileMotion(index: number, length: number, command: VimCommand, columns = 1): number {
  if (!length) return -1
  const { key, count, explicitCount } = command, current = Math.max(0, index)
  if (key === 'gg' || key === 'G') return Math.min(length - 1, explicitCount ? count - 1 : key === 'gg' ? 0 : length - 1)
  if (key === '%') return Math.min(length - 1, Math.max(0, Math.ceil(length * Math.min(100, count) / 100) - 1))
  if (key === '0' || key === '^') return Math.floor(current / columns) * columns
  if (key === '$') return Math.min(length - 1, (Math.floor(current / columns) + count) * columns - 1)
  const step = ['k'].includes(key) ? -columns : key === 'j' ? columns : ['h', 'b', 'B', 'ge', 'gE', '(', '{', '[f', '[['].includes(key) ? -1 : 1
  return Math.max(0, Math.min(length - 1, current + step * count))
}

export const VIM_HELP: readonly [string, string][] = [
  ['h j k l · counts (3j)', 'Pan the map; move through file rows/cards; scroll the focused reader.'],
  ['w / e / b · W / E / B', 'Next / previous file. In the reader, scroll forward / backward a line.'],
  ['gg / G · 12gg / 12G', 'First / last file in the loaded page, or numbered file. Reader: top / bottom or numbered line.'],
  ['0 / ^ / $ · H / M / L', 'Row boundaries; first / middle / last visible file. Reader: horizontal edges or visible page positions.'],
  ['{ / } · [[ / ]] · ( / )', 'Previous / next folder in files; previous / next heading in the reader (paragraphs for parentheses).'],
  ['Ctrl D / U · PageDown / Up', 'Half / full viewport scroll or map pan. Counts multiply distance.'],
  ['Ctrl E / Y', 'Scroll one line without changing the selected file.'],
  ['/ / ? · n / N · * / #', 'Forward / backward library search; next / previous result (text match in reader); search selected filename.'],
  ['i / a · Escape', 'Type in search. Escape leaves typing with query intact; another Escape clears search or returns.'],
  ['v / V · gv · y / yy', 'Select file range; restore last range; copy selected file paths. :collection saves the range.'],
  ['ma · \'a / `a · Ctrl O / I', 'Set / return to a session mark; older / newer keyboard jump. Double apostrophe returns to the previous jump.'],
  ['Space w / h / l', 'Switch panes / focus atlas / focus reader. Avoids the browser’s Ctrl W tab-close shortcut.'],
  ['gt / gT', 'Next / previous map, list, or grid view.'],
  ['Space e · :edit', 'Edit the selected plain-text or Markdown file in Terminal, preferring nvim over vim.'],
  ['Enter · o / O · gf', 'Expand reader; open file / reveal folder; open file in its default app.'],
  ['+ / − · zz / zt / zb · zf', 'Map zoom; center selected file (reader: center / top / bottom of current match); fit map.'],
  [':tutorials', 'Screenshot walkthroughs for the app’s features.'],
  [':fullscreen', 'Toggle the immersive atlas; Escape restores the previous workspace.'],
  [':help · F1 · :commands', 'Command reference. :map, :list, :grid, :next, :previous, :favorite, :unfavorite, :pin, :unpin, :collection, :marks, :q also work.'],
]

/** Move through a jump stack without replaying asynchronous intermediate restores. */
export function traverseJumps<T>(history: { past: T[]; future: T[] }, current: T, forward: boolean, count: number): T | undefined {
  const source = forward ? history.future : history.past, target = forward ? history.past : history.future
  let destination: T | undefined
  for (let i = 0; i < count && source.length; i++) { target.push(destination ?? current); destination = source.pop() }
  return destination
}
