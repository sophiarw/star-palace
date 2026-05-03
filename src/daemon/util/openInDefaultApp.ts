import { execFile, spawn } from 'child_process'
import { platform } from 'os'

// Open a path in the OS default application without invoking a shell, so
// filenames that contain quotes, backticks, or `$(…)` cannot become RCE.
export function openInDefaultApp(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onExit = (err: Error | null) => (err ? reject(err) : resolve())
    if (platform() === 'win32') {
      // `start` is a cmd builtin; pass the path as a verbatim positional
      // argument so cmd does not re-parse it. The empty "" is the window title
      // (`start` treats the first quoted arg as the title otherwise).
      const child = spawn('cmd', ['/c', 'start', '', filePath], { windowsVerbatimArguments: true })
      child.on('error', reject)
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`cmd start exited ${code}`))))
    } else if (platform() === 'darwin') {
      execFile('open', [filePath], onExit)
    } else {
      execFile('xdg-open', [filePath], onExit)
    }
  })
}
