// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentEditorDebounce } from '../src/agent-editor-debounce';
import { installAgentCanvasEditGuard, isAgentEditorBusy, isAgentOperationBusy, markAgentEditorBusy, subscribeAgentOperationBusy, withAgentEditGuard } from '../src/agent-edit-guard';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

describe('native pending debounce tracking', () => {
  it('keeps prompt pending for the native 1500ms even after blur; commits only the last input', () => {
    vi.useFakeTimers(); const commit = vi.fn(); const pending = createAgentEditorDebounce('n1:prompt', commit, 1500);
    pending('first'); vi.advanceTimersByTime(1000); pending('last');
    document.body.focus(); expect(isAgentEditorBusy()).toBe(true); vi.advanceTimersByTime(1499);
    expect(commit).not.toHaveBeenCalled(); vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledExactlyOnceWith('last'); expect(isAgentEditorBusy()).toBe(false);
  });
  it('reuses native flush/cancel and independently tracks overlapping editor instances', () => {
    vi.useFakeTimers(); const commit = vi.fn(); const old = createAgentEditorDebounce('n1:text', commit, 500); const next = createAgentEditorDebounce('n1:text', commit, 500);
    old('old'); next('new'); old.cancel(); expect(isAgentEditorBusy()).toBe(true);
    next.flush('final'); expect(commit).toHaveBeenCalledExactlyOnceWith('final');
    expect(isAgentEditorBusy()).toBe(false); vi.runAllTimers(); expect(commit).toHaveBeenCalledTimes(1);
  });
  it('blocks strict work until the native callback has synchronously entered its save queue', async () => {
    vi.useFakeTimers(); let queued = false; const pending = createAgentEditorDebounce('n2:lyrics', (_value: string) => { expect(isAgentEditorBusy()).toBe(true); queued = true; }, 500);
    pending('lyrics'); const action = vi.fn(); await expect(withAgentEditGuard(action, async () => undefined)).rejects.toMatchObject({ code: 'EDITOR_BUSY', requestPhase: 'not_sent' });
    expect(action).not.toHaveBeenCalled(); vi.advanceTimersByTime(500); expect(queued).toBe(true); expect(isAgentEditorBusy()).toBe(false);
  });
});

describe('operation exclusion and DOM protection', () => {
  it('rejects focused editors without blurring or flushing them', async () => {
    for (const tag of ['input', 'textarea', 'div']) {
      const editor = document.createElement(tag); if (tag === 'div') { editor.setAttribute('contenteditable', 'true'); editor.tabIndex = 0; }
      document.body.append(editor); editor.focus(); const blur = vi.fn(); editor.addEventListener('blur', blur);
      await expect(withAgentEditGuard(vi.fn(), async () => undefined)).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
      expect(document.activeElement).toBe(editor); expect(blur).not.toHaveBeenCalled(); editor.remove();
    }
  });
  it('holds one lock through idle and receipt, rejects competing operations, releases on failure', async () => {
    const idle = deferred(); const receipt = deferred(); const busy: boolean[] = []; const stop = subscribeAgentOperationBusy(() => busy.push(isAgentOperationBusy()));
    const action = vi.fn(() => receipt.promise); const first = withAgentEditGuard(action, () => idle.promise);
    expect(isAgentOperationBusy()).toBe(true); expect(action).not.toHaveBeenCalled();
    await expect(withAgentEditGuard(vi.fn(), async () => undefined)).rejects.toMatchObject({ code: 'EDITOR_BUSY' });
    idle.resolve(); await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(isAgentOperationBusy()).toBe(true); receipt.resolve(); await first; expect(isAgentOperationBusy()).toBe(false);
    await expect(withAgentEditGuard(async () => { throw new Error('refused'); }, async () => undefined)).rejects.toThrow('refused');
    expect(isAgentOperationBusy()).toBe(false); expect(busy).toEqual([true, false, true, false]); stop();
  });
  it('rechecks pending editing after idle without running the operation', async () => {
    const idle = deferred(); const action = vi.fn(); const first = withAgentEditGuard(action, () => idle.promise);
    markAgentEditorBusy('n1:late', true); const result = expect(first).rejects.toMatchObject({ code: 'EDITOR_BUSY' }); idle.resolve(); await result;
    markAgentEditorBusy('n1:late', false); expect(action).not.toHaveBeenCalled(); expect(isAgentOperationBusy()).toBe(false);
  });
  it('blocks document shortcuts and portalled controls synchronously only during the receipt', async () => {
    const root = document.createElement('div'); const portal = document.createElement('button'); document.body.append(root, portal);
    root.inert = false; const cleanup = installAgentCanvasEditGuard(root); const events = vi.fn();
    for (const name of ['keydown', 'paste', 'drop', 'click', 'pointerdown']) document.addEventListener(name, events);
    const gate = deferred(); const running = withAgentEditGuard(() => gate.promise, async () => undefined);
    expect(root.inert).toBe(true);
    for (const name of ['keydown', 'paste', 'drop', 'click', 'pointerdown']) {
      const event = new Event(name, { bubbles: true, cancelable: true }); portal.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    }
    expect(events).not.toHaveBeenCalled(); gate.resolve(); await running; expect(root.inert).toBe(false);
    portal.dispatchEvent(new Event('click', { bubbles: true })); expect(events).toHaveBeenCalledTimes(1);
    cleanup(); for (const name of ['keydown', 'paste', 'drop', 'click', 'pointerdown']) document.removeEventListener(name, events);
  });
  it('keeps composition and pointer gestures busy until completion, cleans disconnected editors', async () => {
    const root = document.createElement('div'); const editor = document.createElement('textarea'); root.append(editor); document.body.append(root);
    const cleanup = installAgentCanvasEditGuard(root);
    editor.dispatchEvent(new Event('compositionstart', { bubbles: true })); expect(isAgentEditorBusy()).toBe(true);
    editor.dispatchEvent(new Event('blur')); expect(isAgentEditorBusy()).toBe(true);
    editor.dispatchEvent(new Event('compositionend', { bubbles: true })); expect(isAgentEditorBusy()).toBe(false);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(isAgentEditorBusy()).toBe(true);
    root.dispatchEvent(new Event('pointerup', { bubbles: true })); expect(isAgentEditorBusy()).toBe(false);
    editor.dispatchEvent(new Event('compositionstart', { bubbles: true })); editor.remove(); await Promise.resolve(); expect(isAgentEditorBusy()).toBe(false);
    root.dispatchEvent(new Event('pointerdown', { bubbles: true })); cleanup(); expect(isAgentEditorBusy()).toBe(false);
  });
  it('restores existing inert on disposal and prevents writes after the protected canvas unmounts', async () => {
    const root = document.createElement('div'); document.body.append(root); root.inert = true; const cleanup = installAgentCanvasEditGuard(root);
    const idle = deferred(); const action = vi.fn(); const running = withAgentEditGuard(action, () => idle.promise);
    const result = expect(running).rejects.toMatchObject({ code: 'READ_ONLY', requestPhase: 'not_sent' }); cleanup(); root.remove(); idle.resolve(); await result;
    expect(action).not.toHaveBeenCalled(); expect(root.inert).toBe(true); expect(isAgentOperationBusy()).toBe(false);
  });
});
