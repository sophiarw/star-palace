import { STAR_TYPES, type StarType } from '@shared/types'

// One fixed sheet for every file: 31 sprites, 2 MiB; no per-file image cache.
export const SPRITE_CELL = 128
export const SPRITE_COLUMNS = 8
export const SPRITE_ROWS = 4
const VARIANTS = 3
let sheet: HTMLCanvasElement | null = null
export const spriteIndex = (type?: StarType, seed = 0): number => type ? 1 + STAR_TYPES.indexOf(type) * VARIANTS + (seed >>> 0) % VARIANTS : 0

export function celestialSheet(): HTMLCanvasElement {
  if (sheet) return sheet
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_CELL * SPRITE_COLUMNS; canvas.height = SPRITE_CELL * SPRITE_ROWS
  const ctx = canvas.getContext('2d')!
  for (let i = 0; i <= STAR_TYPES.length * VARIANTS; i++) {
    ctx.save(); ctx.translate((i % SPRITE_COLUMNS) * SPRITE_CELL + 64, Math.floor(i / SPRITE_COLUMNS) * SPRITE_CELL + 64)
    ctx.beginPath(); ctx.rect(-63, -63, 126, 126); ctx.clip()
    drawObject(ctx, i === 0 ? undefined : STAR_TYPES[Math.floor((i - 1) / VARIANTS)], (i - 1) % VARIANTS)
    ctx.restore()
  }
  sheet = canvas
  return canvas
}

type Ctx = CanvasRenderingContext2D
function glow(ctx: Ctx, x: number, y: number, radius: number, color: string, opacity = 1): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
  gradient.addColorStop(0, color); gradient.addColorStop(.22, color + '99'); gradient.addColorStop(.65, color + '22'); gradient.addColorStop(1, color + '00')
  ctx.globalAlpha = opacity; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1
}
function ring(ctx: Ctx, rx: number, ry: number, color: string, width = 1, from = 0, to = Math.PI * 2): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, -.25, from, to); ctx.stroke()
}
function star(ctx: Ctx, x: number, y: number, radius: number, color: string): void {
  glow(ctx, x, y, Math.min(58, radius * 3.2), color, .65)
  const gradient = ctx.createRadialGradient(x - radius * .28, y - radius * .25, 0, x, y, radius)
  gradient.addColorStop(0, '#fff9e9'); gradient.addColorStop(.25, '#fff0ca'); gradient.addColorStop(.6, color); gradient.addColorStop(1, color + '40')
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
}
function beam(ctx: Ctx, length: number, width: number, color: string, angle = 0): void {
  ctx.save(); ctx.rotate(angle)
  const gradient = ctx.createLinearGradient(0, -length, 0, length)
  gradient.addColorStop(0, color + '00'); gradient.addColorStop(.38, color + '77'); gradient.addColorStop(.5, '#effbffff'); gradient.addColorStop(.62, color + '77'); gradient.addColorStop(1, color + '00')
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, -length); ctx.quadraticCurveTo(width, -8, width * .35, 0); ctx.quadraticCurveTo(width, 8, 0, length); ctx.quadraticCurveTo(-width, 8, -width * .35, 0); ctx.quadraticCurveTo(-width, -8, 0, -length); ctx.fill(); ctx.restore()
}
export function drawObject(ctx: Ctx, type: StarType | undefined, seed: number, detailed = false): void {
  let state = seed >>> 0
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296 }
  if (detailed) { ctx.rotate((random() - .5) * .24); ctx.scale(.94 + random() * .12, .94 + random() * .12) }
  if (!type) { glow(ctx, 0, 0, 56, '#ffffff', .4); glow(ctx, 0, 0, 23, '#ffffff'); return }
  if (type === 'main-sequence') {
    star(ctx, 0, 0, 12 + random() * 3, '#e5b36f');
    if (detailed) for (let i = 0; i < 90; i++) { const a = random() * Math.PI * 2, r = Math.sqrt(random()) * 11; glow(ctx, Math.cos(a) * r, Math.sin(a) * r, .6 + random(), '#af703c', .25) }
    ring(ctx, 18, 18, '#eeca8528', .7)
  } else if (type === 'red-giant') {
    glow(ctx, 0, 0, 56, '#dc623e', .5); star(ctx, 0, 0, 25, '#ed9564')
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.clip()
    for (let i = 0; i < (detailed ? 180 : 32); i++) { const a = random() * Math.PI * 2, r = Math.sqrt(random()) * 24; glow(ctx, Math.cos(a) * r, Math.sin(a) * r, (detailed ? 1.2 : 3.5) + random() * 3, i % 3 ? '#9e3c31' : '#ffe3ac', .23) }
    ctx.restore(); ring(ctx, 26.5, 26.5, '#efaf6944', .8)
  } else if (type === 'blue-supergiant') {
    glow(ctx, 0, 0, 57, '#6eaeed', .6); beam(ctx, 58, 2.5, '#82c9ff'); beam(ctx, 48, 1.8, '#a0d2ff', Math.PI / 2)
    star(ctx, 0, 0, 17 + random() * 4, '#a4d9f2')
  } else if (type === 'white-dwarf') {
    glow(ctx, 0, 0, 25, '#d3eafa', .55); ring(ctx, 18, 18, '#b7d6e355', .8); star(ctx, 0, 0, 7, '#e1edf0')
    beam(ctx, 30, .85, '#e6f6ff', .65)
  } else if (type === 'neutron-star') {
    glow(ctx, 0, 0, 30, '#70d3d8', .6); ring(ctx, 17, 17, '#9be6e5aa', 1.3); ring(ctx, 22, 22, '#6baab24a', .8)
    star(ctx, 0, 0, 7, '#cef3eb')
  } else if (type === 'pulsar') {
    ctx.rotate(-.5 + random() * .6); ring(ctx, 28, 14, '#80bcde55', 1); ring(ctx, 18, 30, '#6aa3ce2a', .7)
    beam(ctx, 59, 6, '#78bded'); beam(ctx, 55, 1.4, '#d3eeff'); star(ctx, 0, 0, 8, '#c6eafb')
  } else if (type === 'binary') {
    ring(ctx, 35, 19, '#aabccb44', .8); star(ctx, -15, 8, 12, '#e8bd80'); star(ctx, 16, -8, 9, '#a1cfe6')
  } else if (type === 'quasar') {
    ctx.rotate(.2 + random() * .5); glow(ctx, 0, 0, 39, '#ada2e1', .4)
    ring(ctx, 28, 9, '#baacd37a', 2); ring(ctx, 21, 6, '#edcaa6bb', 2)
    beam(ctx, 57, 3, '#99aee7', -.2); star(ctx, 0, 0, 9, '#f2d4af')
  } else if (type === 'black-hole') {
    glow(ctx, 0, 0, 43, '#c99965', .22); ring(ctx, 34, 12, '#e7b97975', 4); ring(ctx, 32, 10, '#f2cf96b0', 1)
    ctx.fillStyle = '#090f18'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill()
    ring(ctx, 18, 18, '#e5bb83bb', 1.4, Math.PI, Math.PI * 2)
    ring(ctx, 34, 11, '#ffdda4cc', 1.8, 0, Math.PI); ring(ctx, 29, 8, '#e3a96b88', 1, 0, Math.PI)
  } else if (type === 'nebula') {
    for (let i = 0; i < (detailed ? 55 : 19); i++) {
      const angle = random() * Math.PI * 2, r = Math.sqrt(random()) * 29
      glow(ctx, Math.cos(angle) * r, Math.sin(angle) * r * .65, (detailed ? 8 : 15) + random() * 9, i % 3 ? '#9d83bb' : '#68b2bd', detailed ? .16 : .22)
    }
    for (let i = 0; i < 4; i++) { ctx.strokeStyle = i % 2 ? '#9bd0d047' : '#c6b0db3a'; ctx.lineWidth = .7; ctx.beginPath(); ctx.moveTo(-34, 16 - i * 9); ctx.bezierCurveTo(-17, 34 - i * 14, 5, -35 + i * 9, 34, -18 + i * 7); ctx.stroke() }
    star(ctx, -13, 4, 2.4, '#e4d5f0'); star(ctx, 15, -6, 1.8, '#bfebec'); star(ctx, 4, 12, 1.4, '#f3dfc7')
  }
}
