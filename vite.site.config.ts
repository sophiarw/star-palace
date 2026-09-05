import { resolve } from 'node:path'
import { defineConfig } from 'vite'
export default defineConfig({
  root: 'website',
  resolve: { alias: { '@shared': resolve('src/shared') } },
  build: { outDir: '../dist-site', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5180 },
})
