interface PCDialProps {
  axisX: number
  axisY: number
  componentCount: number
  onChange: (axisX: number, axisY: number) => void
}

export default function PCDial({ axisX, axisY, componentCount, onChange }: PCDialProps) {
  if (componentCount < 2) return null

  const options = Array.from({ length: componentCount }, (_, i) => i)

  return (
    <div className="pc-dial">
      <span className="pc-dial-label">Axes</span>
      <select
        className="pc-dial-select"
        value={axisX}
        onChange={e => onChange(Number(e.target.value), axisY)}
        aria-label="X axis principal component"
      >
        {options.map(i => (
          <option key={i} value={i}>X = PC{i + 1}</option>
        ))}
      </select>
      <select
        className="pc-dial-select"
        value={axisY}
        onChange={e => onChange(axisX, Number(e.target.value))}
        aria-label="Y axis principal component"
      >
        {options.map(i => (
          <option key={i} value={i}>Y = PC{i + 1}</option>
        ))}
      </select>
    </div>
  )
}
