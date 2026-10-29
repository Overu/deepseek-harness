// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
const store = vi.hoisted(() => ({ update: vi.fn(), nodes: [] as Array<{ id: string; data: Record<string, any> }> }));
vi.mock('@/store/flowStore', () => ({ useFlowStore: Object.assign((selector: (state: unknown) => unknown) => selector({ isSelection: false, modelsMap: {}, actions: { updateNodeData: store.update } }), { getState: () => ({ nodes: store.nodes }) }) }));
vi.mock('@xyflow/react', () => ({ Handle: () => null, NodeToolbar: () => null, Position: { Top: 'top', Bottom: 'bottom' }, NodeResizer: () => null, useUpdateNodeInternals: () => vi.fn() }));
vi.mock('../legacy/src/components/canvasFlow/hooks', () => ({ default: { useNodeResizeObserver: () => undefined, useNodeOperations: () => ({}), useHandleSend: () => ({}), useTopNodeToolbarVisible: () => false } }));
vi.mock('../legacy/src/components/canvasFlow/utils/util', () => ({ default: {} }));
vi.mock('../legacy/src/components/canvasFlow/utils/toolUtil', () => ({ default: { defaultWidth: 400, defaultHeight: 400 } }));
vi.mock('../legacy/src/components/canvasFlow/customNode/text/TextPromptModel', () => ({ default: () => null }));
vi.mock('../legacy/src/components/canvasFlow/customNode/text/TextNodeToolbar', () => ({ default: () => null }));
vi.mock('../legacy/src/components/canvasFlow/customNode/text/openTextEditModal', () => ({ openTextEditModal: vi.fn() }));
vi.mock('../legacy/src/components/canvasFlow/components/nodeControl/NodeOperation', () => ({ default: () => null }));
vi.mock('../legacy/src/components/canvasFlow/components/nodeControl/StatusOverlay', () => ({ default: () => null }));
vi.mock('../legacy/src/components/canvasFlow/components/nodeControl/NodeTitle', () => ({ default: () => null }));
vi.mock('../legacy/src/components/canvasFlow/components/nodeControl/UploadContent', () => ({ default: ({ onClick }: { onClick: () => void }) => createElement('button', { onClick }, 'edit') }));
vi.mock('../legacy/src/components/canvasFlow/components/richText/RichTextViewer', () => ({ default: () => null }));
vi.mock('../legacy/src/components/canvasFlow/components/richText/RichTextEditor', () => ({ default: ({ value, onChange, onBlur }: { value: string; onChange: (value: string) => void; onBlur: () => void }) => createElement('textarea', { value, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value), onBlur }) }));
import TextNode from '../legacy/src/components/canvasFlow/customNode/text';
import { isAgentEditorBusy } from '../src/agent-edit-guard';

afterEach(() => { vi.useRealTimers(); });
it('native text blur/unmount retains the original 500ms save and editor marker', () => {
  vi.useFakeTimers(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const data = { value: '', title: 'text', titleStyle: {}, params: {}, taskInfo: { status: '' } };
  store.nodes = [{ id: 'n4', data }];
  act(() => root.render(createElement(TextNode, { id: 'n4', data, selected: false })));
  act(() => container.querySelector('button')!.click()); const editor = container.querySelector('textarea')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, '用户文本');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(isAgentEditorBusy()).toBe(true); act(() => editor.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  act(() => root.unmount()); expect(isAgentEditorBusy()).toBe(true);
  act(() => vi.advanceTimersByTime(499)); expect(store.update).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(store.update).toHaveBeenCalledExactlyOnceWith('n4', { ...data, value: '用户文本' }, false);
  expect(isAgentEditorBusy()).toBe(false); container.remove();
});
