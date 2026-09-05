import { spawn } from 'node:child_process'

/** Literal argv and bounded output; never invokes a shell. */
export function runProcess(command: string, args: string[], options: { cwd?: string; input?: Buffer | string; env?: NodeJS.ProcessEnv; timeout?: number; maxBytes?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    // Hooks export repository-routing variables. A child with an explicit cwd
    // must never inherit an index, object store, or worktree from its caller.
    const env = { ...(options.env ?? process.env) }
    for (const key of Object.keys(env)) {
      if (/^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_.*|CONFIG_VALUE_.*)$/.test(key)) delete env[key]
    }
    const child = spawn(command, args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const output: Buffer[] = [], errors: Buffer[] = []
    let bytes = 0, failure: Error | undefined
    const timer = setTimeout(() => { failure = new Error(`${command} timed out`); child.kill('SIGKILL') }, options.timeout ?? 30000)
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > (options.maxBytes ?? 4 * 1024 * 1024)) { failure = new Error(`${command} output exceeded its limit`); child.kill('SIGKILL') }
      else target.push(chunk)
    }
    child.stdout.on('data', collect(output)); child.stderr.on('data', collect(errors))
    child.stdin.on('error', () => { /* Process failure is reported on close. */ })
    child.on('error', error => { failure = error })
    child.on('close', code => {
      clearTimeout(timer)
      if (failure || code !== 0) reject(failure ?? new Error(Buffer.concat(errors).toString().trim() || `${command} exited with ${code}`))
      else resolve(Buffer.concat(output).toString('utf8'))
    })
    child.stdin.end(options.input)
  })
}
