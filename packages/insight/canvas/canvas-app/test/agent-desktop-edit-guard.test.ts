// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
const tab = vi.hoisted(() => ({ status: 'active', id: '2873' }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ id: tab.id }) }));
vi.mock('@xyflow/react', () => ({ ReactFlowProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../legacy/src/hooks/useWorkflowTabGuard', () => ({ useWorkflowTabGuard: () => tab.status }));
vi.mock('../legacy/src/components/canvasFlow', () => ({ default: () => createElement('button', null, 'native canvas') }));
import DesktopCanvas from '../src/desktop-canvas';
import { isAgentEditorBusy, isAgentOperationBusy, withAgentEditGuard } from '../src/agent-edit-guard';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
it('DesktopCanvas installs synchronous DOM protection and restores it after strict receipt', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  act(() => root.render(createElement(DesktopCanvas))); const canvas = container.firstElementChild as HTMLElement;
  const click = vi.fn(); container.querySelector('button')!.addEventListener('click', click);
  const receipt = deferred(); const save = withAgentEditGuard(() => receipt.promise, async () => undefined);
  expect(canvas.inert).toBe(true); container.querySelector('button')!.click(); expect(click).not.toHaveBeenCalled();
  receipt.resolve(); await save; expect(isAgentOperationBusy()).toBe(false); container.querySelector('button')!.click(); expect(click).toHaveBeenCalledTimes(1);
  act(() => root.unmount()); container.remove(); expect(isAgentEditorBusy()).toBe(false);
});
it('DesktopCanvas tab ownership loss disposes protection and cancels unsent strict work', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  tab.status = 'active'; act(() => root.render(createElement(DesktopCanvas)));
  const idle = deferred(); const operation = vi.fn(); const save = withAgentEditGuard(operation, () => idle.promise);
  const outcome = expect(save).rejects.toMatchObject({ code: 'READ_ONLY', requestPhase: 'not_sent' });
  tab.status = 'inactive'; act(() => root.render(createElement(DesktopCanvas))); expect(container.textContent).toContain('其他标签页');
  idle.resolve(); await outcome; expect(operation).not.toHaveBeenCalled(); expect(isAgentOperationBusy()).toBe(false);
  act(() => root.unmount()); container.remove(); tab.status = 'active';
});
