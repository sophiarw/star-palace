import { lazy, Suspense } from 'react'

const AtlasApp = lazy(() => import('./atlas/AtlasApp'))
const LegacyApp = lazy(() => import('./LegacyApp'))

export default function App() {
  const classic = new URLSearchParams(window.location.search).get('view') === 'classic'
  return <Suspense fallback={<div role="status" style={{ padding: 40, color: '#c5d2dc', background: '#090f18', height: '100vh' }}>Opening Star Palace…</div>}>
    {classic ? <><LegacyApp /><a href="?view=atlas" style={{ position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)', zIndex: 1500, padding: '10px 18px', borderRadius: 6, border: '1px solid #665c43', background: '#121b29', color: '#e7c68d', font: '12px sans-serif', textDecoration: 'none' }}>← Return to the new atlas</a></> : <AtlasApp />}
  </Suspense>
}
