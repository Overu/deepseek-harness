/** Renderer-safe Insight Desktop update state and operations. */

/** One complete update status safe to render in the isolated native update window. */
export interface InsightUpdateSnapshot {
  currentVersion: string
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error' | 'unsupported'
  track: 'stable' | 'candidate'
  version?: string
  message?: string
  percent?: number
  required: boolean
  canDownloadFullInstaller: boolean
}

/** Fixed IPC names shared by the trusted Main update window and its isolated preload. */
export const INSIGHT_UPDATE_IPC = {
  status: 'insight:update:status',
  changed: 'insight:update:changed',
  checkStable: 'insight:update:check-stable',
  checkCandidate: 'insight:update:check-candidate',
  download: 'insight:update:download',
  install: 'insight:update:install',
  fullInstaller: 'insight:update:full-installer',
  skip: 'insight:update:skip',
  close: 'insight:update:close',
} as const

/** Narrow native update capability exposed to the dedicated sandboxed renderer. */
export interface InsightUpdateApi {
  status(): Promise<InsightUpdateSnapshot>
  subscribe(listener: (snapshot: InsightUpdateSnapshot) => void): () => void
  checkStable(): Promise<void>
  checkCandidate(): Promise<void>
  download(): Promise<void>
  install(): Promise<void>
  fullInstaller(): Promise<void>
  skip(version: string): Promise<void>
  close(): Promise<void>
}
