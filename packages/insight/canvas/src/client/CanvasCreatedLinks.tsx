import { useMemo, useSyncExternalStore } from 'react'
import type { ChatSnapshot, ToolChatData, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CANVAS_RESULTS_NS } from './CanvasResults.tsx'
import { canvasResultsClosingSeq } from './canvas-results.ts'
import { createdCanvasLinks } from './canvas-created-links.ts'
import { canvasAddress, parseCanvasId } from '../shared/protocol.ts'
import { canvasIdAnswer } from '../shared/canvas-message-links.ts'

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
  const links = createdCanvasLinks(tools, closingSeq)
  for (const step of turn.steps) {
    const reply = step.data.get('assistant-step')
    if (!reply?.finalNode || reply.status === 'running' || reply.finalNode.seq > closingSeq) continue
    const texts = reply.blocks.filter(block => block.kind === 'text')
    const answer = texts.length === 1 ? canvasIdAnswer(texts[0].text) : undefined
    const canvasId = answer && parseCanvasId(answer.id)
    if (canvasId && !links.some(link => link.canvasId === canvasId)) links.push({ canvasId, name: canvasId })
  }
  if (!links.length) return null
  return <div data-canvas-created-links style={{ display: 'grid', gap: 4, marginBlock: 8 }}>
    {links.map(link => <div key={link.canvasId}>
      <span>{t('canvasIdLabel')}</span>
      <a href={canvasAddress(link.canvasId)} title={link.name}
        onClick={(event) => { event.preventDefault(); openCreatedCanvas(link.canvasId) }}
        style={{ color: 'var(--dsw-alias-link)', textDecoration: 'underline' }}>{link.canvasId}</a>
    </div>)}
  </div>
}
