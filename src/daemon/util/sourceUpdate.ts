import { runProcess } from './runProcess'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OFFICIAL_REMOTES = new Set(['git@github.com:sophiarw/star-palace.git', 'https://github.com/sophiarw/star-palace.git', 'https://github.com/sophiarw/star-palace', 'ssh://git@github.com/sophiarw/star-palace.git'])
type Runner = (command: string, args: string[]) => Promise<string>

/** Validates before any checkout mutation; exported for isolated repository tests. */
export async function prepareSourceUpdate(run: Runner): Promise<{ before: string; target: string }> {
  const branch = (await run('git', ['branch', '--show-current'])).trim()
  if (branch !== 'main') throw new Error('Automatic updates require the main release branch. Development branches are left intact.')
  const remote = (await run('git', ['remote', 'get-url', 'origin'])).trim()
  if (!OFFICIAL_REMOTES.has(remote)) throw new Error('The origin remote is not the official Star Palace repository.')
  if ((await run('git', ['status', '--porcelain', '--untracked-files=normal'])).trim()) throw new Error('This checkout has local changes. Commit or move them before updating.')
  const before = (await run('git', ['rev-parse', 'HEAD'])).trim()
  await run('git', ['-c', 'core.hooksPath=/dev/null', 'fetch', 'origin', 'refs/heads/main'])
  const target = (await run('git', ['rev-parse', 'FETCH_HEAD'])).trim()
  try { await run('git', ['merge-base', '--is-ancestor', before, target]) } catch { throw new Error('The local branch has diverged from the release. No files were changed.') }
  return { before, target }
}

export async function installSourceUpdate(root: string, prepared: { before: string; target: string }, report: (message: string) => void, runner?: Runner): Promise<void> {
  const run: Runner = runner ?? ((command, args) => runProcess(command, args, { cwd: root, timeout: 600000, maxBytes: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }))
  if ((await run('git', ['rev-parse', 'HEAD'])).trim() !== prepared.before || (await run('git', ['status', '--porcelain'])).trim()) throw new Error('The checkout changed while checking. Try again after saving your work.')
  const backup = join(root, '.starpalace-update-backup'), modules = join(root, 'node_modules')
  // Refuse to overwrite recovery files from an interrupted update.
  await mkdir(backup)
  await writeFile(join(backup, 'revision.json'), JSON.stringify(prepared))
  let savedDependencies = false, dependenciesChanged = false
  try {
    await run('git', ['-c', 'core.hooksPath=/dev/null', 'merge', '--ff-only', prepared.target])
    dependenciesChanged = !!(await run('git', ['diff', '--name-only', prepared.before, prepared.target, '--', 'package-lock.json', 'package.json'])).trim()
    if (dependenciesChanged) {
      report('Installing dependencies…')
      await rename(modules, join(backup, 'node_modules')); savedDependencies = true
      await run('npm', ['ci', '--no-audit', '--no-fund'])
    }
    report('Building Star Palace…')
    await run('npm', ['run', 'build:web']); await run('npm', ['run', 'build:daemon'])
  } catch (error) {
    // Preserve edits made during the update; reset --keep will refuse conflicts.
    const head = (await run('git', ['rev-parse', 'HEAD'])).trim()
    if (head === prepared.target && !(await run('git', ['status', '--porcelain'])).trim()) {
      report('Update failed. Restoring the previous release…')
      await run('git', ['-c', 'core.hooksPath=/dev/null', 'reset', '--keep', prepared.before])
      if (savedDependencies) { await rm(modules, { recursive: true, force: true }); await rename(join(backup, 'node_modules'), modules) }
      await rm(backup, { recursive: true, force: true })
      throw new Error('The update failed; the previous release was restored. ' + String(error))
    }
    throw new Error('The update failed and the checkout has changed. Your changes were preserved. Run npm install and npm start after reviewing the checkout. ' + String(error))
  }
  await rm(backup, { recursive: true, force: true })
}
