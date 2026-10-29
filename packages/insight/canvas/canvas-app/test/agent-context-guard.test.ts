// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentEditGuard } from '../src/agent-edit-guard';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
afterEach(() => { document.body.replaceChildren(); });

describe('context guard view ownership', () => {
  it('ignores a focused Shell chat input when no canvas view is attached', async () => {
    const input = document.createElement('input'); document.body.append(input); input.focus();
    const guard = createAgentEditGuard(); const operation = vi.fn();
    await guard.run(operation, async () => undefined);
    expect(operation).toHaveBeenCalledTimes(1);
    guard.dispose();
  });
  it('checks the registered canvas document, including its body portals, without blocking a different canvas', async () => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    const doc = frame.contentDocument!;
    const root = doc.createElement('div'); doc.body.append(root);
    const portalInput = doc.createElement('textarea'); doc.body.append(portalInput); portalInput.focus();
    const a = createAgentEditGuard(); const b = createAgentEditGuard();
    const detach = a.attachRoot('a', root);
    const operation = vi.fn();
    await expect(a.run(operation, async () => undefined)).rejects.toMatchObject({ code: 'EDITOR_BUSY', requestPhase: 'not_sent' });
    await b.run(operation, async () => undefined);
    expect(operation).toHaveBeenCalledTimes(1);
    const chat = document.createElement('input'); document.body.append(chat); chat.focus();
    await a.run(operation, async () => undefined);
    expect(operation).toHaveBeenCalledTimes(2);
    detach(); detach();
    await a.run(operation, async () => undefined);
    expect(operation).toHaveBeenCalledTimes(3);
    a.dispose(); b.dispose();
  });
  it('detaching a presentation restores inert but does not close a context operation', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const guard = createAgentEditGuard(); const detach = guard.attachRoot('view', root);
    const gate = deferred(); const operation = vi.fn();
    const run = guard.run(operation, () => gate.promise);
    expect(root.inert).toBe(true);
    detach(); expect(root.inert).not.toBe(true); expect(guard.isOperationBusy()).toBe(true);
    gate.resolve(); await run;
    expect(operation).toHaveBeenCalledTimes(1); expect(guard.isOperationBusy()).toBe(false);
    guard.dispose();
  });
  it('context disposal cancels an unsent operation, restores views and blocks reuse', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const guard = createAgentEditGuard(); guard.attachRoot('view', root);
    const gate = deferred(); const operation = vi.fn();
    const run = guard.run(operation, () => gate.promise);
    const outcome = expect(run).rejects.toMatchObject({ code: 'READ_ONLY', requestPhase: 'not_sent' });
    guard.dispose(); guard.dispose(); expect(root.inert).not.toBe(true);
    gate.resolve(); await outcome; expect(operation).not.toHaveBeenCalled();
    await expect(guard.run(operation, async () => undefined)).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(guard.isOperationBusy()).toBe(false);
  });
  it('keeps draft and busy subscriptions isolated between guard instances', async () => {
    const a = createAgentEditGuard(); const b = createAgentEditGuard();
    const editorsA = vi.fn(); const editorsB = vi.fn(); const busyA = vi.fn(); const busyB = vi.fn();
    const unsubscribe = a.subscribeEditors(editorsA); b.subscribeEditors(editorsB);
    a.subscribeBusy(busyA); b.subscribeBusy(busyB);
    a.markEditorBusy('n1:prompt', true); a.markEditorBusy('n1:prompt', true);
    expect(editorsA).toHaveBeenCalledTimes(1); expect(editorsB).not.toHaveBeenCalled();
    a.markEditorBusy('n1:prompt', false); unsubscribe();
    await a.run(() => undefined, async () => undefined);
    expect(busyA).toHaveBeenCalledTimes(2); expect(busyB).not.toHaveBeenCalled();
    a.dispose(); b.dispose();
  });
});
