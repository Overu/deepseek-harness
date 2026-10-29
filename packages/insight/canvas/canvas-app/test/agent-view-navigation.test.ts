// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCanvasViewNavigator, CanvasViewNavigation } from '../src/canvas-view-navigation';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider, useReactFlow, useStoreApi, type ReactFlowInstance } from '@xyflow/react';
import type { CanvasViewBinding } from '../src/canvas-service-binding';
import type { CanvasViewFocus } from '../../src/shared/canvas-view-navigation';
const identity = { canvasId: '103161', viewId: 'view-a' };
const origin = 'http://localhost:3000';
const disposals: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { disposals.forEach(dispose => dispose()); disposals.length = 0; expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });
function harness() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const parent = { postMessage: vi.fn() };
  let state: 'waiting' | 'missing' | 'hidden' | 'ready' = 'waiting';
  const focus = vi.fn(async () => true), highlight = vi.fn(), select = vi.fn(() => true);
  const navigator = createCanvasViewNavigator({ identity, origin, parent, receiveTarget: {
    addEventListener: (_name: string, cb: any) => listeners.add(cb), removeEventListener: (_name: string, cb: any) => listeners.delete(cb),
  } as unknown as Window, inspect: nodeId => !nodeId && state !== 'waiting' ? 'ready' : state, focus, highlight, select });
  disposals.push(navigator.dispose);
  const channelId = parent.postMessage.mock.calls[0][0].channelId;
  const request = (revision: number, nodeId?: string): CanvasViewFocus => ({ protocolVersion: 1, ...identity, type: 'canvas.view.focus', channelId, revision, nodeId, requestId: `request-${revision}` });
  const receive = (data: unknown, overrides: object = {}) => listeners.forEach(cb => cb({ data, origin, source: parent, ...overrides } as unknown as MessageEvent));
  return { navigator, parent, focus, highlight, select, listeners, request, receive, setState: (next: typeof state) => { state = next; navigator.refresh(); } };
}
it('dock clicks select only after successful focus, while result navigation and duplicates do not select', async () => {
  const h = harness(); h.setState('ready');
  h.receive(h.request(1, 'result')); await vi.advanceTimersByTimeAsync(0);
  expect(h.select).not.toHaveBeenCalled();
  const click = { ...h.request(2, 'dock'), selectNode: true };
  h.receive(click); await vi.advanceTimersByTimeAsync(0); h.receive(click);
  expect(h.select).toHaveBeenCalledExactlyOnceWith('dock');
  h.select.mockReturnValueOnce(false);
  h.receive({ ...h.request(3, 'removed-during-focus'), selectNode: true }); await vi.advanceTimersByTimeAsync(0);
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'node_missing' }), origin);
});
it('queues the latest click until measured and acknowledges duplicates without repeating focus', async () => {
  const h = harness(); const old = h.request(1, 'n1'), current = h.request(2, 'n2');
  h.receive(old); h.receive(current); expect(h.focus).not.toHaveBeenCalled();
  h.setState('ready'); await vi.advanceTimersByTimeAsync(0);
  expect(h.focus).toHaveBeenCalledExactlyOnceWith('n2'); expect(h.highlight).toHaveBeenLastCalledWith('n2');
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: current.requestId, status: 'focused' }), origin);
  h.receive(current); h.receive(old); expect(h.focus).toHaveBeenCalledTimes(1);
});
it('rejects wrong parent/origin/canvas/view/channel and lower or substituted revision', async () => {
  const h = harness(); const request = h.request(2, 'n2');
  for (const override of [{ origin: 'http://foreign.test' }, { source: {} }]) h.receive(request, override);
  for (const changes of [{ canvasId: '103162' }, { viewId: 'view-b' }, { channelId: 'stale' }]) h.receive({ ...request, ...changes });
  h.setState('ready'); expect(h.focus).not.toHaveBeenCalled();
  h.receive(request); await vi.advanceTimersByTimeAsync(0);
  h.receive({ ...request, requestId: 'substitute', nodeId: 'other' }); h.receive(h.request(1, 'older'));
  expect(h.focus).toHaveBeenCalledExactlyOnceWith('n2');
});
it('deleted node returns accurate missing result and never invokes viewport/graph operations', async () => {
  const h = harness(); h.setState('missing'); h.receive(h.request(1, 'deleted'));
  expect(h.focus).not.toHaveBeenCalled();
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'node_missing' }), origin);
  h.receive(h.request(2)); await vi.advanceTimersByTimeAsync(0);
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cleared' }), origin);
});
it('plain opening waits for initialization, supersedes a node target and fits all nodes only once', async () => {
  const h = harness();
  h.receive(h.request(1, 'n1')); const request = h.request(2); h.receive(request);
  expect(h.focus).not.toHaveBeenCalled();
  h.setState('ready'); await vi.advanceTimersByTimeAsync(0);
  expect(h.focus).toHaveBeenCalledExactlyOnceWith(undefined);
  expect(h.select).not.toHaveBeenCalled();
  expect(h.highlight.mock.calls.filter(call => call[0])).toEqual([]);
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: request.requestId, status: 'cleared' }), origin);
  h.receive(request); h.navigator.refresh(); expect(h.focus).toHaveBeenCalledTimes(1);
});
it.each(['n2', undefined])('a newer target %s wins when a previous viewport promise is still resolving', async nodeId => {
  const h = harness(); let resolve!: (value: boolean) => void;
  h.focus.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  h.setState('ready'); h.receive(h.request(1, 'n1')); h.receive(h.request(2, nodeId));
  resolve(true); await vi.advanceTimersByTimeAsync(0);
  expect(h.focus.mock.calls.map(call => call[0])).toEqual(['n1', nodeId]);
  expect(h.highlight.mock.calls.filter(call => call[0]).map(call => call[0])).toEqual(nodeId ? [nodeId] : []);
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 2, status: nodeId ? 'focused' : 'cleared' }), origin);
});
it('bounded wait reports unavailable, cleanup removes listener and suppresses late focus', async () => {
  const h = harness(); h.receive(h.request(1, 'not-measured'));
  await vi.advanceTimersByTimeAsync(20000);
  expect(h.parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'view_unavailable' }), origin);
  h.setState('ready'); expect(h.focus).not.toHaveBeenCalled();
  h.navigator.dispose(); expect(h.listeners.size).toBe(0);
});

it('plain opening of an empty canvas succeeds without queuing a fit that needs node measurements', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')!;
  const parent = { postMessage: vi.fn() }; Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  let store!: ReturnType<typeof useStoreApi>;
  function Probe() { store = useStoreApi(); return null; }
  const setViewport = vi.fn();
  try {
    await act(async () => root.render(createElement(ReactFlowProvider, {}, createElement(Probe),
      createElement(CanvasViewNavigation, { binding: identity as unknown as CanvasViewBinding }))));
    const channelId = parent.postMessage.mock.calls[0][0].channelId;
    const request: CanvasViewFocus = { protocolVersion: 1, ...identity, type: 'canvas.view.focus', channelId, revision: 1, requestId: 'empty-canvas' };
    const event = new MessageEvent('message', { data: request, origin: location.origin }); Object.defineProperty(event, 'source', { value: parent });
    await act(async () => {
      window.dispatchEvent(event);
      store.setState({ width: 1000, height: 800, panZoom: { setViewport } as any, fitViewQueued: true });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: request.requestId, status: 'cleared' }), location.origin);
    expect(setViewport).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount()); container.remove(); Object.defineProperty(window, 'parent', originalParent);
  }
});

it('mounted navigator preserves result navigation and applies dock selection without save, undo or version changes', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const originalParent = Object.getOwnPropertyDescriptor(window, 'parent')!;
  const parent = { postMessage: vi.fn() }; Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  const container = document.createElement('div'); document.body.append(container);
  const marker = document.createElement('div'); marker.className = 'react-flow__node'; marker.dataset.id = 'child'; document.body.append(marker);
  const root = createRoot(container);
  let store!: ReturnType<typeof useStoreApi>, flow!: ReactFlowInstance;
  function Probe() { store = useStoreApi(); flow = useReactFlow(); return null; }
  const nodes = [
    { id: 'group', type: 'group', position: { x: 1000, y: 2000 }, data: {}, measured: { width: 500, height: 400 } },
    { id: 'child', parentId: 'group', position: { x: 20, y: 40 }, data: { prompt: 'unchanged draft' }, selected: false, measured: { width: 100, height: 50 } },
  ];
  let viewport = { x: 0, y: 0, zoom: 1 };
  const setViewport = vi.fn(async (next, options) => {
    if (options.duration) await new Promise(resolve => setTimeout(resolve, options.duration));
    viewport = next; return next;
  });
  const onNodesChange = vi.fn();
  const nativeState = { nodes: structuredClone(nodes), version: 7, history: ['existing'], actions: {
    setNodes: vi.fn((next: typeof nodes) => { nativeState.nodes = next; }), save: vi.fn(), recordSnapshot: vi.fn(),
  } };
  try {
    await act(async () => root.render(createElement(ReactFlowProvider, { initialNodes: nodes },
      createElement(Probe), createElement(CanvasViewNavigation, { binding: { ...identity, store: { getState: () => nativeState } } as unknown as CanvasViewBinding }))));
    const channelId = parent.postMessage.mock.calls[0][0].channelId;
    const request: CanvasViewFocus = { protocolVersion: 1, ...identity, type: 'canvas.view.focus', channelId, revision: 1, requestId: 'native-request', nodeId: 'child' };
    const event = new MessageEvent('message', { data: request, origin: location.origin }); Object.defineProperty(event, 'source', { value: parent });
    await act(async () => {
      window.dispatchEvent(event);
      store.setState({ width: 1000, height: 800, panZoom: { setViewport } as any, onNodesChange, fitViewQueued: true, fitViewOptions: { duration: 500, padding: 0.5 } });
      store.getState().setNodes(store.getState().nodes);
    });
    const snapshot = structuredClone(flow.getNodes());
    expect(flow.getInternalNode('child')!.internals.positionAbsolute).toEqual({ x: 1020, y: 2040 });
    await act(async () => { await vi.advanceTimersByTimeAsync(549); });
    expect(setViewport).toHaveBeenCalledTimes(1);
    const overview = { ...viewport };
    await act(async () => { await vi.advanceTimersByTimeAsync(31); });
    await act(async () => { await vi.advanceTimersByTimeAsync(32); });
    expect(setViewport).toHaveBeenCalledTimes(2);
    expect(setViewport.mock.calls[1][1].duration).toBe(0);
    expect(viewport).toEqual({ x: -570, y: -1665, zoom: 1 });
    expect(flow.getNodes()).toEqual(snapshot); expect(onNodesChange).not.toHaveBeenCalled();
    expect(marker.classList.contains('insight-canvas-result-focus')).toBe(true);
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'focused' }), location.origin);
    const dockRequest = { ...request, requestId: 'dock-click', revision: 2, selectNode: true };
    const dockEvent = new MessageEvent('message', { data: dockRequest, origin: location.origin }); Object.defineProperty(dockEvent, 'source', { value: parent });
    await act(async () => { window.dispatchEvent(dockEvent); await vi.advanceTimersByTimeAsync(600); });
    expect(nativeState.actions.setNodes).toHaveBeenCalledTimes(1);
    expect(nativeState.nodes.find(node => node.id === 'child')!.selected).toBe(true);
    expect(nativeState.nodes[1].data).toEqual(nodes[1].data); expect(nativeState.nodes[1].position).toEqual(nodes[1].position);
    expect(nativeState.version).toBe(7); expect(nativeState.history).toEqual(['existing']);
    expect(nativeState.actions.save).not.toHaveBeenCalled(); expect(nativeState.actions.recordSnapshot).not.toHaveBeenCalled();
    const overviewRequest = { ...request, requestId: 'open-canvas', revision: 3, nodeId: undefined };
    const overviewEvent = new MessageEvent('message', { data: overviewRequest, origin: location.origin }); Object.defineProperty(overviewEvent, 'source', { value: parent });
    await act(async () => { window.dispatchEvent(overviewEvent); });
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(setViewport).toHaveBeenCalledTimes(4);
    expect(viewport).toEqual(overview);
    expect(marker.classList.contains('insight-canvas-result-focus')).toBe(false);
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cleared' }), location.origin);
    expect(nativeState.actions.setNodes).toHaveBeenCalledTimes(1);
    expect(flow.getNodes()).toEqual(snapshot); expect(onNodesChange).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount()); container.remove(); marker.remove(); Object.defineProperty(window, 'parent', originalParent);
  }
});
