export interface ExampleFile { name: string; bytes: number; favorite?: 'pulsar' | 'black-hole'; kind: string; folder: string; tag: string; text: string; x: number; y: number }
export const exampleFiles: ExampleFile[] = [
  { name: 'A small garden.md', bytes: 8192, kind: 'Markdown', folder: 'Field notes / Garden', tag: 'garden', text: 'Basil · Mint · Potting soil. Location: kitchen window.', x: 43, y: 37 },
  { name: 'Planting calendar.csv', bytes: 32768, kind: 'CSV', folder: 'Field notes / Garden', tag: 'garden', text: 'March: sow basil. April: repot. May: transplant outdoors.', x: 25, y: 28 },
  { name: 'Window light.jpg', bytes: 8388608, kind: 'Image', folder: 'Field notes / Garden', tag: 'garden', text: 'Windowsill / Afternoon / Herbs', x: 64, y: 23 },
  { name: 'Botany reading.pdf', bytes: 2097152, kind: 'PDF', folder: 'Field notes / Reading', tag: 'garden', text: 'Botany / Roots / Soil / Reading notes', x: 68, y: 45 },
  { name: 'Lamp sketches.png', bytes: 134217728, kind: 'Image', folder: 'Things to make / Lamp', tag: 'making', text: 'Desk lamp / Stem / Bulb / Oak base', x: 16, y: 54 },
  { name: 'Workshop ideas.md', bytes: 2048, kind: 'Markdown', folder: 'Things to make / Workshop', tag: 'making', text: 'Shelf assembly. Handle repair. Offcuts inventory.', x: 36, y: 66 },
  { name: 'Materials.csv', bytes: 16384, kind: 'CSV', folder: 'Things to make / Lamp', tag: 'making', text: 'Oak · Brass fitting · Linen cable · LED', x: 18, y: 80 },
  { name: 'Show and tell.pptx', bytes: 33554432, favorite: 'pulsar', kind: 'Presentation', folder: 'Things to make / Workshop', tag: 'making', text: 'Workshop / Progress / Photographs', x: 51, y: 80 },
  { name: 'Coastal walk.pdf', bytes: 4194304, kind: 'PDF', folder: 'Somewhere to go / Coast', tag: 'coast', text: 'Route: station → lighthouse → cove. Lunch: headland.', x: 80, y: 67 },
  { name: 'Weekend plans.md', bytes: 4096, kind: 'Markdown', folder: 'Somewhere to go / Coast', tag: 'coast', text: 'Train tickets · Notebook · Walking route', x: 63, y: 62 },
  { name: 'Tide times.csv', bytes: 65536, kind: 'CSV', folder: 'Somewhere to go / Coast', tag: 'coast', text: 'Tide table / Coast / Beach access', x: 86, y: 34 },
  { name: 'Old trip.zip', bytes: 1073741824, favorite: 'black-hole', kind: 'Archive', folder: 'Somewhere to go / Archive', tag: 'coast', text: 'Maps, notes, and photographs from an earlier trip. Kept together for the next time that corner of the world calls.', x: 89, y: 85 },
]
export const matchingFiles = (query: string): ExampleFile[] => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return exampleFiles.filter(file => words.every(word => [file.name, file.folder, file.tag, file.text].join(' ').toLowerCase().includes(word)))
}
export function feedbackUrl(kind: string, summary: string, message: string): string {
  const url = new URL('https://github.com/sophiarw/star-palace/issues/new')
  url.searchParams.set('title', summary.trim().slice(0, 120))
  url.searchParams.set('body', '### ' + kind + '\n\n' + message.trim().slice(0, 2500) + '\n\n---\nPrepared using the Star Palace website feedback form.')
  return url.href
}
