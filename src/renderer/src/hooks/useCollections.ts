import { useCallback, useEffect, useRef, useState } from 'react'
import type { CollectionSummary } from '@shared/types'
import { COLLECTION_ACTIVE_LS_KEY } from '@shared/types'
import {
  listCollections,
  createCollection as apiCreateCollection,
  addCollectionMembers as apiAddMembers,
  removeCollectionMember as apiRemoveMember,
  refreshCollection as apiRefreshCollection,
  deleteCollection as apiDeleteCollection,
  type CreateCollectionInput,
  type RefreshResult,
} from '../api'

// F5 — useCollections owns the renderer-side cache of collections + the
// "active collection" UI state. activeCollectionId is persisted to
// localStorage so reopening the app restores the highlight set, mirroring
// how usePcDial persists axis selection.

interface UseCollectionsResult {
  collections: CollectionSummary[]
  activeCollectionId: number | null
  setActiveCollectionId: (id: number | null) => void
  refresh: () => Promise<void>
  create: (input: CreateCollectionInput) => Promise<CollectionSummary>
  addMembers: (id: number, fileIds: string[]) => Promise<void>
  removeMember: (id: number, fileId: string) => Promise<void>
  refreshDynamic: (id: number) => Promise<RefreshResult>
  delete: (id: number) => Promise<void>
}

function readPersistedActiveId(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(COLLECTION_ACTIVE_LS_KEY)
    if (raw === null) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function writePersistedActiveId(id: number | null): void {
  if (typeof window === 'undefined') return
  try {
    if (id === null) {
      window.localStorage.removeItem(COLLECTION_ACTIVE_LS_KEY)
    } else {
      window.localStorage.setItem(COLLECTION_ACTIVE_LS_KEY, String(id))
    }
  } catch {
    // best-effort; quota errors etc. shouldn't break the app
  }
}

export function useCollections(): UseCollectionsResult {
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [activeCollectionId, setActiveCollectionIdState] = useState<number | null>(readPersistedActiveId())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const list = await listCollections()
      if (!mountedRef.current) return
      setCollections(list)
      // If the persisted active id now points at nothing (collection deleted
      // outside this session, e.g. via direct DB edit), clear it.
      setActiveCollectionIdState(prev => {
        if (prev === null) return prev
        return list.some(c => c.id === prev) ? prev : null
      })
    } catch {
      // daemon may be down; leave existing state untouched
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const setActiveCollectionId = useCallback((id: number | null) => {
    setActiveCollectionIdState(id)
    writePersistedActiveId(id)
  }, [])

  const create = useCallback(async (input: CreateCollectionInput) => {
    const created = await apiCreateCollection(input)
    await refresh()
    return created
  }, [refresh])

  const addMembers = useCallback(async (id: number, fileIds: string[]) => {
    await apiAddMembers(id, fileIds)
    await refresh()
  }, [refresh])

  const removeMember = useCallback(async (id: number, fileId: string) => {
    await apiRemoveMember(id, fileId)
    await refresh()
  }, [refresh])

  const refreshDynamic = useCallback(async (id: number): Promise<RefreshResult> => {
    const diff = await apiRefreshCollection(id)
    await refresh()
    return diff
  }, [refresh])

  const deleteCol = useCallback(async (id: number) => {
    await apiDeleteCollection(id)
    if (activeCollectionId === id) {
      setActiveCollectionId(null)
    }
    await refresh()
  }, [activeCollectionId, refresh, setActiveCollectionId])

  return {
    collections,
    activeCollectionId,
    setActiveCollectionId,
    refresh,
    create,
    addMembers,
    removeMember,
    refreshDynamic,
    delete: deleteCol,
  }
}
