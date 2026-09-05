import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtlasFile, AtlasScope } from '@shared/atlas'
import type { Camera } from './scene'
import { atlasApi } from './api'

/** Bounded metadata hydration; a tile response must never move the camera. */
export function useAtlasTiles(filter: AtlasScope, revision: number) {
  const [wanted, setWanted] = useState<string[]>([]), [files, setFiles] = useState<AtlasFile[]>([])
  const wantedKey = wanted.join(','), filterKey = JSON.stringify(filter)
  const cache = useRef(new Map<string, AtlasFile[]>())
  const requestVisible = useCallback((camera: Camera, width: number, height: number) => {
    const level = Math.ceil(Math.log2(384 / camera.zoom)), step = 2 ** level
    const candidates: { id: string; distance: number }[] = []
    if (camera.zoom >= .13) {
      const minX = Math.floor((camera.x - width / camera.zoom * .5) / step), maxX = Math.floor((camera.x + width / camera.zoom * .5) / step)
      const minY = Math.floor((camera.y - height / camera.zoom * .5) / step), maxY = Math.floor((camera.y + height / camera.zoom * .5) / step)
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
        candidates.push({ id: `${level}:${x}:${y}`, distance: Math.hypot((x + .5) * step - camera.x, (y + .5) * step - camera.y) })
      }
    }
    const next = candidates.sort((a, b) => a.distance - b.distance).slice(0, 12).map(tile => tile.id).sort()
    const key = next.join(',')
    setWanted(previous => previous.join(',') === key ? previous : next)
  }, [])
  useEffect(() => { cache.current.clear(); setFiles([]) }, [filterKey])
  useEffect(() => { cache.current.clear() }, [revision])
  useEffect(() => {
    const abort = new AbortController(), ids = wantedKey ? wantedKey.split(',') : []
    const currentCache = cache.current
    const publish = () => { if (!abort.signal.aborted) setFiles(ids.flatMap(id => currentCache.get(id) ?? [])) }
    if (!ids.length || ids.every(id => currentCache.has(id))) publish()
    void Promise.all(ids.map(async id => {
      if (currentCache.has(id)) return
      try {
        const [level, x, y] = id.split(':').map(Number), step = 2 ** level
        const result = await atlasApi.viewport(JSON.parse(filterKey) as AtlasScope,
          { minX: x * step, minY: y * step, maxX: (x + 1) * step, maxY: (y + 1) * step }, abort.signal)
        if (abort.signal.aborted) return
        currentCache.set(id, result.files)
        while (currentCache.size > 24) {
          const oldest = [...currentCache.keys()].find(key => !ids.includes(key))
          if (!oldest) break
          currentCache.delete(oldest)
        }
        publish()
      } catch { /* Real overview markers remain available; retry on the next revision/view. */ }
    }))
    return () => abort.abort()
  }, [wantedKey, filterKey, revision])
  return { files, requestVisible }
}
