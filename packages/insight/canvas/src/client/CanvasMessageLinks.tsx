import type { ComponentType } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import { canvasIdAnswer } from '../shared/canvas-message-links.ts';
import { canvasAddress, parseCanvasId } from '../shared/protocol.ts';
type AssistantProps = ChatNodeViewProps<'assistant-step'>;
/** Only the concise canvas-ID answer needs custom URI rendering. Native Markdown, copy and Session data survive. */
export function createCanvasMessageLinks(Native: ComponentType<AssistantProps>, open: (id: string) => void) {
    return function CanvasMessageLinks(props: AssistantProps) {
        const texts = props.node.data.blocks.filter(block => block.kind === 'text');
        const answer = texts.length === 1 ? canvasIdAnswer(texts[0].text) : undefined;
        if (!answer || props.node.data.status === 'running' || props.groupPart === 'reasoning')
            return <Native {...props}/>;
        const blocks = props.node.data.blocks.filter(block => block !== texts[0]);
        return <>
      <Native {...props} node={{ ...props.node, data: { ...props.node.data, blocks } }}/>
      <p data-canvas-id-answer style={{ marginBlock: 8 }}>当前画布 ID：<a href={answer.address} onClick={event => { event.preventDefault(); open(answer.id); }} style={{ color: 'var(--dsw-alias-label-link, #60a5fa)', textDecoration: 'underline' }}>{answer.id}</a>。</p>
    </>;
    };
}
export function registerCanvasMessageLinks(ctx: Context): void {
    ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => {
        const native = ctx.slots.entriesOfSlot('conversation.chat.node').find(entry => entry.options.key === 'assistant-step');
        if (!native)
            throw new Error('Canvas links require the registered assistant renderer');
        const View = createCanvasMessageLinks(native.component as ComponentType<AssistantProps>, id => ctx.sidebarRight.openResource(canvasAddress(parseCanvasId(id)!)));
        return ctx.slots.register({ name: 'conversation.chat.node', key: 'assistant-step', priority: (native.options.priority ?? 0) - 1, locale: 'chat' }, View);
    }), 'desktop-canvas: assistant canvas links');
}
