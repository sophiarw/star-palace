import { useEffect, useRef } from 'react'
import type { StarType } from '@shared/types'
import { celestialSheet, spriteIndex, SPRITE_CELL, SPRITE_COLUMNS } from './celestialSprites'

export function CelestialIcon({ type, size = 72 }: { type: StarType; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const index = spriteIndex(type)
    ctx.clearRect(0, 0, 128, 128)
    ctx.drawImage(celestialSheet(), index % SPRITE_COLUMNS * SPRITE_CELL, Math.floor(index / SPRITE_COLUMNS) * SPRITE_CELL, SPRITE_CELL, SPRITE_CELL, 0, 0, 128, 128)
  }, [type])
  return <canvas ref={canvas} width={128} height={128} style={{ width: size, height: size }} aria-hidden="true" />
}
