import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { findInstalledEditor, openInTerminalEditor, terminalEditorCommand, TERMINAL_EDITOR_SCRIPT } from '../../src/daemon/util/openInTerminalEditor'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'starpalace-editor-test-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
const file = (path: string) => ({ path, mimeType: 'text/plain', platform: 'local' as const })

describe('Mac terminal editor launch', () => {
  it('prefers installed nvim, falls back to vim, and ignores nonexecutable/missing files', async () => {
    const first = join(directory, 'first'), second = join(directory, 'second')
    await mkdir(first); await mkdir(second)
    await writeFile(join(first, 'vim'), ''); await chmod(join(first, 'vim'), 0o755)
    await writeFile(join(second, 'nvim'), ''); await chmod(join(second, 'nvim'), 0o755)
    expect(await findInstalledEditor(`${first}:${second}`, [])).toEqual({ name: 'nvim', path: join(second, 'nvim') })
    await chmod(join(second, 'nvim'), 0o644)
    expect(await findInstalledEditor(`${first}:${second}`, [])).toEqual({ name: 'vim', path: join(first, 'vim') })
    expect(await findInstalledEditor(join(directory, 'missing'), [])).toBeNull()
  })
  it('passes shell metacharacters as literal filename arguments, including quotes and leading dashes', async () => {
    const fakeEditor = join(directory, "editor's script"), captured = join(directory, 'arguments.json')
    await writeFile(fakeEditor, `#!${process.execPath}\nrequire('fs').writeFileSync(process.env.EDITOR_TEST_CAPTURE,JSON.stringify(process.argv.slice(2)))\n`)
    await chmod(fakeEditor, 0o755)
    const dangerous = join(directory, '-note\'";$(touch unexpected);`echo nope` & *.md')
    await writeFile(dangerous, '# A real note')
    await promisify(execFile)('/bin/sh', ['-c', terminalEditorCommand(fakeEditor, dangerous)], { cwd: directory, env: { ...process.env, EDITOR_TEST_CAPTURE: captured } })
    expect(JSON.parse(await readFile(captured, 'utf8'))).toEqual(['--', dangerous])
    await expect(readFile(join(directory, 'unexpected'))).rejects.toThrow()
  })
  it('uses a constant AppleScript and separate argv rather than embedding a file path in script source', async () => {
    const path = join(directory, 'note "quoted".md'); await writeFile(path, '# Notes')
    const launch = vi.fn(async () => {})
    await expect(openInTerminalEditor(file(path), { platform: 'darwin', findEditor: async () => ({ name: 'nvim', path: '/opt/homebrew/bin/nvim' }), launch })).resolves.toEqual({ editor: 'nvim' })
    expect(launch).toHaveBeenCalledWith('/usr/bin/osascript', ['-e', TERMINAL_EDITOR_SCRIPT, terminalEditorCommand('/opt/homebrew/bin/nvim', path)])
    expect(TERMINAL_EDITOR_SCRIPT).not.toContain(path)
  })
  it('opens a validated section line and refuses stale or command-shaped locations', async () => {
    const path = join(directory, 'sections.md'), text = '# Title\r\n\r\n## Methods\r\nContent'
    await writeFile(path, text)
    const contentHash = createHash('sha256').update(text).digest('hex')
    const launch = vi.fn(async () => {}), dependencies = { platform: 'darwin' as const, launch, findEditor: async () => ({ name: 'nvim' as const, path: '/opt/homebrew/bin/nvim' }) }
    await openInTerminalEditor(file(path), { ...dependencies, section: { line: 3, sourceLine: '## Methods', contentHash } })
    expect(launch).toHaveBeenLastCalledWith('/usr/bin/osascript', ['-e', TERMINAL_EDITOR_SCRIPT, terminalEditorCommand('/opt/homebrew/bin/nvim', path, 3)])
    expect(terminalEditorCommand('/usr/bin/vim', path, 3)).toContain(' +3 -- ')
    launch.mockClear()
    await writeFile(path, '# Title\nNew line\n\n## Methods\nContent')
    await expect(openInTerminalEditor(file(path), { ...dependencies, section: { line: 3, sourceLine: '## Methods', contentHash } })).rejects.toMatchObject({ status: 409 })
    for (const line of [0, -1, 1.5, Infinity, 2097153]) expect(() => terminalEditorCommand('/usr/bin/vim', path, line)).toThrow()
    await expect(openInTerminalEditor(file(path), { ...dependencies, section: { line: 2, sourceLine: 'x\ny', contentHash } })).rejects.toMatchObject({ status: 400 })
    expect(launch).not.toHaveBeenCalled()
  })
  it('rejects unsupported, binary, missing, directory, and control-character paths without launching', async () => {
    const path = join(directory, 'binary.txt'); await writeFile(path, Buffer.from([0, 1, 2, 3]))
    const launch = vi.fn(async () => {}), dependencies = { platform: 'darwin' as const, launch, findEditor: async () => ({ name: 'vim' as const, path: '/usr/bin/vim' }) }
    await expect(openInTerminalEditor(file(path), dependencies)).rejects.toMatchObject({ status: 400 })
    await expect(openInTerminalEditor(file(directory), dependencies)).rejects.toMatchObject({ status: 400 })
    await expect(openInTerminalEditor(file(join(directory, 'missing.txt')), dependencies)).rejects.toMatchObject({ status: 404 })
    await expect(openInTerminalEditor({ ...file(path), path: join(directory, 'paper.pdf'), mimeType: 'application/pdf' }, dependencies)).rejects.toMatchObject({ status: 400 })
    await expect(openInTerminalEditor({ ...file(path), platform: 'google-drive' }, dependencies)).rejects.toMatchObject({ status: 400 })
    expect(() => terminalEditorCommand('/usr/bin/vim', '/tmp/line\nbreak.md')).toThrow()
    expect(() => terminalEditorCommand('vim', path)).toThrow()
    expect(launch).not.toHaveBeenCalled()
  })
  it('reports missing editors and macOS automation errors clearly', async () => {
    const path = join(directory, 'hello.txt'); await writeFile(path, 'Hello')
    const launch = vi.fn(async () => {})
    await expect(openInTerminalEditor(file(path), { platform: 'darwin', findEditor: async () => null, launch })).rejects.toMatchObject({ status: 503, message: expect.stringContaining('Neither editor') })
    expect(launch).not.toHaveBeenCalled()
    await expect(openInTerminalEditor(file(path), { platform: 'darwin', findEditor: async () => ({ name: 'vim', path: '/usr/bin/vim' }), launch: async () => { throw Error('Not authorized') } })).rejects.toMatchObject({ status: 503, message: expect.stringContaining('allow this app to control Terminal') })
    await expect(openInTerminalEditor(file(path), { platform: 'linux', launch })).rejects.toMatchObject({ status: 400 })
  })
})
