// Prerendered deep-field backdrop. Generated once per viewport size.
// Encodes: base color, distant nebula clouds, faint background stars, far galaxies.
// All deterministic per size so the same window dimensions yield the same backdrop.

const BASE = '#020611'

interface Backdrop {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

let cached: Backdrop | null = null

export function getBackdrop(width: number, height: number): HTMLCanvasElement {
  if (cached && cached.width === width && cached.height === height) return cached.canvas
  const canvas = renderBackdrop(width, height)
  cached = { canvas, width, height }
  return canvas
}

export function clearBackdropCache(): void {
  cached = null
}

// Tiny deterministic RNG — same dims → same backdrop
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function renderBackdrop(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const rng = makeRng(width * 7919 + height)

  // Base
  ctx.fillStyle = BASE
  ctx.fillRect(0, 0, width, height)

  // Distant nebula clouds — large soft radial gradients in muted tones
  const NEBULA_COLORS = [
    [80, 30, 90],     // dim purple
    [25, 50, 110],    // deep blue
    [110, 50, 30],    // rust
    [50, 90, 100],    // dim teal
    [90, 60, 30],     // deep amber
  ]
  const nebulaCount = 4 + Math.floor(rng() * 3)
  for (let i = 0; i < nebulaCount; i++) {
    const cx = rng() * width
    const cy = rng() * height
    const radius = (0.18 + rng() * 0.22) * Math.max(width, height)
    const [r, g, b] = NEBULA_COLORS[Math.floor(rng() * NEBULA_COLORS.length)]
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, `rgba(${r},${g},${b},0.18)`)
    grad.addColorStop(0.4, `rgba(${r},${g},${b},0.07)`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)
  }

  // Faint background stars — tiny hued points
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const starCount = Math.min(900, Math.floor((width * height) / 2400))
  for (let i = 0; i < starCount; i++) {
    const x = rng() * width
    const y = rng() * height
    const r = 0.4 + rng() * 1.2
    const alpha = 0.18 + rng() * 0.5
    // Slight hue jitter — mostly white with bluish/yellowish tints
    const tint = rng()
    const rChan = tint < 0.4 ? 220 + Math.floor(rng() * 35) : 200 + Math.floor(rng() * 55)
    const gChan = 220 + Math.floor(rng() * 35)
    const bChan = tint > 0.6 ? 240 + Math.floor(rng() * 15) : 220 + Math.floor(rng() * 35)
    ctx.fillStyle = `rgba(${rChan},${gChan},${bChan},${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // Faraway galaxies — fuzzy ellipses with elongated radial gradients
  const galaxyCount = 30 + Math.floor(rng() * 20)
  for (let i = 0; i < galaxyCount; i++) {
    const cx = rng() * width
    const cy = rng() * height
    const rx = 1.5 + rng() * 4
    const ry = rx * (0.3 + rng() * 0.6)
    const angle = rng() * Math.PI
    // Galaxy color: warm core (white-yellow) → cool dim outskirts
    const coreAlpha = 0.35 + rng() * 0.35
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 2.2)
    grad.addColorStop(0, `rgba(255,235,200,${coreAlpha})`)
    grad.addColorStop(0.4, `rgba(220,200,200,${coreAlpha * 0.4})`)
    grad.addColorStop(1, 'rgba(150,160,200,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.scale(1, ry / rx)
    ctx.arc(0, 0, rx * 2.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  return canvas
}
