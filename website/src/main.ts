import searchImage from '../../src/renderer/public/tutorials/search.png'
import readerImage from '../../src/renderer/public/tutorials/reader.png'
import placesImage from '../../src/renderer/public/tutorials/places.png'
import { drawStellarObject } from '../../src/renderer/src/atlas/celestialSprites'
import { stellarAppearance } from '../../src/renderer/src/atlas/stellarVisual'
import { seedFor } from '../../src/renderer/src/atlas/scene'
import { setupEmailFeedback } from './feedback'
import { exampleFiles, matchingFiles, feedbackUrl, type ExampleFile } from './demo'

const sourcesImage = '/tutorials/sources.png'

function element<T extends HTMLElement>(id: string): T { return document.getElementById(id) as T }
function object(canvas: HTMLCanvasElement, file: Pick<ExampleFile, 'bytes' | 'favorite'>, seed: number, close = false): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2)
  const appearance = stellarAppearance(seed, file.bytes, file.favorite)
  const size = close ? 1 : appearance.radiusScale / (canvas.closest('.file-star') ? 1.35 : 2.1)
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
  element('preview-text').textContent = file.text
  object(element<HTMLCanvasElement>('preview-object'), file, seedFor(file.name), true)
  drawGalaxy()
}
function filter(): void {
  const matches = matchingFiles(search.value)
  buttons.forEach((button, i) => button.classList.toggle('is-dim', !matches.includes(exampleFiles[i])))
  element('demo-status').textContent = search.value.trim()
    ? matches.length + (matches.length === 1 ? ' match' : ' matches') + '. Choose a star to preview it.'
    : 'Search “garden” or select a star.'
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
  for (let i = 0; i < 1500; i++) {
    const file = exampleFiles[i % exampleFiles.length]
    const angle = random() * Math.PI * 2, distance = random() ** 1.5
    const x = file.x / 100 * w + Math.cos(angle) * distance * w * .11
    const y = file.y / 100 * h + Math.sin(angle) * distance * h * .085
    ctx.globalAlpha = .07 + random() * .28
    ctx.fillStyle = ['#c4dcf1', '#ead2a0', '#f1f1e9'][i % 3]
    ctx.fillRect(x, y, .45 + random() * .5, .45 + random() * .5)
  }
  for (let i = 0; i < 1900; i++) {
    const t = random(), spread = (random() + random() + random() - 1.5)
    const x = (t * 1.02 + spread * .13) * w
    const y = (.53 - Math.sin(t * 7) * .15 + spread * .32) * h
    ctx.globalAlpha = .12 + random() * .6
    ctx.fillStyle = ['#f1f1e9', '#f1f1e9', '#eadfca', '#ead2a0', '#c4dcf1'][i % 5]
    ctx.beginPath(); ctx.arc(x, y, .22 + random() ** 6 * 1.3, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  const siblings = exampleFiles.filter(file => file.folder === selected.folder)
  ctx.strokeStyle = '#f1f1e947'; ctx.lineWidth = .7
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
  { title: 'Folders', description: '1. In Finder, select a folder. Press Option–Command–C to copy its path. 2. Open Library → Manage sources. 3. Paste the path and choose Index folder.', tip: 'Reindex: files added or changed since the last scan.', image: sourcesImage, alt: 'Folder path input and Index folder button in the app’s source manager.' },
  { title: 'Search', description: '1. Press ⌘ K. 2. Enter a filename, folder, or text. 3. Select a result to locate it on the atlas.', tip: 'Related meaning: requires Ollama and indexed embeddings.', image: searchImage, alt: 'Search results and highlighted stars in the fictional demo library.' },
  { title: 'Reader', description: '1. Select a star. 2. Press Enter to expand the reader. 3. Choose Open in app to edit the original. Markdown: Explore solar system opens section planets.', tip: 'Section planets: select a planet to read its heading.', image: readerImage, alt: 'Markdown document in the app’s reader, with a table of contents.' },
  { title: 'Places', description: '1. Navigate to a region. 2. Choose Save place. 3. Return through Saved places in Library. Shift-drag a file to pin its position.', tip: 'Favorites: pulsars or black holes. Pins: file positions.', image: placesImage, alt: 'Saved places in the Library panel beside the fictional atlas.' },
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
  const instructions = value.description.split(/(?:^| )\d\. /).filter(Boolean).map(text => {
    const item = document.createElement('li'); item.textContent = text; return item
  })
  element('tutorial-description').replaceChildren(...instructions)
  element('tutorial-tip').textContent = value.tip
  const screenshot = document.createElement('img')
  screenshot.src = value.image; screenshot.alt = value.alt; screenshot.loading = 'lazy'; screenshot.decoding = 'async'
  element('tutorial-visual').replaceChildren(screenshot)
  element<HTMLAnchorElement>('tutorial-image').href = value.image
  element('tutorial-image').setAttribute('aria-label', 'Screenshot: ' + value.title)
  element('next-step').innerHTML = step === 3 ? 'First step <span aria-hidden="true">↺</span>' : 'Next <span aria-hidden="true">→</span>'
  if (focus) tabs[step].focus()
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setStep(index))
  tab.addEventListener('keydown', event => {
    const next = ['ArrowDown', 'ArrowRight'].includes(event.key) ? step + 1 : ['ArrowUp', 'ArrowLeft'].includes(event.key) ? step - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? 3 : null
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
