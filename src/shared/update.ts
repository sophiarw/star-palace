export interface UpdateStatus { state: 'unavailable' | 'idle' | 'checking' | 'installing' | 'restarting' | 'done' | 'error'; message: string; revision?: string }
