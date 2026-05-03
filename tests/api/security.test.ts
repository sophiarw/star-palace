import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process so we can observe how openInDefaultApp invokes the OS.
// Hoisted before the import below.
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb?: (err: Error | null) => void) => {
    if (cb) cb(null)
  }),
  spawn: vi.fn(() => {
    const handlers: Record<string, (arg?: unknown) => void> = {}
    return {
      on(ev: string, h: (arg?: unknown) => void) {
        handlers[ev] = h
        if (ev === 'exit') queueMicrotask(() => h(0))
      },
      emit(ev: string, arg?: unknown) {
        handlers[ev]?.(arg)
      },
    }
  }),
}))

import { execFile } from 'child_process'
import { openInDefaultApp } from '../../src/daemon/util/openInDefaultApp'

const MALICIOUS_PATHS = [
  '/tmp/innocent;rm -rf $HOME',
  '/tmp/with space/$(touch /tmp/pwned).txt',
  '/tmp/`whoami`.md',
  '/tmp/"quoted" file.txt',
]

describe('openInDefaultApp shell-injection resistance', () => {
  beforeEach(() => {
    vi.mocked(execFile).mockClear()
    vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, cb: unknown) => {
      if (typeof cb === 'function') (cb as (err: Error | null) => void)(null)
    }) as never)
  })

  for (const malicious of MALICIOUS_PATHS) {
    it(`passes ${JSON.stringify(malicious)} as a single arg, never via a shell`, async () => {
      // skip on win32 (covered by spawn path); macOS + linux use execFile
      if (process.platform === 'win32') return

      await openInDefaultApp(malicious)

      const call = vi.mocked(execFile).mock.calls.at(-1)
      expect(call).toBeDefined()
      const [cmd, args] = call!
      expect(['open', 'xdg-open']).toContain(cmd)
      expect(args).toEqual([malicious])
      // Critical assertion: no element of args concatenates the path with shell metacharacters
      // around it, and the command itself isn't a shell like /bin/sh -c "...".
      expect(cmd).not.toMatch(/sh|bash|cmd|powershell/i)
    })
  }
})
