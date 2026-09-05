import { drawObject } from '../../src/renderer/src/atlas/celestialSprites'
import { isStarType } from '../../src/shared/types'
import { exampleFiles, matchingFiles, feedbackUrl, type ExampleFile } from './demo'

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T }
function object(canvas: HTMLCanvasElement, file: Pick<ExampleFile, 'type'>, seed: number): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2)
  const scale = Math.min(canvas.width, canvas.height) / 125
  ctx.scale(scale, scale); drawObject(ctx, file.type, seed, true); ctx.restore()
}
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
  object(canvas, file, index * 779 + 142)
  button.addEventListener('click', () => select(file))
  return button
})
function select(file: ExampleFile): void {
  selected = file
  buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(exampleFiles[i] === file)))
  element('preview-name').textContent = file.name
  element('preview-kind').textContent = file.kind.toUpperCase()
  element('preview-path').textContent = file.folder
  element('preview-heading').textContent = file.name.replace(/\.[^.]+$/, '')
  element('preview-text').textContent = file.text
  element('preview-tag').textContent = file.tag
  object(element<HTMLCanvasElement>('preview-object'), file, exampleFiles.indexOf(file) * 779 + 142)
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
  for (let i = 0; i < 11; i++) {
    const x = (.16 + i * .066) * w, y = (.55 - Math.sin(i * .67) * .18) * h
    const glow = ctx.createRadialGradient(x, y, 0, x, y, w * .22)
    glow.addColorStop(0, i % 2 ? '#6277970b' : '#9c829c0a'); glow.addColorStop(1, '#26354a00')
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h)
  }
  for (let i = 0; i < 550; i++) {
    const t = random(), spread = (random() + random() + random() - 1.5)
    const x = (t * 1.02 + spread * .13) * w
    const y = (.53 - Math.sin(t * 7) * .15 + spread * .32) * h
    ctx.globalAlpha = .1 + random() * .35
    ctx.fillStyle = i % 3 ? '#9fb4d1' : '#d9c59f'
    ctx.beginPath(); ctx.arc(x, y, .35 + random() * .75, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  const group = exampleFiles.filter(file => file.tag === selected.tag)
  ctx.strokeStyle = '#c3b59530'; ctx.lineWidth = .7
  ctx.beginPath()
  group.forEach((file, i) => { const x = file.x / 100 * w, y = file.y / 100 * h; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
  ctx.stroke()
}
new ResizeObserver(drawGalaxy).observe(galaxy)
select(selected)
document.querySelectorAll<HTMLCanvasElement>('canvas[data-object]').forEach((canvas, index) => {
  const type = canvas.dataset.object
  if (isStarType(type)) object(canvas, { type }, index * 227 + 47)
})

const tutorial = [
  { title: 'Folder indexing', description: 'Open Manage sources, enter a folder path, give it a name if you like, and choose Index folder. Start small while you get a feel for the map. Names and text previews work without Ollama.', tip: 'Tip: reindex the same source to pick up changes.', visual: '<strong>Your sources</strong><span class="mini-label">Folder path</span><div class="mini-input">/Users/you/Documents/Field notes</div><span class="mini-button">Index folder ↗</span>' },
  { title: 'Search', description: 'Press ⌘ K and type a filename or a phrase from a document. Choose a result to find its place on the map. With Ollama running and your files embedded, Related meaning can help when you remember the idea but not the words.', tip: 'Tip: arrow keys select a result; Enter opens it.', visual: '<div class="mini-input">⌕ &nbsp; garden</div><div class="mini-row"><span>✧</span>A small garden.md<small>Markdown</small></div><div class="mini-row"><span>✦</span>Planting calendar.csv<small>CSV</small></div><div class="mini-row"><span>✧</span>Botany reading.pdf<small>PDF</small></div>' },
  { title: 'The reader', description: 'Select a celestial object to preview its file. Choose Expand, or press Enter, for the full reader. Use Open original to work in the file’s usual app, or Reveal in Finder to see its folder. Map, list, and grid views offer different ways to browse.', tip: 'Tip: scroll to zoom; drag the map to look around.', visual: '<span class="mini-label">FIELD NOTES / GARDEN</span><strong>A small garden.md</strong><p class="mini-text">Basil for the evenings,<br />mint for tea.</p><span class="mini-caption">Open original ↗ &nbsp; · &nbsp; Expand ↗</span>' },
  { title: 'Pins & saved places', description: 'Use Save place to remember the current view. Shift-drag a file to pin it somewhere meaningful, or add a tag in its file details. Save a set of search results as a collection. Choose Your atlas to return to the whole galaxy.', tip: 'Tip: ordinary indexing keeps existing file positions.', visual: '<strong>✧ &nbsp; Your places</strong><div class="mini-row"><span>✧</span>The whole galaxy</div><div class="mini-row"><span>⌖</span>The windowsill garden</div><span class="mini-button">Save place +</span>' },
]
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-step]')]
let step = 0
function setStep(next: number, focus = false): void {
  step = (next + tutorial.length) % tutorial.length
  const value = tutorial[step]
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === step)); tab.tabIndex = i === step ? 0 : -1 })
  element('tutorial-panel').setAttribute('aria-labelledby', 'step-' + step)
  element('tutorial-count').textContent = 'STEP 0' + (step + 1)
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
element<HTMLFormElement>('feedback-form').addEventListener('submit', event => {
  event.preventDefault()
  const form = event.currentTarget as HTMLFormElement
  if (!form.reportValidity()) return
  const data = new FormData(form)
  const url = feedbackUrl(String(data.get('kind')), String(data.get('summary')), String(data.get('message')))
  // Navigate in the same tab; the browser's Back button retains the draft.
  window.location.assign(url)
})
