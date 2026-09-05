// tsx is also the daemon's TypeScript runtime. The worker only computes;
// SQLite and active-layout publication remain owned by the daemon.
require('tsx/cjs')
const { parentPort, workerData } = require('node:worker_threads')
const { StarPca } = require('./Pca.ts')
try {
  const pca = StarPca.train(workerData.vectors)
  parentPort.postMessage({ model: pca.toJSON(), positions: workerData.vectors.map(v => pca.project(v)) })
} catch (error) { parentPort.postMessage({ error: error.message }) }
