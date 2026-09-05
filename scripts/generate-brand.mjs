import { writeFile } from 'node:fs/promises'

// Draw 宫 on an orthogonal grid, then apply one affine transform to the
// entire character. Every horizontal shares a slope; every vertical shares
// a slope. The asymmetry comes from the composition, never random vertices.
const connections = [
  'M90 18 102 32',
  'M28 74V54H172L165 74',
  'M60 92H140V130H60Z',
  'M51 154H149V198H51Z',
]
const nodes = [
  [90, 18, 3], [102, 32, 2],
  [28, 54, 3], [28, 74, 2], [165, 74, 2],
  [60, 92, 3], [140, 92, 2.5], [140, 130, 3],
  [51, 154, 2.5], [149, 154, 3], [51, 198, 3],
]
const stars = [[172, 54, 8], [60, 130, 6], [149, 198, 8]]
const transform = 'matrix(.98 -.12 .10 .98 -3 16)'

function star(x, y, radius) {
  // A filled four-point star: a crisp silhouette instead of luminous blur.
  return `<path transform="translate(${x} ${y}) scale(${radius / 8})" d="M0-8C1-2 2-1 8 0 2 1 1 2 0 8-1 2-2 1-8 0-2-1-1-2 0-8Z"/>`
}

function svg(compact) {
  const lineWidth = compact ? 5 : 3
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 216 232" role="img" aria-labelledby="title desc">
  <title id="title">Star Palace</title>
  <desc id="desc">宫, palace, drawn as a constellation with straight ivory connections, three gold stars, and a consistent ascending slant.</desc>
  ${compact ? '<rect width="216" height="232" rx="35" fill="#0b1019"/>' : ''}
  <g transform="${transform}">
    <g fill="none" stroke="#ede8db" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="miter">
      ${connections.map(d => `<path d="${d}"/>`).join('\n      ')}
    </g>
    <g fill="#ede8db">
      ${nodes.map(([x, y, radius]) => `<circle cx="${x}" cy="${y}" r="${compact ? Math.max(radius, 3.5) : radius}"/>`).join('\n      ')}
    </g>
    <g fill="#e4c28b">
      ${stars.map(([x, y, radius]) => star(x, y, compact ? radius + 1 : radius)).join('\n      ')}
    </g>
  </g>
</svg>
`.replace(/^ +$/gm, '')
}

await writeFile(new URL('../website/public/palace-constellation.svg', import.meta.url), svg(false))
await writeFile(new URL('../website/public/favicon.svg', import.meta.url), svg(true))
console.log('Generated the vector logo and its optically heavier favicon.')
