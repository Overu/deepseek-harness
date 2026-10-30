import { useMemo, useSyncExternalStore } from 'react'
import type { ChatSnapshot, ToolChatData, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CANVAS_RESULTS_NS } from './CanvasResults.tsx'
import { canvasResultsClosingSeq } from './canvas-results.ts'
import { createdCanvasLinks } from './canvas-created-links.ts'
import { canvasAddress } from '../shared/protocol.ts'

interface SnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
export interface CanvasCreatedLinksInjected {
  getCanvasChat: () => SnapshotSource<ChatSnapshot | undefined>
  openCreatedCanvas: (canvasId: string) => void
}
const EMPTY_TOOLS: readonly ToolChatData[] = []
const emptyTools = () => EMPTY_TOOLS
const idle = () => () => {}

/** Independent footer: never rewrites prose, selects nodes, or opens a view without a click. */
export function CanvasCreatedLinks({ turn, seq, getCanvasChat, openCreatedCanvas, t }:
  TurnTailOwnerProps & CanvasCreatedLinksInjected & PropsLocale<typeof CANVAS_RESULTS_NS>) {
  const chatSource = useMemo(getCanvasChat, [getCanvasChat])
  const subscribeChat = useMemo(() => (listener: () => void) => chatSource.subscribe(listener), [chatSource])
  const snapshotChat = useMemo(() => () => chatSource.getSnapshot(), [chatSource])
  const chat = useSyncExternalStore(subscribeChat, snapshotChat, snapshotChat)
  const source = useMemo(() => chat?.nodes.turnDataSource(turn.turn, 'tool-call'), [chat?.nodes, turn.turn])
  const subscribeTools = useMemo(() => source ? (listener: () => void) => source.subscribe(listener) : idle, [source])
  const snapshotTools = useMemo(() => source ? () => source.getSnapshot() : emptyTools, [source])
  const tools = useSyncExternalStore<readonly ToolChatData[]>(subscribeTools, snapshotTools, snapshotTools)
  const closingSeq = canvasResultsClosingSeq(turn, seq)
  const links = useMemo(() => createdCanvasLinks(tools, closingSeq), [tools, closingSeq])
  if (!links.length) return null
  return <div data-canvas-created-links style={{ display: 'grid', gap: 4, marginBlock: 8 }}>
    {links.map(link => <div key={link.canvasId}>
      <span>{t('canvasIdLabel')}</span>
      <a href={canvasAddress(link.canvasId)} title={link.name}
        onClick={(event) => { event.preventDefault(); openCreatedCanvas(link.canvasId) }}
        style={{ color: 'var(--dsw-alias-label-link, #60a5fa)', textDecoration: 'underline' }}>{link.canvasId}</a>
    </div>)}
  </div>
}
