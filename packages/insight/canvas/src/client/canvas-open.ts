import { CanvasAgentError } from '../shared/canvas-agent-protocol.ts';
import type { CanvasOpenReceipt } from '../shared/canvas-process-protocol.ts';
/** Navigation is scoped to the visible originating conversation, never a background replacement. */
export function createCanvasOpener(options: {
    currentSession(): string | undefined;
    open(canvasId: string, nodeId: string | undefined, navigationId: string): void;
    timeoutMs?: number;
}) {
    const pending = new Map<string, {
        canvasId: string;
        sessionId: string;
        resolve: (value: CanvasOpenReceipt) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();
    const finish = (id: string, focus: CanvasOpenReceipt['focus']) => {
        const entry = pending.get(id);
        if (!entry) {
            return;
        }
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.resolve({ status: 'opened', canvasId: entry.canvasId, version: null, content: focus === 'focused' || focus === 'node_missing' ? 'ready' : 'loading', focus: options.currentSession() === entry.sessionId ? focus : 'view_unavailable' });
    };
    return {
        async open(sessionId: string, canvasId: string, nodeId?: string): Promise<CanvasOpenReceipt> {
            if (options.currentSession() !== sessionId) {
                throw new CanvasAgentError('CONTEXT_INACTIVE', '请切回发起请求的对话再打开画布');
            }
            const navigationId = crypto.randomUUID();
            if (!nodeId) {
                options.open(canvasId, undefined, navigationId);
                return { status: 'opened', canvasId, version: null, content: 'loading', focus: 'not_requested' };
            }
            if (pending.size >= 8) {
                throw new CanvasAgentError('BRIDGE_OVERLOADED', '已有待完成的定位请求');
            }
            return await new Promise<CanvasOpenReceipt>((resolve, reject) => {
                const timer = setTimeout(() => finish(navigationId, 'view_unavailable'), options.timeoutMs ?? 25000);
                pending.set(navigationId, { canvasId, sessionId, resolve, timer });
                try {
                    options.open(canvasId, nodeId, navigationId);
                }
                catch (error) {
                    clearTimeout(timer);
                    pending.delete(navigationId);
                    reject(error);
                }
            });
        },
        settled(navigationId: string, focus: CanvasOpenReceipt['focus']) { finish(navigationId, focus); },
        dispose() {
            for (const id of [...pending.keys()])
                finish(id, 'view_unavailable');
        },
    };
}
