import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve('src/shared') }
  },
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
})
