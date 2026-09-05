import { constants } from 'node:fs'
import { mkdir, open, lstat, writeFile } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, extname, join } from 'node:path'
import type { AtlasStore } from '../atlas/AtlasStore'
import type { TextHistoryFile, TextHistoryStatus, TextHistoryVersion, TextVersion } from '../../shared/history'
import { runProcess } from '../util/runProcess'

export const HISTORY_MAX_BYTES = 1024 * 1024
const TEXT_EXTENSIONS = new Set('md markdown mdx txt text py pyw js jsx ts tsx mjs cjs json jsonc yaml yml toml ini cfg conf csv tsv xml html htm css scss sass less sql sh bash zsh fish rs go c h cc cpp hpp java kt kts swift rb php r lua rmd tex bib rst adoc vue svelte'.split(' '))
export function historyEligibility(name: string, size: number): string | null {
  if (!TEXT_EXTENSIONS.has(extname(name).slice(1).toLowerCase()) && !['makefile', 'dockerfile', 'license', 'readme', '.gitignore', '.editorconfig'].includes(name.toLowerCase())) return 'History supports text and source files only.'
  if (size > HISTORY_MAX_BYTES) return 'Text history is limited to 1 MiB per file.'
  return null
}
export function decodeHistoryText(bytes: Buffer): string {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (bytes.some(code => code < 32 && code !== 9 && code !== 10 && code !== 13)) throw new Error('Binary content is excluded from text history.')
  return text
}

/** One private bare Git archive. Source repositories and working trees are never modified. */
export class TextHistory {
  private ready: Promise<void> | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = true
  private after = ''
  private stamps = new Map<string, string>()
  private failures = new Map<string, string>()
  private storageBytes = 0
  private captured = 0
  private error: string | null = null
  private scanning = false
  constructor(readonly store: AtlasStore, readonly directory: string, readonly maxBytes = 512 * 1024 * 1024) {
    store.index.db.exec('CREATE TABLE IF NOT EXISTS text_history_sources(galaxy_id INTEGER PRIMARY KEY REFERENCES galaxies(id), enabled INTEGER NOT NULL DEFAULT 0)')
  }
  private ref(id: string): string { return 'refs/files/' + createHash('sha256').update(id).digest('hex') }
  private git(args: string[], input?: Buffer | string): Promise<string> {
    return runProcess('git', ['--git-dir=' + this.directory, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      input, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Star Palace', GIT_AUTHOR_EMAIL: 'history@localhost', GIT_COMMITTER_NAME: 'Star Palace', GIT_COMMITTER_EMAIL: 'history@localhost' },
    })
  }
  private initialize(): Promise<void> {
    if (!this.ready) this.ready = mkdir(this.directory, { recursive: true, mode: 0o700 }).then(() => this.git(['init', '--bare', '--quiet'])).then(() => undefined).catch(error => { this.ready = undefined; throw error })
    return this.ready
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work)
    this.queue = next.catch(() => {})
    return next
  }
  status(): TextHistoryStatus {
    const enabled = new Set((this.store.index.db.prepare('SELECT galaxy_id FROM text_history_sources WHERE enabled=1').all() as { galaxy_id: number }[]).map(s => s.galaxy_id))
    return { sources: this.store.index.listGalaxies().filter(g => !g.rootPath.startsWith('__default__')).map(g => ({ id: g.id, name: g.name, enabled: enabled.has(g.id) })), storageBytes: this.storageBytes, maxBytes: this.maxBytes, captured: this.captured, skipped: this.failures.size, error: this.error, scanning: this.scanning }
  }
  async enable(id: number, enabled: boolean): Promise<void> {
    if (!this.store.index.getGalaxy(id)) throw new Error('Source not found')
    if (enabled) await this.initialize()
    this.store.index.db.prepare('INSERT INTO text_history_sources VALUES(?,?) ON CONFLICT(galaxy_id) DO UPDATE SET enabled=excluded.enabled').run(id, Number(enabled))
    this.stamps.clear(); this.after = ''; this.error = null
  }
  private enabled(id: string): boolean {
    return !!this.store.index.db.prepare('SELECT 1 FROM files f JOIN text_history_sources s ON s.galaxy_id=f.galaxy_id WHERE f.id=? AND s.enabled=1').get(id)
  }
  private async head(id: string): Promise<string | null> {
    const refs = await this.git(['for-each-ref', '--format=%(objectname)', this.ref(id)])
    return refs.trim() || null
  }
  async versions(id: string): Promise<TextHistoryFile> {
    const file = this.store.index.get(id)
    if (!file) throw new Error('File not found')
    const reason = historyEligibility(file.name, file.size) ?? this.failures.get(id) ?? null
    // Reading a disabled, never-created archive should not create one.
    const exists = await lstat(join(this.directory, 'HEAD')).then(() => true).catch(() => false)
    const head = exists ? await this.head(id) : null
    const log = head ? await this.git(['log', '-100', '--format=%H %ct', head, '--']) : ''
    const versions: TextVersion[] = log.trim() ? log.trim().split('\n').map(line => { const [hash, time] = line.split(' '); return { id: hash, capturedAt: Number(time) * 1000 } }) : []
    return { enabled: this.enabled(id), eligible: !reason, reason, versions }
  }
  async version(id: string, hash: string): Promise<TextHistoryVersion> {
    if (!this.store.index.get(id) || !/^[a-f0-9]{40}$/.test(hash)) throw new Error('Invalid file version')
    await this.git(['merge-base', '--is-ancestor', hash, this.ref(id)])
    const content = await this.git(['show', hash + ':content'])
    const diff = await this.git(['show', '--format=', '--no-ext-diff', '--no-textconv', '--root', '--patch', hash, '--', 'content'])
    return { content, diff }
  }
  async restoreCopy(id: string, hash: string): Promise<string> {
    const version = await this.version(id, hash), file = this.store.index.get(id)
    if (!file) throw new Error('File not found')
    const extension = extname(file.path), stem = basename(file.path, extension)
    const path = join(dirname(file.path), `${stem}.recovered-${hash.slice(0, 7)}-${randomBytes(3).toString('hex')}${extension}`)
    await writeFile(path, version.content, { flag: 'wx', mode: 0o600 })
    return path
  }
  capture(id: string): Promise<boolean> { return this.serial(() => this.captureOne(id)) }
  private async captureOne(id: string): Promise<boolean> {
    const file = this.store.index.get(id)
    if (!file || !this.enabled(id)) return false
    const ineligible = historyEligibility(file.name, 0)
    if (ineligible) { this.failures.set(id, ineligible); return false }
    const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const before = await handle.stat()
      if (!before.isFile() || before.size > HISTORY_MAX_BYTES) { this.failures.set(id, 'Only regular text files up to 1 MiB are captured.'); return false }
      const stamp = `${before.dev}:${before.ino}:${before.mtimeMs}:${before.ctimeMs}:${before.size}`
      if (this.stamps.get(id) === stamp) return false
      // Wait for saves to settle; the next scan catches atomic replacement too.
      if (Date.now() - before.mtimeMs < 2000) return false
      const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
      const after = await handle.stat(), current = await lstat(file.path)
      if (bytesRead !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== current.ino || before.dev !== current.dev) return false
      let text: string
      try { text = decodeHistoryText(bytes.subarray(0, bytesRead)) } catch { this.failures.set(id, 'Only UTF-8 text without binary control bytes is captured.'); this.stamps.set(id, stamp); return false }
      await this.initialize()
      const head = await this.head(id)
      const blob = (await this.git(['hash-object', '--stdin'], bytes.subarray(0, bytesRead))).trim()
      const previous = head ? (await this.git(['rev-parse', head + ':content'])).trim() : null
      if (!this.enabled(id)) return false
      if (blob !== previous) {
        const sizes = await this.git(['count-objects', '-v'])
        this.storageBytes = sizes.split('\n').reduce((sum, line) => { const [key, value] = line.split(': '); return sum + (key === 'size' || key === 'size-pack' ? Number(value) * 1024 : 0) }, 0)
        if (this.storageBytes + before.size > this.maxBytes) throw new Error('The local history archive reached its 512 MiB budget. Existing versions remain available; pause capture in Settings.')
        await this.git(['hash-object', '-w', '--stdin'], bytes.subarray(0, bytesRead))
        const tree = (await this.git(['mktree'], `100644 blob ${blob}\tcontent\n`)).trim()
        const commit = (await this.git(['commit-tree', tree, ...(head ? ['-p', head] : [])], 'Saved text version for ' + id + '\n')).trim()
        await this.git(['update-ref', this.ref(id), commit, head ?? '0'.repeat(40)])
        this.captured++
      }
      this.stamps.set(id, stamp); this.failures.delete(id)
      // Update lexical content without disturbing layout or authored metadata.
      this.store.index.db.prepare('UPDATE files SET size=?,modified_at=? WHERE id=? AND path=?').run(before.size, before.mtimeMs, id, file.path)
      this.store.syncBatch(64)
      this.store.setText(id, text, 'ready', `${before.mtimeMs}:${before.size}`, null)
      return blob !== previous
    } finally { await handle.close() }
  }
  start(): void {
    this.stopped = false; this.schedule(0)
    void lstat(join(this.directory, 'HEAD')).then(() => this.git(['count-objects', '-v'])).then(sizes => {
      this.storageBytes = sizes.split('\n').reduce((sum, line) => { const [key, value] = line.split(': '); return sum + (key === 'size' || key === 'size-pack' ? Number(value) * 1024 : 0) }, 0)
    }).catch(() => {})
  }
  stop(): void { this.stopped = true; if (this.timer) clearTimeout(this.timer) }
  private schedule(ms: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => { void this.scan().catch(error => { this.error = String(error) }).finally(() => this.schedule(this.after ? 25 : 2000)) }, ms)
    this.timer.unref()
  }
  async scan(): Promise<void> {
    if (this.scanning) return
    this.scanning = true
    try {
      const rows = this.store.index.db.prepare('SELECT f.id FROM files f JOIN text_history_sources s ON s.galaxy_id=f.galaxy_id WHERE s.enabled=1 AND f.id>? ORDER BY f.id LIMIT 16').all(this.after) as { id: string }[]
      for (const row of rows) {
        try { await this.capture(row.id) } catch (error) { this.failures.set(row.id, error instanceof Error ? error.message : String(error)); this.error = 'Some files could not be captured. Open their History for details; capture will retry.' }
      }
      this.after = rows.length === 16 ? rows[rows.length - 1].id : ''
      if (!this.after && !this.failures.size) this.error = null
    } finally { this.scanning = false }
  }
}
