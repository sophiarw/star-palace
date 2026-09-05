import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, open, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { FileNode } from '../../shared/types'
import type { EditorSection } from '../../shared/section'
import { createHash } from 'node:crypto'

export type TerminalEditorName = 'nvim' | 'vim'
export interface TerminalEditor { name: TerminalEditorName; path: string }
export class TerminalEditorError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'TerminalEditorError' }
}
const hasControlCharacters = (value: string): boolean => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const SUPPORTED_EXTENSION = /\.(md|markdown|txt|text)$/i
export function supportsTerminalEditor(file: Pick<FileNode, 'path' | 'mimeType' | 'platform'>): boolean {
  return file.platform === 'local' && (SUPPORTED_EXTENSION.test(file.path) || ['text/plain', 'text/markdown'].includes(file.mimeType))
}

/** Prefer nvim across all known install locations before falling back to vim. */
export async function findInstalledEditor(searchPath = process.env.PATH ?? '', fallbackDirectories = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']): Promise<TerminalEditor | null> {
  const directories = [...new Set([...searchPath.split(':'), ...fallbackDirectories])].filter(directory => isAbsolute(directory) && !hasControlCharacters(directory))
  for (const name of ['nvim', 'vim'] as const) for (const directory of directories) {
    const path = join(directory, name)
    try { if ((await stat(path)).isFile()) { await access(path, constants.X_OK); return { name, path } } } catch { /* not installed here */ }
  }
  return null
}

/** Terminal uses a shell, so every executable/path stays one literal argument. */
export function terminalEditorCommand(editorPath: string, filePath: string, line?: number): string {
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1 || line > 2097152)) throw new TerminalEditorError('Invalid section line.', 400)
  if (![editorPath, filePath].every(path => isAbsolute(path) && !hasControlCharacters(path))) throw new TerminalEditorError('This filename cannot be sent safely to Terminal.', 400)
  const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'"
  return `exec ${quote(editorPath)}${line === undefined ? '' : ' +' + line} -- ${quote(filePath)}`
}

// User data is an argv value, never interpolated into AppleScript source.
export const TERMINAL_EDITOR_SCRIPT = `on run argv
  tell application "Terminal"
    do script (item 1 of argv)
    activate
  end tell
end run`
export interface TerminalEditorDependencies {
  section?: EditorSection
  platform?: NodeJS.Platform
  findEditor?: () => Promise<TerminalEditor | null>
  launch?: (executable: string, args: string[]) => Promise<void>
}
function launch(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => execFile(executable, args, { timeout: 10000 }, error => error ? reject(error) : resolve()))
}
export async function openInTerminalEditor(file: Pick<FileNode, 'path' | 'mimeType' | 'platform'>, dependencies: TerminalEditorDependencies = {}): Promise<{ editor: TerminalEditorName }> {
  const section = dependencies.section
  if (section && (!Number.isSafeInteger(section.line) || section.line < 1 || section.line > 2097152 || typeof section.sourceLine !== 'string' || section.sourceLine.length > 8192 || /[\r\n]/.test(section.sourceLine) || !/^[a-f0-9]{64}$/.test(section.contentHash ?? ''))) throw new TerminalEditorError('Invalid section location.', 400)
  if ((dependencies.platform ?? process.platform) !== 'darwin') throw new TerminalEditorError('Terminal editing is currently supported on Mac.', 400)
  if (!supportsTerminalEditor(file)) throw new TerminalEditorError('Terminal editing supports local plain-text and Markdown files.', 400)
  if (!isAbsolute(file.path) || hasControlCharacters(file.path)) throw new TerminalEditorError('This filename cannot be sent safely to Terminal.', 400)
  let handle
  try {
    handle = await open(file.path, constants.O_RDONLY | constants.O_NONBLOCK)
    const before = await handle.stat()
    if (!before.isFile()) throw new TerminalEditorError('Choose a regular text file to edit.', 400)
    const sample = Buffer.alloc(8192), { bytesRead } = await handle.read(sample, 0, sample.length, 0)
    // An extension is not sufficient proof: reject binary data before invoking
    // an interactive editor. Text encodings containing NUL need their own viewer.
    if (sample.subarray(0, bytesRead).includes(0)) throw new TerminalEditorError('This file contains binary data and cannot be opened as plain text.', 400)
    if (section) {
      const buffer = Buffer.alloc(Math.min(before.size, 2097152))
      let read = 0
      while (read < buffer.length) { const chunk = await handle.read(buffer, read, buffer.length - read, read); if (!chunk.bytesRead) break; read += chunk.bytesRead }
      const text = buffer.subarray(0, read).toString('utf8'), actual = text.split(/\r\n|\n|\r/)[section.line - 1]
      const after = await handle.stat(), current = await stat(file.path)
      if (actual !== section.sourceLine || createHash('sha256').update(text).digest('hex') !== section.contentHash || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs) throw new TerminalEditorError('This section changed on disk. Refresh the document before editing this passage.', 409)
    }
  } catch (error) {
    if (error instanceof TerminalEditorError) throw error
    throw new TerminalEditorError('This file is missing or cannot be read at its indexed path.', 404)
  } finally { await handle?.close() }
  const editor = await (dependencies.findEditor ?? findInstalledEditor)()
  if (!editor) throw new TerminalEditorError('Install Neovim or Vim, then try again. Neither editor was found on this Mac.', 503)
  const command = terminalEditorCommand(editor.path, file.path, section?.line)
  try { await (dependencies.launch ?? launch)('/usr/bin/osascript', ['-e', TERMINAL_EDITOR_SCRIPT, command]) }
  catch { throw new TerminalEditorError('Could not open Terminal. If macOS asks, allow this app to control Terminal, then try again.', 503) }
  return { editor: editor.name }
}
