import { drawStellarObject } from '../../src/renderer/src/atlas/celestialSprites'
import { stellarAppearance } from '../../src/renderer/src/atlas/stellarVisual'
import { seedFor } from '../../src/renderer/src/atlas/scene'
import { setupEmailFeedback } from './feedback'
import { exampleFiles, matchingFiles, feedbackUrl, type ExampleFile } from './demo'

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T }
function object(canvas: HTMLCanvasElement, file: Pick<ExampleFile, 'bytes' | 'favorite'>, seed: number, close = false): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2)
  const appearance = stellarAppearance(seed, file.bytes, file.favorite)
  const size = close ? 1 : appearance.radiusScale / 2.1
  const scale = Math.min(canvas.width, canvas.height) / 128 * size
  ctx.scale(scale, scale)
  drawStellarObject(ctx, appearance.objectType, seed, appearance.color, true)
  ctx.restore()
  canvas.dataset.objectType = appearance.objectType
}
const formatBytes = (bytes: number): string => bytes < 1048576 ? Math.round(bytes / 1024) + ' KiB' : bytes < 1073741824 ? Math.round(bytes / 1048576) + ' MiB' : (bytes / 1073741824).toFixed(0) + ' GiB'
const search = element<HTMLInputElement>('galaxy-search')
const stars = element<HTMLDivElement>('file-stars')
let selected = exampleFiles[0]
const buttons = exampleFiles.map((file, index) => {
  const button = document.createElement('button')
  button.type = 'button'; button.className = 'file-star'
  button.style.left = file.x + '%'; button.style.top = file.y + '%'
  button.setAttribute('aria-label', 'Preview ' + file.name)
  button.setAttribute('aria-pressed', String(index === 0))
  const canvas = document.createElement('canvas')
  canvas.width = 156; canvas.height = 130; canvas.setAttribute('aria-hidden', 'true')
  const name = document.createElement('span')
  name.className = 'star-name'; name.textContent = file.name
  button.append(canvas, name); stars.append(button)
  object(canvas, file, seedFor(file.name))
  button.dataset.favorite = String(!!file.favorite)
  button.addEventListener('click', () => select(file))
  return button
})
function select(file: ExampleFile): void {
  selected = file
  buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(exampleFiles[i] === file)))
  element('preview-name').textContent = file.name
  element('preview-kind').textContent = file.kind + ' · ' + formatBytes(file.bytes) + (file.favorite ? ' · Favorite' : '')
  element('preview-path').textContent = file.folder
  element('preview-heading').textContent = file.name.replace(/\.[^.]+$/, '')
  element('preview-text').textContent = file.text
  element('preview-tag').textContent = file.tag
  object(element<HTMLCanvasElement>('preview-object'), file, seedFor(file.name), true)
  drawGalaxy()
}
function filter(): void {
  const matches = matchingFiles(search.value)
  buttons.forEach((button, i) => button.classList.toggle('is-dim', !matches.includes(exampleFiles[i])))
  element('demo-status').textContent = search.value.trim()
    ? matches.length + (matches.length === 1 ? ' match' : ' matches') + '. Choose a star to preview it.'
    : 'Try searching “garden”, or choose a star.'
  drawGalaxy()
}
search.addEventListener('input', filter)
element('demo-search').addEventListener('submit', event => {
  event.preventDefault()
  const first = matchingFiles(search.value)[0]
  if (first) select(first)
})
element('reset-demo').addEventListener('click', () => { search.value = ''; select(exampleFiles[0]); filter() })

const galaxy = element<HTMLCanvasElement>('galaxy')
function drawGalaxy(): void {
  const rect = galaxy.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2)
  if (!rect.width || !rect.height) return
  galaxy.width = Math.round(rect.width * dpr); galaxy.height = Math.round(rect.height * dpr)
  const ctx = galaxy.getContext('2d')
  if (!ctx) return
  ctx.scale(dpr, dpr)
  const w = rect.width, h = rect.height
  // Static, seeded dust follows an irregular trail. Redraw only on interaction/resize.
  let state = 73091
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  const groups = [
    { tag: 'garden', color: '#719ed1' },
    { tag: 'making', color: '#c08eab' },
    { tag: 'coast', color: '#cba16f' },
  ]
  for (const group of groups) {
    const members = exampleFiles.filter(file => file.tag === group.tag)
    for (const file of members) {
      const x = file.x / 100 * w, y = file.y / 100 * h
      const glow = ctx.createRadialGradient(x, y, 0, x, y, w * .14)
      glow.addColorStop(0, group.color + '19'); glow.addColorStop(.38, group.color + '0c'); glow.addColorStop(1, group.color + '00')
      ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
    }
  }
  for (let i = 0; i < 440; i++) {
    const t = random(), spread = (random() + random() + random() - 1.5)
    const x = (t * 1.02 + spread * .13) * w
    const y = (.53 - Math.sin(t * 7) * .15 + spread * .32) * h
    ctx.globalAlpha = .1 + random() * .44
    ctx.fillStyle = ['#f1f1e9', '#f1f1e9', '#eadfca', '#ead2a0', '#c4dcf1'][i % 5]
    ctx.beginPath(); ctx.arc(x, y, .25 + random() ** 3 * .8, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  const siblings = exampleFiles.filter(file => file.folder === selected.folder)
  ctx.strokeStyle = '#c5d9ef35'; ctx.lineWidth = .7
  ctx.beginPath()
  siblings.forEach((file, i) => { const x = file.x / 100 * w, y = file.y / 100 * h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
  ctx.stroke()

}
new ResizeObserver(drawGalaxy).observe(galaxy)
select(selected)
document.querySelectorAll<HTMLCanvasElement>('canvas[data-object]').forEach((canvas, index) => {
  if (canvas.dataset.object !== 'cloud') {
    object(canvas, { bytes: Number(canvas.dataset.bytes ?? 1048576), favorite: canvas.dataset.object === 'pulsar' ? 'pulsar' : undefined }, index * 227 + 47)
    return
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const members = [[.25, .56], [.39, .39], [.52, .52], [.64, .34], [.75, .6]]
  for (const [x, y] of members) {
    const glow = ctx.createRadialGradient(x * canvas.width, y * canvas.height, 0, x * canvas.width, y * canvas.height, canvas.width * .24)
    glow.addColorStop(0, '#719ed148'); glow.addColorStop(.5, '#719ed118'); glow.addColorStop(1, '#719ed100')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  members.forEach(([x, y], i) => {
    ctx.save(); ctx.translate(x * canvas.width, y * canvas.height); ctx.scale(.22, .22)
    drawStellarObject(ctx, 'main-sequence', i * 47, i % 2 ? '#ead2a0' : '#f1f1e9'); ctx.restore()
  })
})

const tutorial = [
  { title: 'Folder indexing', description: 'In Finder, select a folder and press Option–Command–C to copy its path. In Star Palace, open Library → Manage sources, paste it into Folder path, and choose Index folder. Start with one small folder. Names and text previews work without Ollama.', tip: 'Tip: reindex the same source to pick up changes.', visual: '<strong>Your sources</strong><span class="mini-label">Folder path</span><div class="mini-input">/Users/you/Documents/Field notes</div><span class="mini-button">Index folder ↗</span>' },
  { title: 'Search', description: 'Press ⌘ K and type a filename or a phrase from a document. Choose a result to find its place on the map. With Ollama running and your files embedded, Related meaning can help when you remember the idea but not the words.', tip: 'Tip: arrow keys select a result; Enter opens it.', visual: '<div class="mini-input">⌕ &nbsp; garden</div><div class="mini-row"><span>✧</span>A small garden.md<small>Markdown</small></div><div class="mini-row"><span>✦</span>Planting calendar.csv<small>CSV</small></div><div class="mini-row"><span>✧</span>Botany reading.pdf<small>PDF</small></div>' },
  { title: 'The reader', description: 'Select a celestial object to preview its file. Choose Expand, or press Enter, for the full reader. Use Open original to work in the file’s usual app, or Reveal in Finder to see its folder. Map, list, and grid views offer different ways to browse.', tip: 'Tip: scroll to zoom; drag the map to look around.', visual: '<span class="mini-label">Field notes / Garden</span><strong>A small garden.md</strong><p class="mini-text">Basil for the evenings,<br />mint for tea.</p><span class="mini-caption">Open original ↗ &nbsp; · &nbsp; Expand ↗</span>' },
  { title: 'Pins & saved places', description: 'Use Save place to remember the current view. Shift-drag a file to pin it somewhere meaningful, or add a tag in its file details. Save a set of search results as a collection. Choose Your atlas to return to the whole galaxy.', tip: 'Tip: ordinary indexing keeps existing file positions.', visual: '<strong>✧ &nbsp; Your places</strong><div class="mini-row"><span>✧</span>The whole galaxy</div><div class="mini-row"><span>⌖</span>The windowsill garden</div><span class="mini-button">Save place +</span>' },
]
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-step]')]
let step = 0
function setStep(next: number, focus = false): void {
  step = (next + tutorial.length) % tutorial.length
  const value = tutorial[step]
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === step)); tab.tabIndex = i === step ? 0 : -1 })
  element('tutorial-panel').setAttribute('aria-labelledby', 'step-' + step)
  element('tutorial-count').textContent = 'Step 0' + (step + 1)
  element('tutorial-title').textContent = value.title
  element('tutorial-description').textContent = value.description
  element('tutorial-tip').textContent = value.tip
  // All markup is authored above; no user input is rendered as HTML.
  element('tutorial-visual').innerHTML = '<div class="mini-window">' + value.visual + '</div>'
  element('next-step').innerHTML = step === 3 ? 'Start again <span aria-hidden="true">↺</span>' : 'Next <span aria-hidden="true">→</span>'
  if (focus) tabs[step].focus()
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setStep(index))
  tab.addEventListener('keydown', event => {
    const next = event.key === 'ArrowDown' ? step + 1 : event.key === 'ArrowUp' ? step - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : null
    if (next !== null) { event.preventDefault(); setStep(next, true) }
  })
})
element('next-step').addEventListener('click', () => setStep(step + 1))
setStep(0)
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const code = element(button.dataset.copy!)
    try {
      await navigator.clipboard.writeText(code.textContent ?? '')
      button.textContent = 'Copied'
    } catch {
      const range = document.createRange(); range.selectNodeContents(code)
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
      button.textContent = 'Select & copy'
    }
    setTimeout(() => { button.textContent = 'Copy' }, 2500)
  })
})
const feedbackForm = element<HTMLFormElement>('feedback-form')
if (feedbackForm.dataset.emailFeedback === 'true') setupEmailFeedback(feedbackForm)
else feedbackForm.addEventListener('submit', event => {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement
  if (!form.reportValidity()) return
  const data = new FormData(form)
  const url = feedbackUrl(String(data.get('kind')), String(data.get('summary')), String(data.get('message')))
  // Navigate in the same tab; the browser's Back button retains the draft.
  window.location.assign(url)
})
