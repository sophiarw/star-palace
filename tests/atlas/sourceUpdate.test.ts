import { describe, expect, it, vi } from 'vitest'
import { prepareSourceUpdate, installSourceUpdate } from '../../src/daemon/util/sourceUpdate'
import { runProcess } from '../../src/daemon/util/runProcess'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function runner(override: Record<string, string> = {}) {
  const responses: Record<string, string> = { 'branch --show-current': 'main', 'remote get-url origin': 'https://github.com/sophiarw/star-palace.git', 'status --porcelain --untracked-files=normal': '', 'rev-parse HEAD': 'old', 'rev-parse FETCH_HEAD': 'new', ...override }
  return vi.fn(async (_command: string, args: string[]) => responses[args.join(' ')] ?? '')
}
describe('Source update preflight', () => {
  it('fetches the official release and requires ancestry before mutation', async () => {
    const run = runner(); expect(await prepareSourceUpdate(run)).toEqual({ before: 'old', target: 'new' })
    expect(run.mock.calls.some(([, args]) => args.join(' ') === 'merge-base --is-ancestor old new')).toBe(true)
    expect(run.mock.calls.some(([, args]) => args.includes('reset') || args.includes('merge'))).toBe(false)
  })
  it.each([
    [{ 'branch --show-current': 'feat/atlas-revamp' }, 'Development branches'],
    [{ 'remote get-url origin': 'https://example.com/other.git' }, 'official'],
    [{ 'status --porcelain --untracked-files=normal': ' M README.md' }, 'local changes'],
  ])('rejects unsafe preflight %j', async (overrides, message) => {
    const run = runner(overrides); await expect(prepareSourceUpdate(run)).rejects.toThrow(message)
    expect(run.mock.calls.some(([, args]) => args.includes('fetch'))).toBe(false)
  })
  it('reports divergence without a checkout mutation', async () => {
    const base = runner(), run = vi.fn(async (command: string, args: string[]) => { if (args[0] === 'merge-base') throw new Error('diverged'); return base(command, args) })
    await expect(prepareSourceUpdate(run)).rejects.toThrow('diverged')
  })
})

describe('Source update installation in disposable repositories', () => {
  it('ignores inherited hook routing and configuration when opening another repository', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'starpalace-git-environment-'))), bait = join(root, 'caller'), target = join(root, 'target')
    try {
      await mkdir(bait); await mkdir(target)
      await runProcess('git', ['init'], { cwd: bait })
      const env = { ...process.env, GIT_DIR: join(bait, '.git'), GIT_COMMON_DIR: join(bait, '.git'), GIT_WORK_TREE: bait, GIT_INDEX_FILE: join(bait, '.git', 'index'), GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true' }
      await runProcess('git', ['init'], { cwd: target, env })
      expect((await runProcess('git', ['rev-parse', '--show-toplevel'], { cwd: target, env })).trim()).toBe(target)
      await runProcess('git', ['--git-dir=' + join(root, 'archive.git'), 'init', '--bare'], { cwd: target, env })
      expect((await runProcess('git', ['config', '--local', 'core.bare'], { cwd: bait })).trim()).toBe('false')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it.each([false, true])('keeps source and dependencies recoverable (build failure: %s)', async failure => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'starpalace-update-')))
    const git = (args: string[]) => runProcess('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root })
    try {
      await git(['init', '-b', 'main'])
      // Do not run any add/commit/reset unless Git confirms this disposable root.
      expect(await git(['rev-parse', '--show-toplevel'])).toBe(root + '\n')
      await writeFile(join(root, '.gitignore'), 'node_modules/\n.starpalace-update-backup/\n')
      await writeFile(join(root, 'package.json'), '{"version":"1"}')
      await git(['add', '.']); await git(['commit', '-m', 'Original'])
      const before = (await git(['rev-parse', 'HEAD'])).trim()
      await writeFile(join(root, 'package.json'), '{"version":"2"}'); await git(['add', '.']); await git(['commit', '-m', 'Update'])
      const target = (await git(['rev-parse', 'HEAD'])).trim()
      await git(['reset', '--hard', before])
      await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'fixture'), 'original dependencies')
      const run = async (command: string, args: string[]) => {
        if (command === 'git') return git(args)
        if (args[0] === 'ci') { await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'fixture'), 'updated dependencies') }
        if (failure && args.includes('build:web')) throw new Error('Fixture build failure')
        return ''
      }
      const install = installSourceUpdate(root, { before, target }, () => {}, run)
      if (failure) await expect(install).rejects.toThrow('previous release was restored')
      else await install
      expect((await git(['rev-parse', 'HEAD'])).trim()).toBe(failure ? before : target)
      expect(await readFile(join(root, 'node_modules', 'fixture'), 'utf8')).toBe(failure ? 'original dependencies' : 'updated dependencies')
      expect((await git(['status', '--porcelain'])).trim()).toBe('')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
