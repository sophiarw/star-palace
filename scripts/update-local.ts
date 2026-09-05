import { prepareSourceUpdate, installSourceUpdate } from '../src/daemon/util/sourceUpdate'
import { runProcess } from '../src/daemon/util/runProcess'

async function main(): Promise<void> {
  const root = process.cwd()
  const prepared = await prepareSourceUpdate((command, args) => runProcess(command, args, { cwd: root, timeout: 120000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }))
  if (prepared.before === prepared.target) { process.send?.({ type: 'done', message: 'Star Palace is up to date.', revision: prepared.target }); return }
  const proceed = new Promise<void>(resolve => process.once('message', message => { if ((message as { type?: string }).type === 'proceed') resolve() }))
  process.send?.({ type: 'prepared' })
  await proceed
  await installSourceUpdate(root, prepared, message => process.send?.({ type: 'progress', message }))
  process.send?.({ type: 'done', message: 'Star Palace is updated.', revision: prepared.target })
}
void main().catch(error => { process.send?.({ type: 'failed', message: error instanceof Error ? error.message : String(error) }); process.exitCode = 1 }).finally(() => process.disconnect?.())
