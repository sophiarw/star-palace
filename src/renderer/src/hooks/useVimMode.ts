// Stub for in-progress F6 vim mode. The full implementation will replace this
// file. Typed minimally to satisfy StarMap.tsx's `vimAction` prop import.

export type VimAction =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'zoom'; factor: number }
  | { type: 'fitAll' }
  | { type: 'fitCluster'; clusterId: number }
  | { type: 'panTo'; wx: number; wy: number }
