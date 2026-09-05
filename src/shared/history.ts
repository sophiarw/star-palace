export interface TextVersion { id: string; capturedAt: number }
export interface TextHistorySource { id: number; name: string; enabled: boolean }
export interface TextHistoryStatus { storageBytes: number; maxBytes: number; sources: TextHistorySource[]; captured: number; skipped: number; error: string | null; scanning: boolean }
export interface TextHistoryFile { enabled: boolean; eligible: boolean; reason: string | null; versions: TextVersion[] }
export interface TextHistoryVersion { content: string; diff: string }
