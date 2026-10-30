import type { ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { canvasAddress, parseCanvasId } from '../shared/protocol.ts'
import { CanvasReferenceDock, CANVAS_REFERENCES_NS } from './CanvasReferenceDock.tsx'
import type { CanvasNodeReference, CanvasNodeReferences } from './canvas-node-references.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Session-scoped Canvas reference dock below native attachments.
     * Replacements receive the reference controller and node-opening action.
     * Absence hides the dock without changing native uploads.
     */
    'desktop-canvas.composer.references': { kind: 'single'
      scope: 'session' }
  }
}

type AttachmentsProps = ComposerAttachmentsProps & PropsRenderSlots<'desktop-canvas.composer.references'> & {
  canvasSessionId: string | undefined
}

export function registerCanvasComposerAttachments(ctx: Context, references: CanvasNodeReferences): void {
  ctx.effect(() => ctx.slots.inject('conversation.input.attachments', function* () {
    const native = ctx.slots.entriesOfSlot('conversation.input.attachments').at(0)
    if (!native) throw new Error('Canvas references require the registered attachment renderer')
    const NativeAttachments = native.component as ComponentType<ComposerAttachmentsProps>
    function CanvasComposerAttachments({ canvasSessionId, ...props }: AttachmentsProps) {
      return <>
        <NativeAttachments {...props} />
        {canvasSessionId !== undefined && props.renderSlot('desktop-canvas.composer.references', {})}
      </>
    }
    // Retain the native renderer so it remains the sole owner of upload and drop handling.
    yield ctx.slots.register({ name: 'conversation.input.attachments', priority: (native.options.priority ?? 0) - 1,
      inject: sessionId => ({ canvasSessionId: sessionId }),
      locale: 'conversation', children: { 'desktop-canvas.composer.references': { kind: 'single', scope: 'session' } },
    }, CanvasComposerAttachments)
    yield ctx.slots.register({ name: 'desktop-canvas.composer.references', locale: CANVAS_REFERENCES_NS,
      inject: sessionId => ({ references, referenceSessionId: String(sessionId), openReference: (reference: CanvasNodeReference) => {
        const canvasId = parseCanvasId(reference.canvasId)
        if (canvasId) ctx.sidebarRight.openResource(canvasAddress(canvasId), { params: { nodeId: reference.node.id } })
      } }),
    }, CanvasReferenceDock)
  }), 'desktop-canvas: composer attachments')
}
