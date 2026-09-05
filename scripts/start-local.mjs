import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const demo = process.argv.includes('--demo')
const daemonPort = demo ? '7374' : (process.env.STARPALACE_PORT || '7373')
const webPort = demo ? '5174' : (process.env.STARPALACE_WEB_PORT || '5173')
const env = { ...process.env, STARPALACE_PORT: daemonPort, VITE_DAEMON_PORT: daemonPort }
if (demo) {
  env.STARPALACE_DIR = resolve(root, '.atlas-dev')
  env.STARPALACE_DB = resolve(root, '.atlas-dev', 'index.db')
}
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'src/daemon/index.ts'], { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.web.config.ts', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], { cwd: root, env, stdio: 'inherit' }),
]
let stopping = false
function stop(code) {
  if (stopping) return
  stopping = true
  process.exitCode = code
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM')
  const timeout = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL') }, 4000)
  timeout.unref()
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', (code, signal) => { if (!stopping) stop(code ?? (signal ? 1 : 0)) })
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
console.log('\nStar Palace → http://127.0.0.1:' + webPort + '\nKeep this terminal open. Press Control C to stop.\n')
