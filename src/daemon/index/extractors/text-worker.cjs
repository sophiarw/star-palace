const { parentPort } = require('node:worker_threads')
const { open, stat, readFile } = require('node:fs/promises')
const { extname } = require('node:path')
const TEXT_LIMIT = 2 * 1024 * 1024
const DOCUMENT_LIMIT = 32 * 1024 * 1024
const TEXT_EXT = /\.(txt|md|markdown|mdx|csv|tsv|json|jsonl|xml|yaml|yml|sql|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|c|cpp|h|hpp|rb|php|swift|kt|sh|html|css|scss|less|vue|svelte|toml|ini|cfg|log|tex|bib|r)$/i

parentPort.on('message', async ({ id, path }) => {
  try {
    const info = await stat(path)
    let text = '', status = 'metadata', truncated = false
    const extension = extname(path).toLowerCase()
    if (['.pdf', '.docx'].includes(extension)) {
      if (info.size > DOCUMENT_LIMIT) status = 'too-large'
      else {
        const buffer = await readFile(path)
        if (extension === '.docx') text = (await require('mammoth').extractRawText({ buffer })).value
        else {
          const { extractText, getDocumentProxy } = await import('unpdf')
          const document = await getDocumentProxy(new Uint8Array(buffer))
          try { text = (await extractText(document, { mergePages: true })).text }
          finally { await document.destroy() }
        }
        truncated = text.length > TEXT_LIMIT
        text = text.slice(0, TEXT_LIMIT)
        status = text.trim() ? 'ready' : 'no-text'
      }
    } else if (TEXT_EXT.test(path)) {
      const handle = await open(path, 'r')
      try {
        const buffer = Buffer.alloc(Math.min(info.size, TEXT_LIMIT))
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (!buffer.subarray(0, Math.min(bytesRead, 4096)).includes(0)) {
          text = buffer.subarray(0, bytesRead).toString('utf8')
          truncated = info.size > bytesRead
          status = 'ready'
        }
      } finally { await handle.close() }
    }
    if (truncated) status = 'truncated'
    parentPort.postMessage({ id, text, status, error: null })
  } catch (error) {
    parentPort.postMessage({ id, text: '', status: 'unavailable', error: error.message })
  }
})
