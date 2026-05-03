import { execFile, spawn } from 'child_process'
import { platform } from 'os'
import { dirname } from 'path'

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

// Reveal a file in the OS file explorer (Finder / Explorer / file manager),
// highlighting the file inside its containing folder when the platform
// supports it. Same shell-injection-safe spawn pattern as openInDefaultApp.
//
// macOS: `open -R <path>` reveals + highlights in Finder.
// Windows: `explorer /select,<path>` opens the parent folder with the file
//   selected. The `/select,<path>` token must be one argument (no space after
//   the comma); `windowsVerbatimArguments` keeps the embedded comma intact.
// Linux/other: xdg-open has no native "select file" flag, so we fall back to
//   opening the parent directory. The file is not highlighted.
export function revealInFileExplorer(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onExit = (err: Error | null) => (err ? reject(err) : resolve())
    if (platform() === 'win32') {
      const child = spawn('explorer', [`/select,${filePath}`], { windowsVerbatimArguments: true })
      child.on('error', reject)
      // explorer.exe returns non-zero (often 1) even on success, so we resolve
      // on any exit and only reject on a spawn error.
      child.on('exit', () => resolve())
    } else if (platform() === 'darwin') {
      execFile('open', ['-R', filePath], onExit)
    } else {
      execFile('xdg-open', [dirname(filePath)], onExit)
    }
  })
}
