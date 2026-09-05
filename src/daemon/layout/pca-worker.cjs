// Development loads TypeScript; distributable builds contain plain JS.
// SQLite and active-layout publication remain owned by the daemon.
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const compiled = join(__dirname, 'Pca.js')
if (!existsSync(compiled)) require('tsx/cjs')
const { parentPort, workerData } = require('node:worker_threads')
const { StarPca } = require(existsSync(compiled) ? compiled : './Pca.ts')
try {
  const pca = StarPca.train(workerData.vectors)
  parentPort.postMessage({ model: pca.toJSON(), positions: workerData.vectors.map(v => pca.project(v)) })
} catch (error) { parentPort.postMessage({ error: error.message }) }
