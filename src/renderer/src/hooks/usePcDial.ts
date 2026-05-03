import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchProjection, pinStar, unpinStar, type ProjectionPayload } from '../api'
import { applyPinOffset, worldToPc as worldToPcInverse } from '../components/StarMap/pinMath'

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

// Per-axis scaling state cached on a ref so worldToPc / pinFile can read it
// without re-deriving it from `projection`.
interface ScaleState {
  minX: number
  minY: number
  scale: number  // single scalar — both axes share Math.max(rangeX, rangeY)
}

export interface PcDialState {
  axisX: number
  axisY: number
  componentCount: number
  scaledById: Map<string, [number, number]>
  ready: boolean
  setAxes: (axisX: number, axisY: number) => void
  // F4 — convert a world-space coord on the active axis to the raw PC coord
  // the daemon expects.
  worldToPc: (world: number, axis: 'x' | 'y') => number
  // F4 — drag-to-pin happy path: posts to /api/file/:id/pin then refetches
  // the projection so the new offset enters the renderer pipeline.
  pinFile: (id: string, worldX: number, worldY: number) => Promise<void>
  // F4 — clear a pin and refresh.
  unpinFile: (id: string) => Promise<void>
}

export function usePcDial(): PcDialState {
  const [projection, setProjection] = useState<ProjectionPayload | null>(null)
  const [{ axisX, axisY }, setAxesState] = useState<PersistedAxes>(loadAxes)
  const scaleRef = useRef<ScaleState>({ minX: 0, minY: 0, scale: 1 })

  const refetchProjection = useCallback(() => {
    fetchProjection()
      .then(p => setProjection(p))
      .catch(() => { /* daemon unavailable */ })
  }, [])

  useEffect(() => {
    refetchProjection()
  }, [refetchProjection])

  const componentCount = projection?.componentCount ?? 0

  // Clamp persisted axes if PCA model has fewer than expected components
  const safeAxisX = componentCount > 0 ? Math.min(axisX, componentCount - 1) : axisX
  const safeAxisY = componentCount > 0 ? Math.min(axisY, componentCount - 1) : axisY

  const scaledById = useMemo(() => {
    const out = new Map<string, [number, number]>()
    if (!projection || projection.files.length === 0) return out
    if (componentCount === 0) return out

    // F4 — first pass: compute per-axis effective PC values (natural + pin
    // offset on matching axes). Pinned files are included in min/max so
    // dragging a star far from the natural cluster compresses the rest of
    // the sky toward it. Spec-faithful per REQUIREMENTS.md F4 limitations.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const f of projection.files) {
      const px = f.pcs[safeAxisX]
      const py = f.pcs[safeAxisY]
      if (px === undefined || py === undefined) continue
      let ex = px, ey = py
      if (
        f.isPinned &&
        f.pinAlpha !== null && f.pinBeta !== null &&
        f.pinAxisA !== null && f.pinAxisB !== null
      ) {
        const off = applyPinOffset(f.pinAlpha, f.pinBeta, f.pinAxisA, f.pinAxisB, safeAxisX, safeAxisY)
        ex = px + off.dx
        ey = py + off.dy
      }
      if (ex < minX) minX = ex
      if (ex > maxX) maxX = ex
      if (ey < minY) minY = ey
      if (ey > maxY) maxY = ey
    }
    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1
    const scale = SCALE_RANGE / Math.max(rangeX, rangeY)
    scaleRef.current = { minX, minY, scale }

    for (const f of projection.files) {
      const px = f.pcs[safeAxisX]
      const py = f.pcs[safeAxisY]
      if (px === undefined || py === undefined) continue
      let ex = px, ey = py
      if (
        f.isPinned &&
        f.pinAlpha !== null && f.pinBeta !== null &&
        f.pinAxisA !== null && f.pinAxisB !== null
      ) {
        const off = applyPinOffset(f.pinAlpha, f.pinBeta, f.pinAxisA, f.pinAxisB, safeAxisX, safeAxisY)
        ex = px + off.dx
        ey = py + off.dy
      }
      const x = (ex - minX) * scale - SCALE_RANGE / 2
      const y = (ey - minY) * scale - SCALE_RANGE / 2
      out.set(f.id, [x, y])
    }
    return out
  }, [projection, safeAxisX, safeAxisY, componentCount])

  const setAxes = useCallback((nx: number, ny: number) => {
    const next = { axisX: nx, axisY: ny }
    setAxesState(next)
    saveAxes(next)
  }, [])

  // F4 — invert (raw - min) * scale - SCALE_RANGE/2 on the relevant axis.
  const worldToPc = useCallback((world: number, axis: 'x' | 'y'): number => {
    const s = scaleRef.current
    const min = axis === 'x' ? s.minX : s.minY
    return worldToPcInverse(world, min, s.scale, SCALE_RANGE)
  }, [])

  const pinFile = useCallback(async (id: string, worldX: number, worldY: number): Promise<void> => {
    const targetPcX = worldToPc(worldX, 'x')
    const targetPcY = worldToPc(worldY, 'y')
    await pinStar(id, targetPcX, targetPcY, safeAxisX, safeAxisY)
    refetchProjection()
  }, [worldToPc, safeAxisX, safeAxisY, refetchProjection])

  const unpinFile = useCallback(async (id: string): Promise<void> => {
    await unpinStar(id)
    refetchProjection()
  }, [refetchProjection])

  return {
    axisX: safeAxisX,
    axisY: safeAxisY,
    componentCount,
    scaledById,
    ready: componentCount > 0 && scaledById.size > 0,
    setAxes,
    worldToPc,
    pinFile,
    unpinFile,
  }
}
