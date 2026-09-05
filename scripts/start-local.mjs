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
let children = [], stopping = false, updating = false, paused = false, worker
let status = { state: 'idle', message: 'Updates follow the public main branch.' }
function announce(next) {
  status = next
  if (children[0]?.connected) children[0].send({ type: 'update-status', status })
  console.log('[update]', next.message)
}
function launch() {
  paused = false
  children = [
    spawn(process.execPath, ['--import', 'tsx', 'src/daemon/index.ts'], { cwd: root, env, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] }),
    spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.web.config.ts', '--host', '127.0.0.1', '--port', webPort, '--strictPort'], { cwd: root, env, stdio: 'inherit' }),
  ]
  const daemon = children[0]
  // The listener is installed during daemon startup, after the IPC channel opens.
  const ping = setInterval(() => { if (daemon.connected) daemon.send({ type: 'update-status', status }) }, 1000)
  daemon.on('exit', () => clearInterval(ping))
  daemon.on('message', message => { if (message?.type === 'update-request') startUpdate() })
  for (const child of children) {
    child.on('error', error => { console.error(error.message); if (!updating) stop(1) })
    child.on('exit', (code, signal) => { if (!stopping && !paused) stop(code ?? (signal ? 1 : 0)) })
  }
}
async function haltChildren() {
  paused = true
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
    const timeout = setTimeout(() => child.kill('SIGKILL'), 4000)
    child.once('exit', () => { clearTimeout(timeout); resolve() })
    child.kill('SIGTERM')
  })))
}
function startUpdate() {
  if (updating || stopping) return
  updating = true
  announce({ state: 'checking', message: 'Checking the release repository…' })
  worker = spawn(process.execPath, ['--import', 'tsx', 'scripts/update-local.ts'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], detached: true })
  let result
  worker.on('message', async message => {
    if (message.type === 'prepared') {
      announce({ state: 'installing', message: 'Installing the update. The app will reconnect automatically.' })
      await haltChildren()
      if (!stopping && worker.connected) worker.send({ type: 'proceed' })
    } else if (message.type === 'progress') announce({ state: 'installing', message: message.message })
    else if (message.type === 'done') result = { state: 'done', message: message.message, revision: message.revision }
    else if (message.type === 'failed') result = { state: 'error', message: message.message }
  })
  worker.on('error', error => { result = { state: 'error', message: error.message } })
  worker.on('exit', () => {
    updating = false
    announce(result ?? { state: 'error', message: 'The update was interrupted. Check the terminal and restart with npm start.' })
    if (paused && !stopping) launch()
  })
}
function stop(code) {
  if (stopping) return
  stopping = true; process.exitCode = code
  if (worker && worker.exitCode === null && worker.pid) { try { process.kill(-worker.pid, 'SIGTERM') } catch { worker.kill('SIGTERM') } }
  void haltChildren()
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
launch()
console.log('\nStar Palace → http://127.0.0.1:' + webPort + '\nKeep this terminal open. Press Control C to stop.\n')
