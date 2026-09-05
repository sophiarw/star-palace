export function readStored<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem('starpalace.atlas.' + key); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
export function writeStored(key: string, value: unknown): void {
  try { localStorage.setItem('starpalace.atlas.' + key, JSON.stringify(value)) } catch { /* browsing remains available in private mode */ }
}
