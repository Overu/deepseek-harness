// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
const fixture = vi.hoisted(() => ({ binding: undefined as any }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ id: '2873' }) }));
vi.mock('@xyflow/react', () => ({ ReactFlowProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../src/canvas-service-binding', () => ({ getCanvasViewBinding: () => fixture.binding }));
vi.mock('../src/canvas-view-navigation', () => ({ CanvasViewNavigation: () => null }));
vi.mock('../legacy/src/hooks/useWorkflowTabGuard', () => ({ useWorkflowTabGuard: () => 'active' }));
vi.mock('../legacy/src/components/canvasFlow', () => ({ default: ({ onReferenceSelection }: { onReferenceSelection(): void }) => createElement('button', { onClick: onReferenceSelection }, 'select node') }));
import DesktopCanvas from '../src/desktop-canvas';

it('mounted view connects native selection gestures and node updates, and removes references when the view becomes inactive', async () => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')!;
  const parent = { postMessage: vi.fn() }; Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  const listeners = new Set<(state: any, previous: any) => void>();
  let state = { nodes: [{ id: 'n', type: 'text', data: { title: 'text', value: 'first' }, position: { x: 1, y: 2 }, selected: true }] };
  let readinessListener!: (value: any) => void;
  const store = { getState: () => state, subscribe: (listener: any) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const readiness = { phase: 'ready', capabilities: { read: true, edit: true } };
  fixture.binding = { canvasId: '2873', viewId: 'view', store, getReadiness: () => readiness,
    subscribeReadiness: (listener: any) => { readinessListener = listener; return () => {}; },
    mountEditorRoot: () => () => {}, setFeedback: () => () => {} };
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(DesktopCanvas)));
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'canvas.references.ready' }), location.origin);
    const hello = new MessageEvent('message', { data: { protocolVersion: 1, type: 'canvas.references.hello', canvasId: '2873', viewId: 'view', subscriptionId: 'subscription' }, origin: location.origin });
    Object.defineProperty(hello, 'source', { value: parent });
    await act(async () => { window.dispatchEvent(hello); await vi.advanceTimersByTimeAsync(0); });
    expect(parent.postMessage.mock.lastCall![0].reason).toBe('update');
    await act(async () => { container.querySelector('button')!.click(); await vi.advanceTimersByTimeAsync(0); });
    expect(parent.postMessage.mock.lastCall![0]).toMatchObject({ reason: 'select', nodes: [{ id: 'n', data: { value: 'first' }, position: { x: 1, y: 2 } }] });
    const previous = state;
    state = { nodes: [{ ...state.nodes[0], data: { ...state.nodes[0].data, value: 'updated' } }] };
    await act(async () => { listeners.forEach(listener => listener(state, previous)); await vi.advanceTimersByTimeAsync(0); });
    expect(parent.postMessage.mock.lastCall![0]).toMatchObject({ reason: 'update', nodes: [{ data: { value: 'updated' } }] });
    const beforeDeselect = state;
    state = { nodes: [{ ...state.nodes[0], selected: false }] };
    await act(async () => { listeners.forEach(listener => listener(state, beforeDeselect)); await vi.advanceTimersByTimeAsync(0); });
    expect(parent.postMessage.mock.lastCall![0]).toMatchObject({ reason: 'update', nodes: [{ data: { value: 'updated' } }] });
    await act(async () => readinessListener({ ...readiness, phase: 'inactive' }));
    expect(parent.postMessage.mock.lastCall![0]).toMatchObject({ reason: 'update', nodes: [] });
    expect(listeners.size).toBe(0);
  } finally {
    act(() => root.unmount()); container.remove(); fixture.binding = undefined;
    Object.defineProperty(window, 'parent', originalParent); vi.useRealTimers();
  }
});
