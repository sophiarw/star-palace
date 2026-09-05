// Live-mix lab — pre-compute multiple "channel" embeddings per file once,
// then on each slider drag combine them as a weighted sum, L2-normalise, and
// re-fit a one-shot PCA so the user sees the layout reshape in real time.
//
// State is in-memory only. A prep-id keys a workbench:
//   { fileIds, channels, vectors: Map<fileId, Map<channel, Float32Array>> }
// Mixing is pure arithmetic over those cached vectors (no Ollama calls), so
// dragging a slider is sub-50 ms even for ~hundreds of files.
//
// Channels are the existing strategy ids — strategies that decline a given
// file (e.g. content-only on a media file) just contribute no vector for that
// file and the mix is dominated by the other channels.

import { extractContent } from '../index/extractors/text'
import { randomUUID } from 'crypto'
import type { FileIndex } from '../db/FileIndex'
import type { EmbeddingEngine } from './EmbeddingEngine'
import { STRATEGIES, isStrategyId } from './strategies'
import type { StrategyId } from './strategies'
import { projectVectors } from '../layout/Relayouter'
import { SUBSET_PCA_MIN } from '../layout/Relayouter'
import type { FileNode } from '../../shared/types'

// Per-file vectors keyed by channel. Missing entries mean the strategy
// declined that file — the mix step treats absent channels as zero.
type ChannelVectors = Map<StrategyId, Float32Array>

interface LabMixWorkbench {
  fileIds: string[]
  channels: StrategyId[]
  vectors: Map<string, ChannelVectors>
  createdAt: number
}

const workbenches = new Map<string, LabMixWorkbench>()

// Cap at 4 concurrent workbenches to bound memory. Oldest evicted on overflow.
const MAX_WORKBENCHES = 4

export interface PrepareDeps {
  db: FileIndex
  embedEngine: EmbeddingEngine
}

export interface PrepareOpts {
  scopePath: string
  channels: StrategyId[]
}

export type PrepareError =
  | { code: 'invalid-channel'; message: string }
  | { code: 'too-few-files'; message: string; count: number }
  | { code: 'no-vectors'; message: string }

export interface PrepareResult {
  ok: true
  prepId: string
  fileIds: string[]
  channels: StrategyId[]
  count: number
}

export async function prepareLabMix(
  deps: PrepareDeps,
  opts: PrepareOpts
): Promise<PrepareResult | PrepareError> {
  for (const ch of opts.channels) {
    if (!isStrategyId(ch)) {
      return { code: 'invalid-channel', message: `unknown channel '${ch}'` }
    }
  }
  if (opts.channels.length === 0) {
    return { code: 'invalid-channel', message: 'channels list is empty' }
  }

  const files = deps.db.listFilesUnderPath(opts.scopePath, { embeddedOnly: false })
  if (files.length < SUBSET_PCA_MIN) {
    return {
      code: 'too-few-files',
      message: `scope contains ${files.length} files; need at least ${SUBSET_PCA_MIN}`,
      count: files.length,
    }
  }

  const vectors = new Map<string, ChannelVectors>()
  const fileIds: string[] = []

  for (const file of files) {
    let content: Buffer
    if (file.category === 'media') {
      content = Buffer.alloc(0)
    } else {
      try {
        content = await extractContent(file.path, file.category)
      } catch {
        // File deleted out from under us; skip it for this workbench.
        continue
      }
    }

    const node: FileNode = {
      id: file.id,
      name: file.name,
      path: file.path,
      platform: file.platform,
      mimeType: file.mimeType,
      category: file.category,
      size: file.size,
      createdAt: file.createdAt,
      modifiedAt: file.modifiedAt,
    }

    const perChannel: ChannelVectors = new Map()
    for (const ch of opts.channels) {
      const prompt = STRATEGIES[ch].build({ node, content, tags: file.tags })
      if (!prompt || !prompt.trim()) continue
      try {
        const { embedding } = await deps.embedEngine.embed(prompt)
        perChannel.set(ch, embedding)
      } catch (err) {
        console.warn(`[labMix] embed failed for ${file.id}/${ch}: ${String(err)}`)
      }
    }
    if (perChannel.size === 0) continue
    vectors.set(file.id, perChannel)
    fileIds.push(file.id)
  }

  if (fileIds.length < SUBSET_PCA_MIN) {
    return {
      code: 'no-vectors',
      message: `only ${fileIds.length} files yielded any vectors; need ≥ ${SUBSET_PCA_MIN}`,
    }
  }

  const prepId = randomUUID()
  workbenches.set(prepId, {
    fileIds,
    channels: opts.channels,
    vectors,
    createdAt: Date.now(),
  })
  evictOldWorkbenches()

  return { ok: true, prepId, fileIds, channels: opts.channels, count: fileIds.length }
}

export interface MixOpts {
  prepId: string
  // Caller can omit channels here; weights default to 0 for any channel not
  // listed. Absent channels behave like weight=0.
  weights: Record<string, number>
}

export type MixError =
  | { code: 'not-found' }
  | { code: 'no-active-channels'; message: string }
  | { code: 'subset-pca-failed'; message: string }

export interface MixPosition {
  id: string
  x: number
  y: number
}

export interface MixResult {
  ok: true
  positions: MixPosition[]
}

export function mixLab(opts: MixOpts): MixResult | MixError {
  const wb = workbenches.get(opts.prepId)
  if (!wb) return { code: 'not-found' }

  const activeChannels = wb.channels.filter(ch => {
    const w = opts.weights[ch]
    return typeof w === 'number' && w !== 0
  })
  if (activeChannels.length === 0) {
    return { code: 'no-active-channels', message: 'all weights are zero' }
  }

  const dim = firstVectorDim(wb)
  if (dim === 0) return { code: 'subset-pca-failed', message: 'workbench has no vectors' }

  const ids: string[] = []
  const combined: Float32Array[] = []
  for (const id of wb.fileIds) {
    const perChannel = wb.vectors.get(id)
    if (!perChannel) continue
    const acc = new Float32Array(dim)
    let touched = false
    for (const ch of activeChannels) {
      const vec = perChannel.get(ch)
      if (!vec) continue
      const w = opts.weights[ch]
      for (let i = 0; i < dim; i++) acc[i] += w * vec[i]
      touched = true
    }
    if (!touched) continue
    l2NormaliseInPlace(acc)
    ids.push(id)
    combined.push(acc)
  }

  const positions = projectVectors(ids, combined)
  if (!positions) {
    return {
      code: 'subset-pca-failed',
      message: `subset PCA returned null for ${ids.length} vectors`,
    }
  }
  const out: MixPosition[] = []
  for (const [id, [x, y]] of positions) {
    out.push({ id, x, y })
  }
  return { ok: true, positions: out }
}

export function releaseLabMix(prepId: string): boolean {
  return workbenches.delete(prepId)
}

// Test-only escape hatch — reset module state between vitest runs.
export function _resetLabMixForTests(): void {
  workbenches.clear()
}

function firstVectorDim(wb: LabMixWorkbench): number {
  for (const perChannel of wb.vectors.values()) {
    for (const vec of perChannel.values()) {
      return vec.length
    }
  }
  return 0
}

function l2NormaliseInPlace(v: Float32Array): void {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  if (sum === 0) return
  const inv = 1 / Math.sqrt(sum)
  for (let i = 0; i < v.length; i++) v[i] *= inv
}

function evictOldWorkbenches(): void {
  if (workbenches.size <= MAX_WORKBENCHES) return
  const sorted = [...workbenches.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)
  while (workbenches.size > MAX_WORKBENCHES) {
    const oldest = sorted.shift()
    if (!oldest) break
    workbenches.delete(oldest[0])
  }
}
