import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchProjection, type ProjectionPayload } from '../api'

const STORAGE_KEY = 'starpalace.pcDial.v1'
const SCALE_RANGE = 1000  // matches scalePositions outputRange in daemon

interface PersistedAxes {
  axisX: number
  axisY: number
}

function loadAxes(): PersistedAxes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { axisX: 0, axisY: 1 }
    const parsed = JSON.parse(raw) as Partial<PersistedAxes>
    const ax = Number.isInteger(parsed.axisX) ? parsed.axisX! : 0
    const ay = Number.isInteger(parsed.axisY) ? parsed.axisY! : 1
    return { axisX: ax, axisY: ay }
  } catch {
    return { axisX: 0, axisY: 1 }
  }
}

function saveAxes(a: PersistedAxes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a))
  } catch { /* quota / private mode */ }
}

export interface PcDialState {
  axisX: number
  axisY: number
  componentCount: number
  scaledById: Map<string, [number, number]>
  ready: boolean
  setAxes: (axisX: number, axisY: number) => void
}

export function usePcDial(): PcDialState {
  const [projection, setProjection] = useState<ProjectionPayload | null>(null)
  const [{ axisX, axisY }, setAxesState] = useState<PersistedAxes>(loadAxes)

  useEffect(() => {
    let cancelled = false
    fetchProjection()
      .then(p => { if (!cancelled) setProjection(p) })
      .catch(() => { /* daemon unavailable */ })
    return () => { cancelled = true }
  }, [])

  const componentCount = projection?.componentCount ?? 0

  // Clamp persisted axes if PCA model has fewer than expected components
  const safeAxisX = componentCount > 0 ? Math.min(axisX, componentCount - 1) : axisX
  const safeAxisY = componentCount > 0 ? Math.min(axisY, componentCount - 1) : axisY

  const scaledById = useMemo(() => {
    const out = new Map<string, [number, number]>()
    if (!projection || projection.files.length === 0) return out
    if (componentCount === 0) return out

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const f of projection.files) {
      const x = f.pcs[safeAxisX]
      const y = f.pcs[safeAxisY]
      if (x === undefined || y === undefined) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const scale = SCALE_RANGE / Math.max(rangeX, rangeY)

    for (const f of projection.files) {
      const px = f.pcs[safeAxisX]
      const py = f.pcs[safeAxisY]
      if (px === undefined || py === undefined) continue
      const x = (px - minX) * scale - SCALE_RANGE / 2
      const y = (py - minY) * scale - SCALE_RANGE / 2
      out.set(f.id, [x, y])
    }
    return out
  }, [projection, safeAxisX, safeAxisY, componentCount])

  const setAxes = useCallback((nx: number, ny: number) => {
    const next = { axisX: nx, axisY: ny }
    setAxesState(next)
    saveAxes(next)
  }, [])

  return {
    axisX: safeAxisX,
    axisY: safeAxisY,
    componentCount,
    scaledById,
    ready: componentCount > 0 && scaledById.size > 0,
    setAxes,
  }
}
