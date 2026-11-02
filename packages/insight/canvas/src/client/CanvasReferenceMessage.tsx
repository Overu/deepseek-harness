import { useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ChatNodeViewProps, UserContentAttachment } from '@deepseek-ai/dsh-client-ui-chat/client'
import { splitNodeRefs } from '../shared/canvas-node-references.ts'
import { parseCanvasId, canvasAddress } from '../shared/protocol.ts'
import { HoverCard } from '@deepseek-ai/dsh-client-ui-primitives'
import { ReferencePreview, ReferenceThumbnail } from './CanvasReferenceDock.tsx'

type MessageProps = ChatNodeViewProps<'user' | 'steering'>
type MessageBlock = MessageProps['node']['data']['content'][number]

function isAttachment(block: MessageBlock): block is Extract<MessageBlock, { type: 'image' | 'file' }> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Historical attachments use additional block variants.
  return (block.type === 'image' || block.type === 'file') && block.attachment !== undefined
}

/** Render Canvas references beside the complete native message Factory. */
export function createCanvasReferenceMessageView(openNode: (canvasId: string, nodeId: string) => void) {
  return function CanvasReferenceMessage(props: MessageProps) {
    const anchor = useRef<HTMLDivElement>(null)
    const { content, nodes } = splitNodeRefs(props.node.data.content)
    if (!nodes.length) return props.renderFactorySlot('conversation.chat.user.message', { node: props.node, loadImage: props.loadImage })
    // Only lift durable attachments recognized by the native renderer; leave other blocks in its care.
    const attachments = content.filter(isAttachment)
    const nativeProps = { ...props, node: { ...props.node, data: { ...props.node.data,
      content: content.filter(block => !isAttachment(block)) } } } as MessageProps
    return <div data-canvas-reference-message>
      {attachments.length > 0 && <div data-canvas-message-attachments style={{ display: 'flex',
        flexDirection: 'column', alignItems: 'flex-end', marginBottom: 8 }}>
        {props.renderFactorySlot('conversation.chat.user.content', {
          content: { text: '', extraBlocks: [], attachments: attachments.map((block): UserContentAttachment => block.type === 'image'
            ? { type: 'image', image: { attachment: block.attachment } }
            : { type: 'file', file: block.attachment }) },
          loadImage: props.loadImage, facts: {},
        })}
      </div>}
      <div ref={anchor} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        {nodes.map((ref, index) => {
          const products = ref.products.filter(product => product.kind === 'text' || /^https?:\/\//i.test(product.value))
          return <HoverCard key={`${ref.canvasId}:${ref.nodeId}:${index}`} variant="preview" widthAnchorRef={anchor} openDelayMs={250}
            anchor={<ReferenceThumbnail title={ref.title} type={ref.type} product={products[0]} onClick={() =>{
              openNode(ref.canvasId, ref.nodeId) }} />}
            content={<ReferencePreview title={ref.title} products={products} />} />
        })}
      </div>
      {props.renderFactorySlot('conversation.chat.user.message', { node: nativeProps.node, loadImage: props.loadImage })}
    </div>
  }
}

export function registerCanvasReferenceMessageViews(ctx: Context): void {
  ctx.effect(() => ctx.slots.inject('conversation.chat.node', function* () {
    for (const key of ['user', 'steering'] as const) {
      const View = createCanvasReferenceMessageView((canvasId, nodeId) => {
        const id = parseCanvasId(canvasId)
        if (id) ctx.sidebarRight.openResource(canvasAddress(id), { params: { nodeId } })
      })
      yield ctx.slots.register({ name: 'conversation.chat.node', key,
        priority: -1, locale: 'chat' }, View)
    }
  }), 'desktop-canvas: reference message renderers')
}
