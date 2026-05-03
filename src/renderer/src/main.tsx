import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App'
// Side-effect import: attaches `window.__driver` + `window.__perf` so the
// claude-in-chrome MCP `javascript_tool` (and any future Playwright job)
// can drive the renderer like a human and read frame metrics directly.
import './lib/perfDriver'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
