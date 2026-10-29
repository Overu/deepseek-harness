/** Main-process account bridge projected into a renderer-owned snapshot source. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AccountSummary } from '../shared/auth-contracts.ts'
import type { InsightAccountApi, InsightAccountInfo } from '../shared/desktop-api.ts'

/** Safe account data rendered by the workspace sidebar. */
export interface InsightAccountSnapshot {
  summary: AccountSummary | null
  info: InsightAccountInfo | undefined
  failed: boolean
}

/** Own one preload subscription for all Insight workspace account occupants. */
export class InsightAccountSource {
  readonly store = createSnapshotStore<InsightAccountSnapshot>({ summary: null, info: undefined, failed: false })
  readonly settingsRequests = createSnapshotStore(0)
  private live = true
  private received = false
  private readonly unsubscribe: (() => void) | undefined

  constructor(private readonly api: InsightAccountApi | undefined) {
    this.unsubscribe = api?.subscribe((summary) => {
      if (!this.live) return
      this.received = true
      this.store.set({ ...this.store.getSnapshot(), summary, failed: false })
    })
    void api?.current().then((summary) => {
      if (this.live && !this.received) this.store.set({ ...this.store.getSnapshot(), summary })
    }, () => {
      if (this.live && !this.received) this.store.set({ ...this.store.getSnapshot(), failed: true })
    })
    void api?.info().then((info) => {
      if (this.live) this.store.set({ ...this.store.getSnapshot(), info })
    }, () => {
      if (this.live) this.store.set({ ...this.store.getSnapshot(), failed: true })
    })
  }

  /** Request secure Main-process sign-out and let it restart into login. */
  async signOut(): Promise<void> {
    if (!this.live || this.api === undefined) return
    await this.api.signOut()
  }

  /** Request the shell-owned Settings panel without exposing Main-process APIs. */
  openSettings(): void {
    if (this.live) this.settingsRequests.set(this.settingsRequests.getSnapshot() + 1)
  }

  /** Stop observing the isolated preload bridge. */
  dispose(): void {
    this.live = false
    this.unsubscribe?.()
  }
}
