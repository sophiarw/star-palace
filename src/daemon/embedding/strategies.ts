// Embedding-input strategy registry.
//
// Each strategy is a pure function that turns a (FileNode, content, tags)
// tuple into the prompt string handed to Ollama. Splitting this out from
// `EmbeddingEngine.embedFile` lets B2's experiment endpoints try different
// prompts on the same corpus without touching the embed/normalise plumbing.
//
// Critical formatting note: the metadata header lives at the TOP of every
// prompt. Ollama input is truncated tail-first by `truncateText` (drops
// trailing bytes once total UTF-8 size > 30 KB), so leading-position
// metadata survives even when the body is cut.
//
// v1 contains five strategies — see the `STRATEGIES` map at the bottom.
// `DEFAULT_STRATEGY` is `content-only` so legacy behaviour is preserved
// when nothing has flipped `app_settings.default_strategy`.

import type { FileNode } from '../../shared/types'

export type StrategyId =
  | 'content-only'
  | 'metadata-only'
  | 'metadata+content'
  | 'tags+metadata+content'
  | 'sampled-stats+metadata'
  | 'path-only'

export const STRATEGY_IDS: readonly StrategyId[] = [
  'content-only',
  'metadata-only',
  'metadata+content',
  'tags+metadata+content',
  'sampled-stats+metadata',
  'path-only',
] as const

export const DEFAULT_STRATEGY: StrategyId = 'content-only'

export interface StrategyContext {
  node: FileNode
  content: Buffer
  tags: string[] | null
}

export interface Strategy {
  id: StrategyId
  label: string
  description: string
  build(ctx: StrategyContext): string | null
}

export function isStrategyId(value: unknown): value is StrategyId {
  return typeof value === 'string' && (STRATEGY_IDS as readonly string[]).includes(value)
}

// --- helpers ---

// Last two ancestor directories joined by '/' — gives the model a slice of
// the file's neighbourhood without exploding context with the full path. The
// file's own basename is dropped (it's reported separately as `filename:`).
function shortParent(path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 1) return ''
  const ancestors = segments.slice(0, -1)
  return ancestors.slice(-2).join('/')
}

function fileExtension(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i + 1)
}

function isoDate(modifiedAt: number): string {
  // Always render as YYYY-MM-DD UTC so the prompt is reproducible across
  // timezones — embedding stability matters more than local-time accuracy.
  return new Date(modifiedAt).toISOString().slice(0, 10)
}

function buildMetadataBlock(node: FileNode): string {
  const parent = shortParent(node.path)
  const ext = fileExtension(node.name)
  const lines = [
    `filename: ${node.name}`,
    `parent: ${parent}`,
    `ext: ${ext}`,
    `mime: ${node.mimeType}`,
    `size: ${node.size} bytes`,
    `modified: ${isoDate(node.modifiedAt)}`,
  ]
  return lines.join('\n')
}

function rawContent(content: Buffer): string | null {
  const text = content.toString('utf8')
  return text.trim() ? text : null
}

// Numeric-token detector for `sampled-stats+metadata`. Tokens split on
// whitespace, commas, and semicolons; a "numeric file" is one where ≥3
// tokens parse as finite numbers AND total token count < 50. We deliberately
// keep this dumb in v1 — CSV/JSON/log heuristics (header rows, mixed string
// columns, structured values) are deferred until the experiment loop tells
// us we need them.
interface NumericSummary {
  count: number
  min: number
  max: number
  mean: number
  std: number
  values: number[]
}

function tryNumericSummary(content: Buffer): NumericSummary | null {
  const text = content.toString('utf8')
  if (!text.trim()) return null
  const tokens = text.split(/[\s,;]+/).filter(t => t.length > 0)
  if (tokens.length === 0 || tokens.length >= 50) return null
  const values: number[] = []
  for (const t of tokens) {
    const n = Number(t)
    if (Number.isFinite(n)) values.push(n)
  }
  if (values.length < 3) return null
  // Require the file to be primarily numeric — at least 60% of tokens parse
  // as numbers. Catches the "data_subjectX_DayY.txt" shape (5 numbers, no
  // labels) without sucking in prose that happens to mention three numbers.
  if (values.length / tokens.length < 0.6) return null

  const count = values.length
  let min = values[0]
  let max = values[0]
  let sum = 0
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  const mean = sum / count
  let varSum = 0
  for (const v of values) varSum += (v - mean) * (v - mean)
  const std = Math.sqrt(varSum / count)
  return { count, min, max, mean, std, values }
}

function formatNumber(n: number): string {
  // Trim trailing zeros to keep prompts compact while still distinguishing
  // 1.0 from 1.5 etc. Special-case integers to avoid "1" -> "1.0e+0" style.
  if (Number.isInteger(n)) return String(n)
  // 4 sig figs is plenty for an embedding-input summary.
  const fixed = n.toFixed(4)
  return fixed.replace(/0+$/, '').replace(/\.$/, '')
}

// --- strategies ---

const contentOnly: Strategy = {
  id: 'content-only',
  label: 'Content only',
  description: 'Raw file contents (current default). Returns null for media or empty/whitespace text.',
  build(ctx) {
    if (ctx.node.category === 'media') return null
    return rawContent(ctx.content)
  },
}

const metadataOnly: Strategy = {
  id: 'metadata-only',
  label: 'Metadata only',
  description: 'Filename, parent, ext, mime, size, modified date. Always non-null (works for media).',
  build(ctx) {
    return buildMetadataBlock(ctx.node)
  },
}

const metadataPlusContent: Strategy = {
  id: 'metadata+content',
  label: 'Metadata + content',
  description: 'Metadata block then raw contents. Skips the content section for media files but still emits metadata.',
  build(ctx) {
    const meta = buildMetadataBlock(ctx.node)
    if (ctx.node.category === 'media') return meta
    const body = rawContent(ctx.content)
    if (body === null) return meta
    return `${meta}\n---\ncontent:\n${body}`
  },
}

const tagsPlusMetadataPlusContent: Strategy = {
  id: 'tags+metadata+content',
  label: 'Tags + metadata + content',
  description: 'Prepends the file\'s manual tags (when any) before metadata + content. Falls through to metadata+content otherwise.',
  build(ctx) {
    const inner = metadataPlusContent.build(ctx)
    if (inner === null) return null
    if (!ctx.tags || ctx.tags.length === 0) return inner
    return `tags: ${ctx.tags.join(', ')}\n${inner}`
  },
}

// Strip the home-directory prefix from `node.path` so the embedding input
// isn't padded with bytes shared by every file in the corpus. Falls through
// to the original absolute path on non-Unixy layouts where the regex doesn't
// match.
function relativePath(node: FileNode): string {
  let p = node.path.replace(/^\/+/, '')
  p = p.replace(/^(?:Users|home)\/[^/]+\//, '')
  return p
}

const pathOnly: Strategy = {
  id: 'path-only',
  label: 'Path only (experimental)',
  description:
    'Embeds the file\'s relative path string, slashes preserved. Tests whether the PCA layout reproduces the directory tree.',
  build(ctx) {
    const p = relativePath(ctx.node)
    return p.length > 0 ? p : null
  },
}

const sampledStatsPlusMetadata: Strategy = {
  id: 'sampled-stats+metadata',
  label: 'Sampled stats + metadata',
  description: 'For tiny numeric files (data_subjectX_DayY.txt etc.): metadata + min/max/mean/std summary. Falls back to metadata+content for non-numeric.',
  build(ctx) {
    const summary = tryNumericSummary(ctx.content)
    if (!summary) return metadataPlusContent.build(ctx)
    const parent = shortParent(ctx.node.path)
    const stats = `n=${summary.count} min=${formatNumber(summary.min)} max=${formatNumber(summary.max)} mean=${formatNumber(summary.mean)} std=${formatNumber(summary.std)}`
    return [
      `filename: ${ctx.node.name}`,
      `parent: ${parent}`,
      `numeric_summary: ${stats}`,
      `raw: ${summary.values.map(formatNumber).join(', ')}`,
    ].join('\n')
  },
}

export const STRATEGIES: Record<StrategyId, Strategy> = {
  'content-only': contentOnly,
  'metadata-only': metadataOnly,
  'metadata+content': metadataPlusContent,
  'tags+metadata+content': tagsPlusMetadataPlusContent,
  'sampled-stats+metadata': sampledStatsPlusMetadata,
  'path-only': pathOnly,
}
