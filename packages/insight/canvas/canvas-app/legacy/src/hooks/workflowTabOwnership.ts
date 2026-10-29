import { createCanvasOwnershipLock } from '../../../src/canvas-ownership-lock';

export type WorkflowTabStatus = 'checking' | 'active' | 'inactive';
const protocol = 'web-locks-v1';
type Message = { type: string; ownershipProtocol?: string; requester?: string };

/** Native and background editors share a lock; explicit navigation requests a safe handoff. */
export function createWorkflowTabOwnership(workflowId: string, onStatus: (status: WorkflowTabStatus) => void, background = false, canYield: () => boolean = () => false) {
  let status: WorkflowTabStatus = 'checking', disposed = false, legacy = false;
  let pending: Promise<WorkflowTabStatus> | undefined;
  let handoff: { id: string; done: () => void; timer: ReturnType<typeof setTimeout> } | undefined;
  const publish = () => {
    const next = !disposed && !legacy && lock.isHeld() ? 'active' : 'inactive';
    if (status !== next) { status = next; onStatus(status); }
  };
  const lock = createCanvasOwnershipLock(workflowId, publish);
  const channel = typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
    ? new window.BroadcastChannel(`workflow:active-tab:${workflowId}`) : undefined;
  const send = (message: Message) => { if (!disposed) channel?.postMessage({ ...message, ownershipProtocol: protocol }); };
  const receive = async ({ data }: MessageEvent<Message>) => {
    if (disposed || !data || typeof data !== 'object') return;
    if (['query', 'owner', 'claim'].includes(data.type) && data.ownershipProtocol !== protocol) {
      legacy = true; publish(); return;
    }
    if (data.ownershipProtocol !== protocol) return;
    if (data.type === 'query' && lock.isHeld()) send({ type: 'lock.owner' });
    if (data.type === 'release-request' && typeof data.requester === 'string' && lock.isHeld() && canYield()) {
      await lock.release(); send({ type: 'released', requester: data.requester });
    }
    if (handoff && data.type === 'released' && data.requester === handoff.id) handoff.done();
  };
  channel?.addEventListener('message', receive);
  const acquire = (explicit = false): Promise<WorkflowTabStatus> => {
    if (pending) return pending;
    if (disposed || legacy) { publish(); return Promise.resolve(status); }
    pending = (async () => {
      send({ type: 'query' });
      if (!await lock.acquire() && explicit && channel) {
        await new Promise<void>(resolve => {
          const id = crypto.randomUUID();
          const done = () => { if (handoff?.id === id) { clearTimeout(handoff.timer); handoff = undefined; } resolve(); };
          handoff = { id, done, timer: setTimeout(done, 400) };
          send({ type: 'release-request', requester: id });
        });
        if (!disposed && !legacy) await lock.acquire();
      }
      publish(); return status;
    })().finally(() => { pending = undefined; });
    return pending;
  };
  const ready = acquire(!background).then(() => undefined);
  return { ready, getStatus: () => status, claim: () => acquire(true), recheck: () => acquire(),
    getReason: () => !lock.supported ? '当前环境不支持安全画布所有权，请使用受支持的客户端'
      : legacy ? '检测到旧版画布窗口，请关闭或重载相关窗口并重启客户端' : '画布由其他编辑窗口占用，请先完成编辑或关闭该窗口',
    dispose() {
      if (disposed) return; disposed = true; handoff?.done();
      channel?.removeEventListener('message', receive); channel?.close(); lock.dispose();
    },
  };
}
