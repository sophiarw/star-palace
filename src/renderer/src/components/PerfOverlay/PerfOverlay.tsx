import { useEffect, useState, useCallback } from 'react'
import { frameMetrics, type FrameSnapshot } from '../../lib/frameMetrics'

interface Props {
  visible: boolean
  onClose: () => void
}

const POLL_MS = 250

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 12,
  left: 12,
  zIndex: 1000,
  background: 'rgba(8, 14, 28, 0.92)',
  border: '1px solid rgba(140, 200, 255, 0.45)',
  borderRadius: 6,
  color: '#dbe8ff',
  font: '11px ui-monospace, SFMono-Regular, Menlo, monospace',
  padding: '8px 12px',
  minWidth: 220,
  pointerEvents: 'auto',
  userSelect: 'text',
}

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 16 }
const labelStyle: React.CSSProperties = { color: '#8aa1c8' }

function fmt(ms: number): string {
  return ms.toFixed(1)
}

function colorFor(ms: number): string {
  if (ms < 18) return '#74e07a'   // 60+ fps
  if (ms < 33) return '#ddc847'   // 30+ fps
  return '#e07a7a'                // sub-30 fps
}

function copyToClipboard(snap: FrameSnapshot): void {
  const lines = [
    `FPS: ${snap.fps.toFixed(1)}`,
    `avg: ${fmt(snap.avgMs)} ms`,
    `p50: ${fmt(snap.p50Ms)} ms`,
    `p99: ${fmt(snap.p99Ms)} ms`,
    `worst: ${fmt(snap.worstMs)} ms`,
    `dropped (>33ms): ${snap.droppedCount} / ${snap.frameCount}`,
    `skipped (rAF gate): ${snap.skippedCount}`,
    `interacting frames: ${snap.interactingFrameCount}`,
    `interacting avg: ${fmt(snap.interactingAvgMs)} ms`,
    `interacting p99: ${fmt(snap.interactingP99Ms)} ms`,
    `visible stars: ${snap.visibleStars}`,
  ].join('\n')
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard.writeText(lines).catch(() => { /* ignore */ })
  }
  console.log('[perf]\n' + lines)
}

export default function PerfOverlay({ visible, onClose }: Props) {
  const [snap, setSnap] = useState<FrameSnapshot>(() => frameMetrics.snapshot())

  useEffect(() => {
    if (!visible) return
    const id = window.setInterval(() => setSnap(frameMetrics.snapshot()), POLL_MS)
    return () => window.clearInterval(id)
  }, [visible])

  const handleReset = useCallback(() => {
    frameMetrics.reset()
    setSnap(frameMetrics.snapshot())
  }, [])

  const handleCopy = useCallback(() => {
    copyToClipboard(frameMetrics.snapshot())
  }, [])

  if (!visible) return null

  const fpsColor = colorFor(snap.avgMs || 1000)
  const interactColor = colorFor(snap.interactingAvgMs || 0.0001)

  return (
    <div style={containerStyle} role="dialog" aria-label="Performance overlay">
      <div style={{ ...rowStyle, marginBottom: 6, alignItems: 'baseline' }}>
        <strong style={{ color: '#dbe8ff', letterSpacing: 0.5 }}>perf</strong>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: '#8aa1c8', cursor: 'pointer', padding: 0 }}
          aria-label="Close perf overlay"
        >
          ×
        </button>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>fps</span>
        <span style={{ color: fpsColor }}>{snap.fps.toFixed(1)}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>avg / p50 / p99</span>
        <span>{fmt(snap.avgMs)} / {fmt(snap.p50Ms)} / {fmt(snap.p99Ms)} ms</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>worst</span>
        <span>{fmt(snap.worstMs)} ms</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>dropped (&gt;33ms)</span>
        <span>{snap.droppedCount} / {snap.frameCount}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>rAF skipped</span>
        <span>{snap.skippedCount}</span>
      </div>
      <div style={{ ...rowStyle, marginTop: 6, paddingTop: 4, borderTop: '1px dashed rgba(140,200,255,0.2)' }}>
        <span style={labelStyle}>interacting frames</span>
        <span>{snap.interactingFrameCount}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>interact avg / p99</span>
        <span style={{ color: interactColor }}>
          {fmt(snap.interactingAvgMs)} / {fmt(snap.interactingP99Ms)} ms
        </span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>visible stars</span>
        <span>{snap.visibleStars.toLocaleString()}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={handleReset}
          style={{
            flex: 1,
            background: 'rgba(140, 200, 255, 0.12)',
            border: '1px solid rgba(140,200,255,0.35)',
            color: '#dbe8ff',
            padding: '4px 8px',
            cursor: 'pointer',
            font: 'inherit',
            borderRadius: 3,
          }}
        >
          reset
        </button>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            flex: 1,
            background: 'rgba(140, 200, 255, 0.12)',
            border: '1px solid rgba(140,200,255,0.35)',
            color: '#dbe8ff',
            padding: '4px 8px',
            cursor: 'pointer',
            font: 'inherit',
            borderRadius: 3,
          }}
        >
          copy
        </button>
      </div>
      <div style={{ marginTop: 6, color: '#5d7299', fontSize: 10 }}>Shift+P to toggle</div>
    </div>
  )
}
